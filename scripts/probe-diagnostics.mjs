import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function redactProbeText(value, temporaryRoot) {
  let text = String(value);
  const paths = [temporaryRoot, process.env.USERPROFILE, process.env.HOME].filter(Boolean);
  const secrets = Object.entries(process.env).filter(([key, value]) => /key|token|password|secret|authorization|cookie/i.test(key) && value?.length >= 6).map(([, value]) => value);
  for (const path of paths) {
    text = text.replaceAll(pathToFileURL(path).href, '<probe-or-user-home>').replaceAll(path, '<probe-or-user-home>').replaceAll(JSON.stringify(path).slice(1, -1), '<probe-or-user-home>');
  }
  for (const secret of secrets) text = text.replaceAll(secret, '<redacted>');
  return text.replace(/(Bearer\s+)[\w.-]+/gi, '$1<redacted>')
    .replace(/\b(?:sess_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '<native-id>');
}

// Read only this probe's temporary JSONL log directory. Select startup fields,
// never prompt/history/tool payloads, native IDs, provider keys or whole files.
export async function startupLogSummary(directory, temporaryRoot) {
  const summary = [];
  let names;
  try { names = (await readdir(directory)).filter(name => name.endsWith('.jsonl')).sort().slice(-2); }
  catch { return summary; }
  for (const name of names) {
    const file = await open(join(directory, name), 'r');
    try {
      const { size } = await file.stat();
      const buffer = Buffer.alloc(Math.min(size, 65536));
      await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      for (const line of buffer.toString('utf8').split('\n')) {
        let item; try { item = JSON.parse(line); } catch { continue; }
        if (!/session_create|create_record|runtime_preferences|startup|bootstrap|storage/i.test(item.event ?? '') && !['warn', 'error'].includes(item.level)) continue;
        summary.push({ event: item.event, level: item.level, status: item.status, durationMs: item.durationMs,
          message: redactProbeText(item.message ?? '', temporaryRoot).slice(0, 400),
          error: item.error ? { name: item.error.name, code: item.error.code, message: redactProbeText(item.error.message ?? '', temporaryRoot).slice(0, 400) } : undefined,
          errorMessage: item.context?.errorMessage ? redactProbeText(item.context.errorMessage, temporaryRoot).slice(0, 400) : undefined });
      }
    } finally { await file.close(); }
  }
  return summary.slice(-24);
}
