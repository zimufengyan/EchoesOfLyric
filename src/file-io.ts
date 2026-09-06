export interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
export interface ManagedFileHandle {
  name: string;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFile(): Promise<File>;
  createWritable(options?: { mode: 'exclusive' }): Promise<WritableFile>;
}

/** Check before opening, and again under the browser's exclusive writer lock. */
export async function writeCheckedFile(handle: ManagedFileHandle, expected: string, content: string): Promise<void> {
  const check = async () => {
    if (await (await handle.getFile()).text() !== expected) throw new Error('JSON 已被其他程序修改。请重新导入，或选择新的保存位置。');
  };
  await check();
  const stream = await handle.createWritable({ mode: 'exclusive' });
  try { await check(); await stream.write(content); await stream.close(); }
  catch (error) { try { await stream.abort?.(); } catch { /* Keep the write error. */ } throw error; }
}
