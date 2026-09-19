import { parseCollection, serializeCollection } from '../shared/collection';
import type { Collection } from '../shared/types';
import type { ManagedFileHandle } from './file-io';

export interface FileBinding {
  handle: ManagedFileHandle;
  expectedText: string;
}

/** Stores browser file handles separately from the anthology and portable HTML. */
export class FileBindingStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private key: string) {}

  private transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const run = () => new Promise<T>((resolve, reject) => {
      let db: IDBDatabase | undefined;
      let transaction: IDBTransaction | undefined;
      let finished = false;
      const finish = (error?: unknown, value?: T) => {
        if (finished) return;
        finished = true; clearTimeout(timer); db?.close();
        if (error) reject(error); else resolve(value as T);
      };
      const timer = setTimeout(() => {
        finish(new Error('无法读取保存位置记录。'));
        try { transaction?.abort(); } catch { /* Already completed. */ }
      }, 2500);
      try {
        const request = indexedDB.open('echoes-file-bindings', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onerror = () => finish(request.error);
        request.onblocked = () => finish(new Error('保存位置记录暂时不可用。'));
        request.onsuccess = () => {
          db = request.result;
          if (finished) { db.close(); return; }
          db.onversionchange = () => db?.close();
          try {
            transaction = db.transaction('files', mode);
            const operation = action(transaction.objectStore('files'));
            transaction.oncomplete = () => finish(undefined, operation.result);
            transaction.onabort = () => finish(transaction?.error ?? new Error('保存位置记录未完成。'));
            transaction.onerror = () => finish(transaction?.error ?? operation.error);
          } catch (error) { finish(error); }
        };
      } catch (error) { finish(error); }
    });
    const operation = this.tail.then(run);
    this.tail = operation.catch(() => {});
    return operation;
  }

  async read(): Promise<FileBinding | null> {
    const record = await this.transact('readonly', store => store.get(this.key));
    if (!record) return null;
    if (typeof record.expectedText !== 'string' || typeof record.handle?.getFile !== 'function'
      || typeof record.handle?.createWritable !== 'function') throw new Error('保存位置记录无效，请重新选择文件。');
    return record;
  }

  async save(record: FileBinding): Promise<void> {
    await this.transact('readwrite', store => store.put(record, this.key));
  }

  async clear(): Promise<void> {
    await this.transact('readwrite', store => store.delete(this.key));
  }
}

function comparable(text: string): string {
  try { return serializeCollection(parseCollection(text)); } catch { return text; }
}

/** A stale cache may follow the disk; divergent edits require an explicit choice. */
export function planFileRestore(expected: string, disk: string, local: Collection, hasLocalState: boolean): 'same' | 'load' | 'write' | 'conflict' {
  const current = serializeCollection(local);
  const actual = comparable(disk);
  const baseline = comparable(expected);
  if (current === actual) return 'same';
  // An initially selected empty file may not have received its first write yet.
  if (!disk.trim() && disk === expected) return hasLocalState ? 'write' : 'conflict';
  parseCollection(disk); // Never overwrite an invalid or damaged JSON file on restore.
  if (!hasLocalState || current === baseline) return 'load';
  if (actual === baseline) return 'write';
  return 'conflict';
}
