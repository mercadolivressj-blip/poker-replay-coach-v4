import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { __private } from '../../src/core/pokerstars-numeric-reader.js';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SSJ_SHARP_PATH || '/workspace/scratch/c4c088db694b/repo/node_modules/sharp');

const { commitmentLayout, normalizeBox } = __private;
const [, , video, output] = process.argv;
if (!video || !output) throw new Error('usage: export_browser_numeric_bank.mjs VIDEO1 OUTPUT_JSON');

const commitments = [
  [80.0, 'top', .50], [80.0, 'hero', .25], [128.5, 'top', .25], [128.5, 'rt', .50],
  [212.5, 'rb', .25], [212.5, 'hero', .50], [247.0, 'lb', .50], [247.0, 'hero', .25],
  [269.0, 'rt', .67], [373.0, 'rt', 6.81], [396.0, 'rt', .25], [396.0, 'rb', .50],
  [662.6, 'lt', .25], [721.2, 'lt', 3.75], [752.8, 'lt', 9.50], [769.0, 'lt', 41.75], [877.6, 'lt', .50],
];
const rois = {
  hero: [545, 370, 220, 60], lb: [335, 325, 210, 70], lt: [340, 155, 280, 80],
  top: [575, 130, 210, 80], rt: [735, 155, 220, 80], rb: [755, 325, 220, 75],
};
const tempDir = `/tmp/ssj-numeric-bank-${process.pid}`;
await mkdir(tempDir, { recursive: true });

function ffmpegFrame(timestamp, target) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(timestamp), '-i', video, '-frames:v', '1', '-y', target]);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}
async function frameImage(timestamp) {
  const path = `${tempDir}/${String(timestamp).replace('.', '_')}.png`;
  await ffmpegFrame(timestamp, path);
  const raw = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw.data, width: raw.info.width, height: raw.info.height };
}
function crop(image, [x, y, width, height]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const source = (y + row) * image.width * 4 + x * 4;
    data.set(image.data.subarray(source, source + width * 4), row * width * 4);
  }
  return { data, width, height };
}
const bank = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), []]));
for (const [timestamp, seat, value] of commitments) {
  const image = await frameImage(timestamp);
  const roi = crop(image, rois[seat]);
  const parsed = commitmentLayout(roi);
  if (!parsed.layout) throw new Error(`could not find layout at ${timestamp} ${seat}`);
  const labels = parsed.layout.decimal ? `${Number(value).toFixed(2).replace('.', '')}` : String(Math.round(value));
  if (labels.length !== parsed.layout.boxes.length) throw new Error(`label/layout mismatch ${timestamp} ${seat} ${value}`);
  for (let i = 0; i < labels.length; i++) bank[labels[i]].push(normalizeBox(parsed.binary, roi.width, parsed.layout.boxes[i]));
}
if (Object.values(bank).some(rows => !rows.length)) throw new Error('incomplete digit bank');
await import('node:fs/promises').then(fs => fs.writeFile(output, JSON.stringify({
  version: 'pokerstars-commitment-digits-video1-v1', calibration: 'session-2026-09-20 only', width: 24, height: 32, digits: bank,
}, null, 0) + '\n'));
await rm(tempDir, { recursive: true, force: true });
