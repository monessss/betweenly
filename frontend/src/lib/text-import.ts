export interface ParsedChatMessage { nickname: string; text: string; sentAt: string | null }

const timestamp = /^[ \t]*(\d{4})年[ \t]*(\d{1,2})月[ \t]*(\d{1,2})日[ \t]+(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?[ \t]*$/;

function parseTime(line: string): string | null {
  const match = timestamp.exec(line);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(value => Number(value ?? 0));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return new Date(date.getTime() - 8 * 3600_000).toISOString();
}

// Format: nickname, a time line (unrecognized values mean unknown), then body.
// Known nickname/time headers retain multiline bodies; unseparated single-line
// exports can also use three-line records when time lines are nonstandard.
export function parseChatText(raw: string): ParsedChatMessage[] {
  if (raw.length > 1_000_000) throw new Error('文本过长，请分批粘贴（每批最多 100 万字符）');
  const input = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = input.split('\n');
  const first = lines.findIndex(line => line.trim());
  if (first < 0 || first + 1 >= lines.length) throw new Error('未识别到聊天记录，请使用“昵称 → 时间（非标准时间按未知处理）→ 正文”的格式');
  const marked: number[] = [];
  for (let index = first; index + 1 < lines.length; index++) {
    if (lines[index].trim() && (timestamp.test(lines[index + 1]) || lines[index + 1].trim() === '时间未显示')) marked.push(index);
    if (marked.length > 1000) throw new Error('每批最多导入 1000 条，请拆分文本');
  }
  if (marked[0] !== undefined && marked[0] > first && marked[0] < first + 3) throw new Error('首条记录之前有无法识别的内容，请删除后重新解析');

  const nicknames = new Set([lines[first].trim(), ...marked.map(index => lines[index].trim())]);
  const headers = new Set([first, ...marked]);
  let previous = first;
  for (let index = first + 3; index + 1 < lines.length; index++) {
    if (index >= previous + 3 && nicknames.has(lines[index].trim())) { headers.add(index); previous = index; }
  }

  // Accept complete three-line exports even without a recognized time marker.
  // A blank time line only identifies a previously known nickname; otherwise
  // a paragraph break could be mistaken for another record.
  const triples: number[] = [];
  let cursor = first;
  let nonstandard = false;
  while (cursor + 2 < lines.length && lines[cursor].trim() && lines[cursor + 2].trim()) {
    triples.push(cursor);
    nonstandard ||= !timestamp.test(lines[cursor + 1]) && lines[cursor + 1].trim() !== '时间未显示';
    cursor += 3;
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
  }
  const tripleHeaders = new Set(triples);
  if (nonstandard && cursor === lines.length && marked.every(index => tripleHeaders.has(index)) && triples.every(index => lines[index + 1].trim() || nicknames.has(lines[index].trim()))) {
    triples.forEach(index => headers.add(index));
  }

  const ordered = [...headers].sort((a, b) => a - b);
  if (ordered.length > 1000) throw new Error('每批最多导入 1000 条，请拆分文本');
  return ordered.map((index, position) => {
    const text = lines.slice(index + 2, ordered[position + 1] ?? lines.length).join('\n').replace(/^\n+|\n+$/g, '');
    if (!text.trim()) throw new Error('第 ' + (position + 1) + ' 条消息正文为空');
    if (text.length > 4000) throw new Error('第 ' + (position + 1) + ' 条正文超过 4000 字符');
    return { nickname: lines[index].trim(), text, sentAt: parseTime(lines[index + 1]) };
  });
}
