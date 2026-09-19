import { serializeCollection } from '../shared/collection';
import type { Collection } from '../shared/types';
import { writeCheckedFile, type ManagedFileHandle } from './file-io';
export type { ManagedFileHandle, WritableFile } from './file-io';
declare const __FILE_WORKER_SOURCE__: string;

export interface FilePickers {
  showOpenFilePicker?: (options: unknown) => Promise<ManagedFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<ManagedFileHandle>;
}

export const jsonFileType = [{ description: 'JSON 诗集', accept: { 'application/json': ['.json'] } }];

export function readCache<T>(key: string): T | null {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : null; } catch { return null; }
}

export function writeCache(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Each snapshot is queued; serialization and file I/O run in an embedded worker when supported. */
export class FileWriter {
  private tail: Promise<void> = Promise.resolve();
  private active = true;
  private worker: Worker | null = null;
  private workerError: Error | null = null;
  private nextID = 0;
  private pending = new Map<number, { resolve: (content: string) => void; reject: (error: Error) => void }>();
  constructor(public handle: ManagedFileHandle, private expectedText: string) {
    if (typeof Worker === 'undefined' || typeof __FILE_WORKER_SOURCE__ === 'undefined') return;
    const url = URL.createObjectURL(new Blob([__FILE_WORKER_SOURCE__], { type: 'text/javascript' }));
    try {
      this.worker = new Worker(url);
      this.worker.onmessage = ({ data }) => {
        const job = this.pending.get(data.id); if (!job) return;
        this.pending.delete(data.id);
        if (data.error) {
          const error = new Error(data.error.message); error.name = data.error.name; job.reject(error);
        } else job.resolve(data.content);
      };
      this.worker.onerror = event => {
        event.preventDefault();
        this.workerError = new Error('后台保存未完成，请重新选择保存位置后重试。');
        for (const job of this.pending.values()) job.reject(this.workerError);
        this.pending.clear(); this.worker?.terminate(); this.worker = null;
      };
    } catch { this.worker = null; }
    finally { URL.revokeObjectURL(url); }
  }

  detach(): void {
    this.active = false;
    void this.tail.finally(() => { this.worker?.terminate(); this.worker = null; });
  }

  write(data: string | Collection): Promise<string> {
    const snapshot = typeof data === 'string' ? data : structuredClone(data);
    const operation = this.tail.then(async () => {
      if (!this.active) throw new Error('保存位置已经更换，请在当前诗集重新保存。');
      if (this.workerError) throw this.workerError;
      let content: string;
      if (this.worker) {
        const id = ++this.nextID;
        try {
          content = await new Promise<string>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try { this.worker!.postMessage({ id, handle: this.handle, expected: this.expectedText, data: snapshot }); }
            catch (error) { this.pending.delete(id); reject(error); }
          });
        } catch (error) {
          // No message was delivered if the handle cannot be cloned. Keep the same async queue.
          if (!(error instanceof Error) || error.name !== 'DataCloneError') throw error;
          this.worker.terminate(); this.worker = null;
          content = typeof snapshot === 'string' ? snapshot : serializeCollection(snapshot);
          await writeCheckedFile(this.handle, this.expectedText, content);
        }
      } else {
        content = typeof snapshot === 'string' ? snapshot : serializeCollection(snapshot);
        await writeCheckedFile(this.handle, this.expectedText, content);
      }
      this.expectedText = content;
      return content;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') return '未获得文件写入权限，修改仍待保存。';
  if (error instanceof Error) return error.message;
  return '操作未完成，请重试。';
}

export function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
