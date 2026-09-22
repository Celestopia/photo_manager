const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({win,library,click,waitFor}) => {
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const covers = path.join(library,'.photo_manager','video_covers');
  const thumbs = path.join(library,'.photo_manager','thumb_cache');
  const files = directory => fs.readdir(directory).catch(error => { if(error.code==='ENOENT') return []; throw error; });
  const openVideo = async () => {
    await evaluate(`Array.from(document.querySelectorAll('.photo-card')).find(e=>e.textContent.includes('viewer-video')).click()`);
    await waitFor(`Boolean(document.querySelector('video'))`);
  };
  const back = async () => {
    await click('[aria-label="Back to Gallery"]');
    await waitFor(`Boolean(document.querySelector('.photo-card'))`);
  };
  const generate = async label => {
    await click('.gallery-settings-trigger');
    await evaluate(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
    await click('.maintenance-options .btn-primary');
    await waitFor(`Boolean(document.querySelector('.maintenance-result-actions'))`);
    await click('.maintenance-result-actions .btn-primary');
  };
  assert.deepEqual(await files(covers),[]);
  assert.deepEqual(await files(thumbs),[]);
  await openVideo();
  await waitFor(`document.querySelector('.viewer-image-status')?.textContent.includes('Video cover unavailable')`);
  assert.deepEqual(await files(covers),[], 'Viewing a missing cover does not generate it');
  await click('.video-center-play-button');
  await waitFor(`document.querySelector('video') && !document.querySelector('video').classList.contains('video-awaiting-frame')`);
  await back();
  assert.deepEqual(await files(covers),[], 'Playback does not persist a cover');
  assert.deepEqual(await files(thumbs),[], 'Browsing does not generate thumbnails');
  await generate('Generate Video Covers');
  const name = (await files(covers)).find(name=>name.endsWith('.webp'));
  assert.ok(name,'Manual generation publishes a cover');
  await openVideo();
  await waitFor(`document.querySelector('.viewer-image')?.naturalWidth===1280`);
  await back();
  await fs.writeFile(path.join(covers,name),'damaged cover');
  // Explicit maintenance invalidates browser resources, allowing the damaged bytes to be read.
  await generate('Generate Thumbnails');
  assert.ok((await files(thumbs)).some(name=>name.endsWith('.webp')));
  await openVideo();
  await waitFor(`document.querySelector('.viewer-image-status')?.textContent.includes('Video cover unavailable')`);
  assert.equal(await fs.readFile(path.join(covers,name),'utf8'),'damaged cover','No automatic repair');
  await back();
  await generate('Generate Video Covers');
  await openVideo();
  await waitFor(`document.querySelector('.viewer-image')?.naturalWidth===1280`);
  console.log('MANUAL_CACHE_SMOKE_PASS: missing and damaged covers remain untouched; playback and explicit cover/thumbnail generation work.');
};
