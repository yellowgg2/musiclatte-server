import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const toolchain = join(homedir(), '.cache/musiclatte-toolchain');
const python = process.env.METADATA_TEST_PYTHON ?? join(toolchain, 'metadata-python/bin/python');
const ffmpeg = process.env.METADATA_TEST_FFMPEG ?? join(toolchain, 'ffmpeg-9.0.1/ffmpeg');
const ffprobe = process.env.METADATA_TEST_FFPROBE ?? join(toolchain, 'ffmpeg-9.0.1/ffprobe');
let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
async function makeSUT(version: 3 | 4 | 0 = 4, includeLegacyWebp = false) {
  const path = resolve('apps/api/src/metadata/helper-client.ts');
  expect(existsSync(path)).toBe(true);
  const { createMetadataHelper } = await import(path);
  const { createMetadataFixture } = await import(
    resolve('packages/test-support/src/metadata-fixtures.ts')
  );
  root = realpathSync(mkdtempSync(join(tmpdir(), 'musiclatte-metadata-helper-')));
  await createMetadataFixture({ root, python, ffmpeg, version, includeLegacyWebp });
  const helper = createMetadataHelper({
    python,
    ffmpeg,
    ffprobe,
    musicRoot: root,
    helperPath: resolve('apps/api/helpers/metadata.py'),
    timeoutMs: 60000,
    maxFileBytes: 10 * 1024 * 1024,
  });
  return { root, helper };
}
describe('actual MP3 metadata helper', () => {
  /** Real v2.3/v2.4 files preserve audio and every untouched language/source/artwork frame. */
  it.each([3, 4] as const)(
    'should roundtrip selected fields and lyrics while preserving ID3v2.%s',
    async (version) => {
      const s = await makeSUT(version);
      const original = readFileSync(join(s.root, 'source.mp3'));
      expect(original.includes(Buffer.from('opaque-test-frame'))).toBe(true);
      const before = await s.helper.read({ key: 'source.mp3' });
      expect(before.id3Version).toBe(version);
      expect(before.editable).toBe(true);
      copyFileSync(join(s.root, 'source.mp3'), join(s.root, 'candidate.metadata-pending'));
      const result = await s.helper.prepare({
        candidateKey: 'candidate.metadata-pending',
        expectedDigest: before.fullDigest,
        patch: {
          title: { op: 'set', value: '수정된 Synthetic ♫' },
          artist: { op: 'set', value: ['First artist', '두 번째'] },
          album: { op: 'clear' },
          albumArtist: { op: 'set', value: ['Album artist'] },
          trackNumber: { op: 'set', value: '2/12' },
          year: { op: 'set', value: '2028' },
          genre: { op: 'set', value: ['Synthetic', 'Test'] },
          lyrics: {
            op: 'set',
            selector: { language: 'eng', description: '' },
            text: 'We draw a little moon.\nWe sing our own new tune.',
          },
        },
      });
      expect(result).toMatchObject({
        audioPreserved: true,
        untouchedFramesPreserved: true,
        snapshot: {
          id3Version: version,
          values: {
            title: '수정된 Synthetic ♫',
            artist: ['First artist', '두 번째'],
            album: null,
            albumArtist: ['Album artist'],
            trackNumber: '2/12',
            year: version === 4 ? '2028-02-29' : '2028',
            genre: ['Synthetic', 'Test'],
          },
        },
      });
      expect(result.snapshot.audio.packetHash).toBe(before.audio.packetHash);
      expect(result.snapshot.lyricsFrames).toContainEqual({
        selector: { language: 'kor', description: 'other' },
        text: '작은 별을 그립니다. 직접 만든 테스트 가사.',
      });
      expect(readFileSync(join(s.root, 'source.mp3'))).toEqual(original);
      const candidate = readFileSync(join(s.root, 'candidate.metadata-pending'));
      expect(candidate.subarray(-128)).toEqual(original.subarray(-128));
      expect(candidate.includes(Buffer.from('opaque-test-frame'))).toBe(true);
    },
  );
  it('should reject an invalid leap year without modifying the candidate and accept a new JPEG cover', async () => {
    const s = await makeSUT();
    const original = readFileSync(join(s.root, 'source.mp3'));
    copyFileSync(join(s.root, 'source.mp3'), join(s.root, 'date.metadata-pending'));
    const before = await s.helper.read({ key: 'source.mp3' });
    await expect(
      s.helper.prepare({
        candidateKey: 'date.metadata-pending',
        expectedDigest: before.fullDigest,
        patch: { year: { op: 'set', value: '2025' } },
      }),
    ).rejects.toThrow('invalid_metadata');
    expect(readFileSync(join(s.root, 'date.metadata-pending'))).toEqual(original);
    const result = await s.helper.prepare({
      candidateKey: 'date.metadata-pending',
      expectedDigest: before.fullDigest,
      patch: { cover: { op: 'set', selector: { kind: 'new' }, uploadId: 'synthetic-jpeg' } },
      cover: { key: 'new.jpg' },
    });
    expect(result.snapshot.coverFrames).toHaveLength(3);
    expect(
      result.snapshot.coverFrames.some(
        (frame: { mimeType: string }) => frame.mimeType === 'image/jpeg',
      ),
    ).toBe(true);
    writeFileSync(
      join(s.root, 'corrupt.mp3'),
      Buffer.from([73, 68, 51, 4, 0, 0, 127, 127, 127, 127]),
    );
    await expect(s.helper.read({ key: 'corrupt.mp3' })).rejects.toThrow('unsupported_tag_layout');
  });
  /** Source-only generated images replace only the selected front cover and retain other artwork. */
  it('should replace and clear a selected cover while preserving other covers and lyrics', async () => {
    const s = await makeSUT();
    const before = await s.helper.read({ key: 'source.mp3' });
    copyFileSync(join(s.root, 'source.mp3'), join(s.root, 'cover.metadata-pending'));
    const replaced = await s.helper.prepare({
      candidateKey: 'cover.metadata-pending',
      expectedDigest: before.fullDigest,
      patch: {
        cover: {
          op: 'set',
          selector: { kind: 'front', description: 'front' },
          uploadId: 'synthetic-upload',
        },
      },
      cover: { key: 'new.png' },
    });
    expect(
      replaced.snapshot.coverFrames.find(
        (frame: { description: string }) => frame.description === 'back',
      ),
    ).toEqual(
      before.coverFrames.find((frame: { description: string }) => frame.description === 'back'),
    );
    expect(
      replaced.snapshot.coverFrames.find(
        (frame: { description: string }) => frame.description === 'front',
      ).digest,
    ).not.toBe(
      before.coverFrames.find((frame: { description: string }) => frame.description === 'front')
        .digest,
    );
    const cleared = await s.helper.prepare({
      candidateKey: 'cover.metadata-pending',
      expectedDigest: replaced.snapshot.fullDigest,
      patch: {
        cover: { op: 'clear', selector: { kind: 'front', description: 'front' } },
        lyrics: { op: 'clear', selector: { language: 'eng', description: '' } },
      },
    });
    expect(
      cleared.snapshot.coverFrames.map((frame: { description: string }) => frame.description),
    ).toEqual(['back']);
    expect(
      cleared.snapshot.lyricsFrames.map(
        (frame: { selector: { language: string } }) => frame.selector.language,
      ),
    ).toEqual(['kor']);
  });
  /** Destructive cover operations replace every APIC with one JPEG or remove APIC only. */
  it.each([3, 4] as const)(
    'should normalize all artwork while preserving audio and ID3v2.%s',
    async (version) => {
      const s = await makeSUT(version, true);
      const before = await s.helper.read({ key: 'source.mp3' });
      expect(before.coverFrames).toContainEqual(
        expect.objectContaining({ pictureType: 0, mimeType: 'image/webp' }),
      );
      copyFileSync(join(s.root, 'source.mp3'), join(s.root, 'normalize.metadata-pending'));
      const normalized = await s.helper.prepare({
        candidateKey: 'normalize.metadata-pending',
        expectedDigest: before.fullDigest,
        patch: { cover: { op: 'replaceAll', uploadId: 'official-jpeg' } },
        cover: { key: 'new.jpg' },
      });
      expect(normalized.snapshot.id3Version).toBe(version);
      expect(normalized.snapshot.coverFrames).toHaveLength(1);
      expect(normalized.snapshot.coverFrames[0]).toMatchObject({
        pictureType: 3,
        mimeType: 'image/jpeg',
      });
      expect(normalized.snapshot.audio).toEqual(before.audio);
      expect(normalized.snapshot.lyricsFrames).toEqual(before.lyricsFrames);
      const cleared = await s.helper.prepare({
        candidateKey: 'normalize.metadata-pending',
        expectedDigest: normalized.snapshot.fullDigest,
        patch: { cover: { op: 'clearAll' } },
      });
      expect(cleared.snapshot.coverFrames).toEqual([]);
      expect(cleared.snapshot.audio).toEqual(before.audio);
      expect(cleared.snapshot.lyricsFrames).toEqual(before.lyricsFrames);
    },
  );
  /** Untagged audio creates v2.4 while malformed fields, images and attempts to edit originals fail closed. */
  it('should create tags only in a candidate and reject invalid patch or media inputs', async () => {
    const s = await makeSUT(0);
    const before = await s.helper.read({ key: 'source.mp3' });
    expect(before.id3Version).toBe(0);
    const audio = readFileSync(join(s.root, 'source.mp3'));
    const legacyText = Buffer.from([0, ...Buffer.from('Legacy synthetic')]);
    const legacyFrame = Buffer.concat([
      Buffer.from('TT2'),
      Buffer.from([0, 0, legacyText.length]),
      legacyText,
    ]);
    writeFileSync(
      join(s.root, 'legacy.mp3'),
      Buffer.concat([
        Buffer.from([73, 68, 51, 2, 0, 0, 0, 0, 0, legacyFrame.length]),
        legacyFrame,
        audio,
      ]),
    );
    const legacy = await s.helper.read({ key: 'legacy.mp3' });
    expect(legacy).toMatchObject({
      id3Version: 2,
      editable: false,
      reason: 'unsupported_tag_layout',
    });
    copyFileSync(join(s.root, 'legacy.mp3'), join(s.root, 'legacy.metadata-pending'));
    await expect(
      s.helper.prepare({
        candidateKey: 'legacy.metadata-pending',
        expectedDigest: legacy.fullDigest,
        patch: { title: { op: 'set', value: 'Blocked' } },
      }),
    ).rejects.toThrow('unsupported_tag_layout');
    copyFileSync(join(s.root, 'source.mp3'), join(s.root, 'empty.metadata-pending'));
    const result = await s.helper.prepare({
      candidateKey: 'empty.metadata-pending',
      expectedDigest: before.fullDigest,
      patch: { title: { op: 'set', value: 'New synthetic title' } },
    });
    expect(result.snapshot.id3Version).toBe(4);
    await expect(
      s.helper.prepare({
        candidateKey: 'source.mp3',
        expectedDigest: before.fullDigest,
        patch: { title: { op: 'clear' } },
      }),
    ).rejects.toThrow();
    for (const patch of [
      { trackNumber: { op: 'set', value: '4/2' } },
      { year: { op: 'set', value: 'no' } },
      { title: { op: 'mixed' } },
      { lyrics: { op: 'clear' } },
    ])
      await expect(
        s.helper.prepare({
          candidateKey: 'empty.metadata-pending',
          expectedDigest: result.snapshot.fullDigest,
          patch,
        }),
      ).rejects.toThrow('invalid_metadata');
    writeFileSync(join(s.root, 'bad.png'), '<svg>not a raster image</svg>');
    await expect(
      s.helper.prepare({
        candidateKey: 'empty.metadata-pending',
        expectedDigest: result.snapshot.fullDigest,
        patch: { cover: { op: 'set', selector: { kind: 'new' }, uploadId: 'bad-upload' } },
        cover: { key: 'bad.png' },
      }),
    ).rejects.toThrow('invalid_cover');
  });
});
