const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { buildMetadata, loadExisting } = require('../scripts/common');
const { parseProbeJson, failedVideoMetadata } = require('../scripts/media-tools');
const { assertMediaTechnicalFields, assertSha256Hash } = require('../src/shared/media-technical-schema');
const { serializeJsonl } = require('../scripts/library-core');
const { normalizeConfig, DEFAULT_CONFIG } = require('../scripts/application-config');

test('current producers and documented nullable/parser-shaped variants retain exact JSONL bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-manager-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, '照片.png');
  await sharp({ create: { width: 12, height: 8, channels: 3, background: 'red' } }).png().toFile(source);
  const picture = await buildMetadata(source, root);
  const broken = path.join(root, 'broken.jpg'); await fs.writeFile(broken, 'broken');
  const failedPicture = await buildMetadata(broken, root);
  const variants = [picture, failedPicture];
  for (const video of [
    parseProbeJson({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 8 }], format: {} }).video,
    parseProbeJson({ streams: [{ codec_type: 'audio', codec_name: 'aac' }], format: {} }).video,
    failedVideoMetadata(new Error('Decode failed')),
  ]) {
    const item = structuredClone(picture); delete item.Picture;
    item.FilePath = '视频.mp4'; item.FileSystem.FileType = 'video'; item.FileSystem.FileExtension = 'mp4'; item.Video = video; variants.push(item);
  }
  const parserVariant = structuredClone(picture);
  parserVariant.GPS.AltitudeRef = { 0: 1 };
  parserVariant.Camera.ISO = [100, 200];
  parserVariant.FileSystem.ShootingTimeZone = null;
  parserVariant.FileSystem.ShootingTimeStamp = null;
  variants.push(parserVariant);
  for (const item of variants) {
    const before = serializeJsonl([item]);
    assertMediaTechnicalFields(item);
    assert.equal(serializeJsonl([item]), before);
  }
  for (const mutate of [
    item => { item.SHA256Hash = '../escape'; }, item => { delete item.Camera; },
    item => { item.FileSystem.FileType = 'other'; }, item => { item.Picture.Width = '12'; },
    item => { item.Picture.dpi = 72; }, item => { item.Video = {}; },
    item => { item.Camera.FlashUsed = 0; }, item => { item.FileSystem.FileSize = Infinity; },
  ]) {
    const invalid = structuredClone(picture); mutate(invalid);
    assert.throws(() => assertMediaTechnicalFields(invalid));
  }
  const metadata = path.join(root, 'metadata.jsonl');
  await fs.writeFile(metadata, serializeJsonl([{ ...picture, SHA256Hash: '../escape' }]));
  await assert.rejects(loadExisting(metadata), /SHA256Hash/);
  assert.throws(() => assertSha256Hash('../escape'));
});

test('configuration normalizes unsafe numbers without changing valid settings or defaults', () => {
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
  const valid = structuredClone(DEFAULT_CONFIG);
  Object.assign(valid.thumbnail, { size: 200, webpQuality: 91, extremeAspectRatio: 2.5, maxConcurrency: 3 });
  valid.ui.viewer.panelRatio.left = 1.5;
  assert.deepEqual(normalizeConfig(valid), valid);
  const invalid = normalizeConfig({ thumbnail: { size: Infinity, webpQuality: 'bad', maxConcurrency: 2.7 }, backup: { retentionCount: Infinity }, ui: { viewer: { panels: { showLeft: 'false' }, zoom: { minPercent: NaN, maxPercent: Infinity } } } });
  assert.equal(invalid.thumbnail.size, 320); assert.equal(invalid.thumbnail.webpQuality, 80);
  assert.equal(invalid.thumbnail.maxConcurrency, 2); assert.equal(invalid.backup.retentionCount, 10);
  assert.deepEqual(invalid.ui, DEFAULT_CONFIG.ui);
});
