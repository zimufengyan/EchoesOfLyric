export interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
export interface ManagedFileHandle {
  name: string;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFile(): Promise<File>;
  createWritable(options?: { mode: 'exclusive' }): Promise<WritableFile>;
}

/** Check before opening, and again under the browser's exclusive writer lock. */
export async function writeCheckedFile(handle: ManagedFileHandle, expected: string, content: string): Promise<void> {
  const check = async () => {
    if (await (await handle.getFile()).text() !== expected) {
      const error = new Error('JSON 已被其他程序修改。请核对文件变更后继续保存。');
      error.name = 'FileChangedError';
      throw error;
    }
  };
  await check();
  const stream = await handle.createWritable({ mode: 'exclusive' });
  try { await check(); await stream.write(content); await stream.close(); }
  catch (error) { try { await stream.abort?.(); } catch { /* Keep the write error. */ } throw error; }
}
