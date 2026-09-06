import { writeCheckedFile, type ManagedFileHandle } from './file-io';
import { serializeCollection } from '../shared/collection';
import type { Collection } from '../shared/types';
interface WriteJob { id: number; handle: ManagedFileHandle; expected: string; data: string | Collection }
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<WriteJob>) => void; postMessage: (value: unknown) => void };
let queue = Promise.resolve();
scope.onmessage = ({ data: job }) => {
  queue = queue.then(async () => {
    try {
      const content = typeof job.data === 'string' ? job.data : serializeCollection(job.data);
      await writeCheckedFile(job.handle, job.expected, content);
      scope.postMessage({ id: job.id, content });
    } catch (error) {
      scope.postMessage({ id: job.id, error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : '写入失败。' } });
    }
  });
};
