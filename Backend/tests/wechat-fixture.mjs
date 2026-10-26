import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
if (process.env.WECHAT_FIXTURE_LOG) appendFileSync(process.env.WECHAT_FIXTURE_LOG, process.argv[2] + '\n');
const version = 'fixture-4.1';
if (process.argv[2] === 'status') console.log(JSON.stringify({ available: true, version, method: 'WINDOWS_LOCAL_TEXT', message: '测试助手' }));
else console.log(JSON.stringify({
  conversationTitle: '导入测试对象', wechatVersion: version, capturedAt: new Date().toISOString(), warnings: ['本机画面识别，请核对原文和说话人。'],
  messages: [
    { clientId: randomUUID(), sender: 'OTHER', text: '今天有些累。', sentAt: null, sourceType: 'USER_RELAY', isVerbatim: false },
    { clientId: randomUUID(), sender: 'USER', text: '收到', sentAt: null, sourceType: 'USER_RELAY', isVerbatim: false },
    { clientId: randomUUID(), sender: 'USER', text: '收到', sentAt: null, sourceType: 'USER_RELAY', isVerbatim: false },
    { clientId: randomUUID(), sender: 'UNKNOWN', text: '未确认原文', sentAt: null, sourceType: 'USER_RELAY', isVerbatim: false }
  ].slice(-Number(process.argv[3]))
}));
