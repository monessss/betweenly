export function parseEnv(source) {
  const values = Object.create(null);
  for (const [index, line] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/);
    // Never echo a malformed line: it can contain a provider credential.
    if (!match) throw Error(`Invalid .env format on line ${index + 1}; use KEY=value.`);
    const raw = match[2].trim();
    values[match[1]] = /^(".*"|'.*')$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return values;
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
