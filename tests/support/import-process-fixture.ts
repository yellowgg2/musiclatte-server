import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Synthetic executable writes no live URLs, metadata, or process output to evidence. */
export function createImportProcessFixture(root: string, mode = 'ok') {
  const executable = join(root, `engine-${mode}`);
  writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'overflow') { process.stdout.write('x'.repeat(2 * 1024 * 1024)); }
else if (mode === 'exit') { process.stderr.write('private synthetic stderr'); process.exitCode = 1; }
else if (args.includes('--dump-single-json')) {
  const id = new URL(args.at(-1)).searchParams.get('v');
  process.stdout.write(JSON.stringify({id: mode === 'wrong-id' ? 'XXXXXXXXXXX' : id, title: 'Synthetic song', channel: 'Synthetic channel', channel_id: 'channel-1'}));
} else {
  if (!args.includes('--no-playlist') || !args.includes('--ignore-config') || !args.includes('bestaudio/best') || !args.includes('--embed-metadata') || !args.includes('--embed-thumbnail') || !args.includes('after_move:%(filepath)j')) process.exit(5);
  const file = path.join(process.cwd(), 'audio.mp3');
  const id = new URL(args.at(-1)).searchParams.get('v');
  if (mode !== 'missing') fs.writeFileSync(file, mode === 'empty' ? '' : JSON.stringify({sourceId: id, valid: mode !== 'invalid-audio'}));
  if (mode === 'symlink') { fs.renameSync(file, file + '.target'); fs.symlinkSync(file + '.target', file); }
  process.stdout.write(JSON.stringify(mode === 'outside' ? path.join(process.cwd(), '..', 'audio.mp3') : file) + '\\n');
  if (mode === 'multiple') process.stdout.write(JSON.stringify(file) + '\\n');
}
`,
  );
  chmodSync(executable, 0o700);
  const ffprobe = join(root, 'ffprobe-fixture');
  writeFileSync(
    ffprobe,
    `#!${process.execPath}
const fs = require('node:fs');
let text = ''; process.stdin.on('data', c => text += c); process.stdin.on('end', () => { try { const data = JSON.parse(text); console.log(JSON.stringify({streams: data.valid ? [{codec_type: 'audio', codec_name: 'mp3'}] : [], format: {format_name: 'mp3', tags: {comment: data.sourceId}}})); } catch { process.exitCode = 1; } });
`,
  );
  chmodSync(ffprobe, 0o700);
  return { executable, ffprobe };
}
