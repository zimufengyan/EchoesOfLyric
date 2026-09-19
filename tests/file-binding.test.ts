import test from 'node:test';
import assert from 'node:assert/strict';
import { planFileRestore } from '../src/file-binding';

const entry = (text: string) => ({ text, title: '', author: '', dynasty: '', url: '' });
const baseline = { '念': [entry('旧句')] };
const local = { '念': [entry('旧句'), entry('本地新句')] };
const remote = { '念': [entry('旧句'), entry('文件新句')] };
const json = JSON.stringify;

test('restore recognizes completed writes even when the checkpoint lags', () => {
  assert.equal(planFileRestore(json(baseline), json(local), local, true), 'same');
});
test('restore loads the disk if the anthology cache is absent or unchanged', () => {
  assert.equal(planFileRestore(json(baseline), json(remote), baseline, true), 'load');
  assert.equal(planFileRestore(json(baseline), json(remote), {}, false), 'load');
});
test('restore only writes pending local changes when the disk matches its checkpoint', () => {
  assert.equal(planFileRestore(json(baseline), JSON.stringify(baseline, null, 2), local, true), 'write');
  assert.equal(planFileRestore(json(baseline), json(remote), local, true), 'conflict');
});
test('restore does not overwrite malformed JSON or an externally emptied file', () => {
  assert.throws(() => planFileRestore(json(baseline), '{broken', local, true));
  assert.throws(() => planFileRestore(json(baseline), '', local, true));
  assert.equal(planFileRestore('', '', local, true), 'write');
  assert.equal(planFileRestore('', '', {}, false), 'conflict');
});
