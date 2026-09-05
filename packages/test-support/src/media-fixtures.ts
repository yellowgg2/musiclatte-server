const SAMPLE_RATE = 8_000;
const DURATION_SECONDS = 2;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function createWaveFixture(): Buffer {
  const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
  const dataLength = sampleCount * CHANNELS * (BITS_PER_SAMPLE / 8);
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(36 + dataLength, 4);
  output.write('WAVEfmt ', 8, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(CHANNELS, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
  output.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  output.writeUInt16LE(BITS_PER_SAMPLE, 34);
  output.write('data', 36, 'ascii');
  output.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE) * 4_096);
    output.writeInt16LE(value, 44 + index * 2);
  }
  return output;
}

/** Original two-second PCM tone generated from a sine formula; no third-party media. */
export const syntheticAudioFixture = createWaveFixture();

/** Original SVG artwork fixture; no third-party image or embedded metadata. */
export const syntheticCoverFixture = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#69508b"/><circle cx="32" cy="32" r="18" fill="#f7f5f2"/><path d="M29 20v27a7 7 0 1 1-3-6V24l18-4v21a7 7 0 1 1-3-6V16z" fill="#292633"/></svg>',
);

export const syntheticMediaMetadata = {
  audioContentType: 'audio/wav',
  coverContentType: 'image/svg+xml',
  etag: '"musiclatte-synthetic-media-v1"',
  lastModified: 'Sat, 05 Sep 2026 00:00:00 GMT',
} as const;
