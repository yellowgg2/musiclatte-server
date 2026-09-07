import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Standalone synthetic self-updater: only its own copied executable can change. */
export function createEngineProcessFixture(root: string, mode = 'ok') {
  const seed = join(root, 'seed');
  writeFileSync(
    seed,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const version = 'nightly-1';
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args.includes('--update-to')) {
  if (mode === 'hang-update') { setInterval(() => {}, 1000); return; }
  if (args[args.indexOf('--update-to') + 1] !== 'nightly' || !args.includes('--ignore-config')) process.exit(9);
  if (mode === 'check-failure') { process.stderr.write('private update failure'); process.exit(1); }
  if (mode === 'corrupt') { fs.writeFileSync(__filename, ''); process.exit(0); }
  if (mode === 'symlink') { fs.unlinkSync(__filename); fs.symlinkSync(${JSON.stringify(seed)}, __filename); process.exit(0); }
  if (mode === 'mode') { fs.chmodSync(__filename, 0o777); process.exit(0); }
  if (mode !== 'no-update') fs.writeFileSync(__filename, fs.readFileSync(__filename, 'utf8').replace("const version = 'nightly-1';", "const version = 'nightly-2';"));
} else if (args.includes('--version')) {
  console.log(mode === 'bad-version' && version === 'nightly-2' ? '../private' : version);
} else if (args.includes('--dump-single-json')) {
  if (!args.includes('--skip-download') || !args.includes('--no-playlist') || !args.includes('--ignore-config')) process.exit(8);
  if (version === 'nightly-2' && mode === 'probe-failure') { process.stderr.write('private source error'); process.exit(2); }
  const id = new URL(args.at(-1)).searchParams.get('v');
  console.log(JSON.stringify({ id: version === 'nightly-2' && mode === 'source-mismatch' ? 'XXXXXXXXXXX' : id, title: 'Synthetic song', channel: 'Synthetic channel', channel_id: 'channel-1' }));
} else {
  const id = new URL(args.at(-1)).searchParams.get('v');
  const file = path.join(process.cwd(), 'audio.mp3');
  fs.writeFileSync(file, JSON.stringify({ sourceId: id, valid: true }));
  console.log(JSON.stringify(file));
}
`,
  );
  chmodSync(seed, 0o700);
  const ffmpeg = join(root, 'ffmpeg');
  writeFileSync(ffmpeg, `#!${process.execPath}\nconsole.log('ffmpeg version fixture');\n`);
  chmodSync(ffmpeg, 0o700);
  return {
    seed: {
      executable: seed,
      version: 'nightly-1',
      hash: createHash('sha256').update(readFileSync(seed)).digest('hex'),
    },
    ffmpeg,
    node: process.execPath,
  };
}
