import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceImport } from '../src/lib/voice-corpus.ts';

test('personal corpus normalizes duplicate own lines without rewriting original punctuation', () => {
  const result = prepareVoiceImport('行 那你先歇会\r\n\n行  那你先歇会\nＯＫ\nOK\n[图片]', 'lines', '', 'GENERAL');
  assert.deepEqual(result.samples.map(s => s.text), ['行 那你先歇会', 'ＯＫ']);
  assert.equal(result.duplicateCount, 2);
});
test('chat corpus requires an explicit self nickname and excludes counterpart and media', () => {
  const raw = '朋友\n时间未显示\n亲爱的宝贝\n\n我\n时间未显示\n行 那你先歇会\n\n我\n时间未显示\n[贴纸：月亮]';
  assert.throws(() => prepareVoiceImport(raw, 'chat', '', 'DAILY'), /自己的昵称/);
  assert.throws(() => prepareVoiceImport(raw, 'chat', '陌生人', 'DAILY'), /未找到/);
  assert.deepEqual(prepareVoiceImport(raw, 'chat', '我', 'DAILY').samples, [{ text: '行 那你先歇会', situation: 'DAILY' }]);
});
test('long or empty corpus fails before any import', () => {
  for (const raw of ['', 'x'.repeat(501), 'x\n'.repeat(10001), '[图片]']) assert.throws(() => prepareVoiceImport(raw, 'lines', '', 'GENERAL'));
});
