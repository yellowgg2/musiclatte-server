import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Generated tone, solid raster images and original words; never copied from a music library. */
export async function createMetadataFixture(options: {
  root: string;
  python: string;
  ffmpeg: string;
  version: 0 | 3 | 4;
  durationSeconds?: number;
  includeLegacyWebp?: boolean;
}) {
  const duration = options.durationSeconds ?? 0.3;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180)
    throw new Error('invalid_fixture_duration');
  const run = (args: string[]) =>
    execFileSync(options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  run([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    String(duration),
    '-map_metadata',
    '-1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-write_xing',
    '0',
    '-id3v2_version',
    '0',
    join(options.root, 'source.mp3'),
  ]);
  for (const [name, color] of [
    ['old.png', 'red'],
    ['new.png', 'blue'],
    ['new.jpg', 'green'],
    ['old.webp', 'yellow'],
  ])
    run([
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=16x16:d=0.1`,
      '-frames:v',
      '1',
      '-threads',
      '1',
      join(options.root, name!),
    ]);
  if (options.version === 0) return;
  const script = `import json, os, sys
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TPE2, TRCK, TYER, TDRC, TCON, TXXX, UFID, USLT, SYLT, APIC
v=json.load(sys.stdin)
root=v["root"]
tags=ID3()
tags.add(TIT2(encoding=1,text=["Original synthetic"]))
tags.add(TPE1(encoding=1,text=["Original artist","Second original"]))
tags.add(TALB(encoding=1,text=["Original album"]))
tags.add(TPE2(encoding=1,text=["Original album artist"]))
tags.add(TRCK(encoding=1,text=["1/12"]))
tags.add((TYER if v["version"]==3 else TDRC)(encoding=1,text=["2024" if v["version"]==3 else "2024-02-29"]))
tags.add(TCON(encoding=1,text=["Synthetic genre"]))
tags.add(TXXX(encoding=1,desc="source_id",text=["synthetic-source-id"]))
tags.add(TXXX(encoding=1,desc="replaygain_track_gain",text=["-3.0 dB"]))
tags.add(UFID(owner="synthetic-owner",data=b"synthetic-identifier"))
tags.add(USLT(encoding=1,lang="eng",desc="",text="An original little test song."))
tags.add(USLT(encoding=1,lang="kor",desc="other",text="\\uC791\\uC740 \\uBCC4\\uC744 \\uADF8\\uB9BD\\uB2C8\\uB2E4. \\uC9C1\\uC811 \\uB9CC\\uB4E0 \\uD14C\\uC2A4\\uD2B8 \\uAC00\\uC0AC."))
tags.add(SYLT(encoding=1,lang="eng",format=2,type=1,desc="timed",text=[("Synthetic",0),("timing",100)]))
with open(os.path.join(root,"old.png"),"rb") as image:
    data=image.read()
tags.add(APIC(encoding=1,mime="image/png",type=3,desc="front",data=data))
tags.add(APIC(encoding=1,mime="image/png",type=4,desc="back",data=data))
if v.get("includeLegacyWebp"):
    with open(os.path.join(root,"old.webp"),"rb") as image:
        tags.add(APIC(encoding=1,mime="image/webp",type=0,desc="youtube",data=image.read()))
tags.save(os.path.join(root,"source.mp3"),v2_version=v["version"],v23_sep=None,v1=2)
path=os.path.join(root,"source.mp3")
with open(path,"r+b") as audio:
    header=audio.read(10)
    size=sum(byte << shift for byte,shift in zip(header[6:10],[21,14,7,0]))
    audio.seek(10)
    payload=audio.read(size)
    # Padding permits a real unknown frame without rewriting the audio offset.
    marker=b"XZZZ"+bytes([0,0,0,17])+b"\\x00\\x00"+b"opaque-test-frame"
    offset=0
    while payload[offset:offset+4] != bytes(4):
        raw=payload[offset+4:offset+8]
        length=int.from_bytes(raw,"big") if v["version"]==3 else sum(byte << shift for byte,shift in zip(raw,[21,14,7,0]))
        offset+=10+length
    audio.seek(10+offset)
    audio.write(marker)
`;
  execFileSync(options.python, ['-I', '-B', '-c', script], {
    input: JSON.stringify(options),
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
}
