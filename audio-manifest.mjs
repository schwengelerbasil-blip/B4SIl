import fs from 'node:fs';

const EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/**
 * Looks in site/audio for the two comparison files.
 * A file counts as the "before" version if its name contains "before",
 * and as the "after" version if its name contains "after".
 */
export function buildAudioManifest(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => EXT.test(f)); } catch { /* folder missing */ }
  const find = (word) => files.find((f) => f.toLowerCase().includes(word));
  const before = find('before');
  const after = find('after');
  return {
    before: before ? `/audio/${encodeURIComponent(before)}` : null,
    after: after ? `/audio/${encodeURIComponent(after)}` : null,
  };
}
