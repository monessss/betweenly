import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatText } from '../src/lib/text-import.ts';

test('unknown timestamps mix with explicit times without filling or dropping repeated stickers', () => {
  const result = parseChatText(`cinnamon_rolllll
时间未显示
[贴纸：月亮晚安]

cinnamon_rolllll
时间未显示
[贴纸：月亮晚安]

monessss
时间未显示
[贴纸：月亮晚安]

cinnamon_rolllll
2026年10月24日 00:03
可怕的事情是什么

monessss
2026年10月24日 00:21
不告诉你🥺`);
  assert.equal(result.length, 5);
  assert.deepEqual(result.slice(0, 3).map(item => item.sentAt), [null, null, null]);
  assert.deepEqual(result.slice(0, 3).map(item => item.text), Array(3).fill('[贴纸：月亮晚安]'));
  assert.deepEqual(result.slice(0, 3).map(item => item.nickname), ['cinnamon_rolllll', 'cinnamon_rolllll', 'monessss']);
  assert.equal(result[3].sentAt, '2026-10-23T16:03:00.000Z');
  assert.equal(result[4].sentAt, '2026-10-23T16:21:00.000Z');
  assert.equal(result[4].text, '不告诉你🥺');
});

test('all-unknown exports retain multiline text and still reject empty messages', () => {
  assert.deepEqual(parseChatText('小林\r\n 时间未显示 \r\n第一行\r\n\r\n第二行'), [{ nickname: '小林', text: '第一行\n\n第二行', sentAt: null }]);
  assert.throws(() => parseChatText('小林\n时间未显示\n\n'), /正文为空/);
  assert.deepEqual(parseChatText('小林\n2026年10月24日 00:03\n好\n\n小周\n时间未显示\n晚安').map(item => item.sentAt), ['2026-10-23T16:03:00.000Z', null]);
});

test('Chinese chat export parses names, double spaces, midnight and preserved multiline emoji text', () => {
  const result = parseChatText('\uFEFF小林\r\n2026年10月21日 16:41\r\n你好\r\n\r\n小周\r\n2026年10月22日  0:34\r\n第一行\r\n\r\n第二行[流泪]☺️\r\n\r\n小林\r\n2026年10月22日  0:35\r\n[图片] 图片.dat\r\n');
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { nickname: '小林', sentAt: '2026-10-21T08:41:00.000Z', text: '你好' });
  assert.deepEqual(result[1], { nickname: '小周', sentAt: '2026-10-21T16:34:00.000Z', text: '第一行\n\n第二行[流泪]☺️' });
  assert.equal(result[2].text, '[图片] 图片.dat');
});

test('repeated text and same-minute messages are retained in original order', () => {
  const block = '小林\n2026年10月21日 16:41\n[动画表情]';
  assert.equal(parseChatText(block + '\n\n' + block).length, 2);
  assert.equal(parseChatText('小林\n2024年2月29日 0:00:15\n好')[0].sentAt, '2024-02-28T16:00:15.000Z');
});

test('every nonstandard or invalid time line becomes unknown without changing the body', () => {
  for (const time of ['时间未知', '未获取到时间', '昨天 23:10', '2026/10/24 00:03', 'not a time', '', '2026年2月29日 12:00', '2026年13月1日 12:00', '2026年10月21日 24:00', '2026年10月21日 0:60']) {
    assert.deepEqual(parseChatText('小林\n' + time + '\n不告诉你🥺  保留空格'), [{ nickname: '小林', text: '不告诉你🥺  保留空格', sentAt: null }]);
  }
  assert.deepEqual(parseChatText('小林\n自定义时间标记\n第一条\n小周\n2026/10/24\n第二条').map(item => [item.nickname, item.text, item.sentAt]), [['小林', '第一条', null], ['小周', '第二条', null]]);
  assert.deepEqual(parseChatText('小林\n2026年10月24日 00:03\n第一条\n小周\n任意非标准时间\n第二条').map(item => item.sentAt), ['2026-10-23T16:03:00.000Z', null]);
  assert.deepEqual(parseChatText('小林\n任意时间说明\n第一条\n小周\n另一种时间说明\n第二条\n小林\n未获取时间\n第三条').map(item => [item.nickname, item.text, item.sentAt]), [['小林', '第一条', null], ['小周', '第二条', null], ['小林', '第三条', null]]);
});

test('the supplied export needs no blank lines and preserves repeated stickers', () => {
  const result = parseChatText('cinnamon_rolllll\n时间未显示\n[贴纸：月亮晚安]\ncinnamon_rolllll\n时间未显示\n[贴纸：月亮晚安]\nmonessss\n时间未显示\n[贴纸：月亮晚安]\ncinnamon_rolllll\n2026年10月24日 00:03\n可怕的事情是什么\nmonessss\n2026年10月24日 00:21\n不告诉你🥺');
  assert.equal(result.length, 5);
  assert.deepEqual(result.map(item => item.sentAt), [null, null, null, '2026-10-23T16:03:00.000Z', '2026-10-23T16:21:00.000Z']);
  assert.deepEqual(result.slice(0, 3).map(item => item.text), Array(3).fill('[贴纸：月亮晚安]'));
  assert.equal(result[4].text, '不告诉你🥺');
});

test('nonstandard time lines preserve multiline bodies between known nickname headers', () => {
  assert.deepEqual(parseChatText('小林\n自定义标记\n第一行\n第二行\n\n第三行\n小林\n另一个非标准标记\n后面的消息'), [
    { nickname: '小林', sentAt: null, text: '第一行\n第二行\n\n第三行' },
    { nickname: '小林', sentAt: null, text: '后面的消息' },
  ]);
});

test('empty messages, unrecognized prefixes and excessive batches fail visibly', () => {
  assert.throws(() => parseChatText('小林\n2026年10月21日 12:00\n\n'), /正文为空/);
  assert.throws(() => parseChatText('导出说明\n\n小林\n2026年10月21日 12:00\n正文'), /首条记录/);
  assert.throws(() => parseChatText('普通文本'), /未识别/);
  assert.throws(() => parseChatText('小林\n2026年10月21日 12:00\n' + '长'.repeat(4001)), /4000/);
  assert.throws(() => parseChatText(Array(1001).fill('小林\n2026年10月21日 12:00\n正文').join('\n\n')), /1000/);
});
