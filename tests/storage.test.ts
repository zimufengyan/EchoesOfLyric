import test from 'node:test';
import assert from 'node:assert/strict';
import { FileWriter, type ManagedFileHandle } from '../src/storage';

test('overlapping saves are serialized and retain the newest state', async () => {
  let disk = 'original'; const writes: string[] = [];
  const handle: ManagedFileHandle = { name: 'test.json', getFile: async () => new File([disk], 'test.json'), createWritable: async () => ({ write: async content => { await new Promise(resolve => setTimeout(resolve, 5)); disk = content; writes.push(content); }, close: async () => {} }) };
  const writer = new FileWriter(handle, disk);
  await Promise.all([writer.write('first'), writer.write('second'), writer.write('latest')]);
  assert.deepEqual(writes, ['first', 'second', 'latest']); assert.equal(disk, 'latest');
});
test('external edits are not silently overwritten', async () => {
  let wrote = false;
  const handle: ManagedFileHandle = { name: 'test.json', getFile: async () => new File(['external edits'], 'test.json'), createWritable: async () => { wrote = true; throw new Error('must not reach'); } };
  await assert.rejects(new FileWriter(handle, 'original').write('new'), /其他程序修改/);
  assert.equal(wrote, false);
});
test('write failure aborts and does not acknowledge a save', async () => {
  let aborted = false;
  const handle: ManagedFileHandle = { name: 'test.json', getFile: async () => new File(['original'], 'test.json'), createWritable: async () => ({ write: async () => { throw new DOMException('Denied', 'NotAllowedError'); }, close: async () => { throw new Error('must not close'); }, abort: async () => { aborted = true; } }) };
  await assert.rejects(new FileWriter(handle, 'original').write('new'), /Denied/);
  assert.equal(aborted, true);
});
test('queued anthology snapshots are isolated from subsequent edits', async () => {
  let disk = ''; const writes: string[] = [];
  const handle: ManagedFileHandle = { name: 'test.json', getFile: async () => new File([disk], 'test.json'), createWritable: async () => {
    let next = ''; return { write: async content => { next = content; }, close: async () => { disk = next; writes.push(next); } };
  } };
  const writer = new FileWriter(handle, disk);
  const collection = { '念': [{ text: '第一句', author: '', title: '', dynasty: '', url: '' }] };
  const first = writer.write(collection); collection['念'][0].text = '第二句';
  const second = writer.write(collection); collection['念'][0].text = '尚未保存';
  await Promise.all([first, second]);
  assert.equal(JSON.parse(writes[0])['念'][0].text, '第一句');
  assert.equal(JSON.parse(disk)['念'][0].text, '第二句');
});
test('a change while acquiring the write lock aborts the write', async () => {
  let disk = 'original', aborted = false;
  const handle: ManagedFileHandle = { name: 'test.json', getFile: async () => new File([disk], 'test.json'), createWritable: async () => {
    disk = 'external change'; return { write: async () => { throw new Error('must not write'); }, close: async () => {}, abort: async () => { aborted = true; } };
  } };
  await assert.rejects(new FileWriter(handle, 'original').write('new'), /其他程序修改/);
  assert.equal(aborted, true); assert.equal(disk, 'external change');
});
