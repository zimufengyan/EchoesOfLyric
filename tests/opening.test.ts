import test from 'node:test';
import assert from 'node:assert/strict';
import { openingPhrases } from '../src/opening';
import { emptyExcerpt } from '../shared/types';

test('opening phrases use unique local clauses and never alter the anthology', () => {
  const collection = { 念: [{ ...emptyExcerpt(), text: '明月松间照，清泉石上流。\n明月松间照' }] };
  const before = JSON.stringify(collection);
  assert.deepEqual(openingPhrases(collection, 16), ['明月松间照', '清泉石上流']);
  assert.equal(JSON.stringify(collection), before);
});
test('opening text bounds preserve Unicode code points and limit scene preparation', () => {
  const collection = { 远: [{ ...emptyExcerpt(), text: '𠮷😀山水明月清风，' + Array.from({ length: 200 }, (_, i) => `诗句${i}`).join('，') }] };
  const phrases = openingPhrases(collection, 4);
  assert.equal(phrases[0], '𠮷😀山水…');
  assert.ok(phrases.length <= 128);
  assert.ok(phrases.every(phrase => Array.from(phrase).length <= 5));
  assert.ok(openingPhrases({}, 16).length > 0);
});
