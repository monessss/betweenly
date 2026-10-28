import { parseChatText } from './text-import.ts';
export const voiceSituations = { GENERAL: '通用表达', DAILY: '日常聊天', CARE: '关心与安慰', HUMOR: '轻松玩笑', INVITATION: '提出邀请', APOLOGY: '解释与道歉', BOUNDARY: '结束与拒绝' } as const;
export type VoiceSituation = keyof typeof voiceSituations;
export interface VoiceInput { text: string; situation: VoiceSituation }
export interface VoiceSample extends VoiceInput { sampleId: string; version: number; createdAt: string; updatedAt: string }
export interface VoiceStatus { sampleCount: number; capacity: number; revision: number; privacyVersion: number }
export interface VoiceImportResult extends VoiceStatus { importedCount: number; duplicateCount: number }
export function prepareVoiceImport(raw: string, format: 'lines' | 'chat', ownNickname: string, situation: VoiceSituation): { samples: VoiceInput[]; duplicateCount: number } {
  if (raw.length > 1_000_000) throw new Error('每次最多导入 100 万字符，请拆分文本');
  let lines: string[];
  if (format === 'chat') {
    if (!ownNickname.trim()) throw new Error('请明确选择自己的昵称');
    const parsed = parseChatText(raw);
    if (!parsed.some(m => m.nickname === ownNickname)) throw new Error('未找到这个昵称的发言');
    lines = parsed.filter(m => m.nickname === ownNickname).map(m => m.text.trim());
  } else lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error('还没有可导入的自己的表达');
  if (lines.length > 10000) throw new Error('每次最多导入 10000 条');
  if (lines.some(s => s.length > 500)) throw new Error('单条语料最多 500 字符，请先拆分长消息');
  // Metadata placeholders are not the user's language habits.
  lines = lines.filter(s => !/^\[(?:图片|语音|视频|动画表情|贴纸|文件|转账|红包)(?:[：:].*)?\]$/.test(s));
  if (!lines.length) throw new Error('没有可参考的文字表达，请移除图片、语音等占位内容后重试');
  const seen = new Set<string>();
  const unique = lines.filter(s => { const key = s.normalize('NFKC').replace(/\s+/g, ' ').trim(); if (seen.has(key)) return false; seen.add(key); return true; });
  return { samples: unique.map(text => ({ text, situation })), duplicateCount: lines.length - unique.length };
}
