/* Run with Electron: node_modules/.bin/electron tests/helpers/chat-ui-smoke.cjs.
   All library/configuration data and the fake provider are isolated to this test. */
const { app, BrowserWindow, dialog, clipboard, shell } = require("electron");
require('../../src/main/viewer-image-resources').registerViewerImageScheme(require('electron').protocol);
const openedSources = [];
shell.openExternal = async url => { openedSources.push(url); };
app.disableHardwareAcceleration();
let copiedText = null;
clipboard.writeText = (value) => { copiedText = value; };
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const yaml = require("js-yaml");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "photo-manager-chat-ui-"));
process.env.APPDATA = path.join(root, "roaming");
process.env.LOCALAPPDATA = path.join(root, "local");
app.setName("Photo Manager Chat Smoke");
const {
  resolveApplicationPaths,
  configureElectronStoragePaths,
} = require("../../src/core/application-paths");
const paths = resolveApplicationPaths();
configureElectronStoragePaths(app, paths);
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.maximize = function () {};
const windowManager = require("../../src/main/window-manager");
const createWindow = windowManager.createMainWindow;
windowManager.createMainWindow = (options) =>
  createWindow(options, {
    electron: {
      dialog,
      BrowserWindow: class extends BrowserWindow {
        constructor(options) {
          super({
            ...options,
            webPreferences: {
              ...options.webPreferences,
              offscreen: true,
              backgroundThrottling: false,
            },
          });
        }
      },
    },
  });
dialog.showMessageBox = async () => ({ response: 1 });
let server, win;
const requests = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (
      win &&
      !win.isDestroyed() &&
      (await win.webContents.executeJavaScript(expression))
    )
      return;
    await sleep(100);
  }
  console.error(
    await win.webContents.executeJavaScript("document.body.innerText"),
  );
  throw new Error("Timed out waiting for " + expression);
}
const click = (selector) =>
  win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
const setValue = (selector, value) =>
  win.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
async function run() {
  const library = path.join(root, "library");
  await fsp.mkdir(library);
  await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#3975c6" },
  })
    .jpeg()
    .toFile(path.join(library, "sample.jpg"));
  await sharp({
    create: { width: 80, height: 60, channels: 3, background: "red" },
  })
    .jpeg()
    .toFile(path.join(library, "second.jpg"));
  const oldDate = new Date("2025-01-01T00:00:00Z");
  await fsp.utimes(path.join(library, "second.jpg"), oldDate, oldDate);
  if (process.env.VIEWER_VISUAL_SMOKE || process.env.MANUAL_CACHE_SMOKE) {
    const { resolveMediaToolPaths, runMediaTool } = require('../../src/core/media-tools');
    const tools = resolveMediaToolPaths(path.resolve('.'), {});
    await runMediaTool(tools.ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(library, 'viewer-video.mp4')]);
    await fsp.utimes(path.join(library, 'viewer-video.mp4'), oldDate, oldDate);
  }
  const { DEFAULT_CONFIG } = require("../../src/core/application-config");
  const { resolveLibraryPaths } = require("../../src/core/library-core");
  await require("../../src/core/init-metadata").run({
    paths: resolveLibraryPaths(library),
    config: structuredClone(DEFAULT_CONFIG),
    logger: { info() {}, warn() {}, error() {} },
  });
  if (process.env.REGISTRY_UI_SMOKE || process.env.BATCH_POPUP_SMOKE || process.env.SHARED_UI_SMOKE) await require('./registry-filter-checks.cjs').prepare(library);
  if (process.env.BATCH_POPUP_SMOKE) await require('./batch-popup-checks.cjs').prepare(library);
  if (process.env.VIEWER_VISUAL_SMOKE) await require('../../src/core/build-video-covers').run({paths:resolveLibraryPaths(library),config:structuredClone(DEFAULT_CONFIG),logger:{info(){},warn(){},error(){}}});
  const metadata = await fsp.readFile(
    path.join(library, ".photo_manager", "data", "photo_metadata.jsonl"),
  );
  await fsp.writeFile(
    paths.stateFile,
    JSON.stringify({ lastLibraryPath: library }),
  );
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request=JSON.parse(body);
    requests.push(request);
    const latestUser=request.messages.filter(m=>m.role==='user').at(-1);
    if (JSON.stringify(latestUser).includes('WEB TOOL TEST')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const outcomes = request.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
      const source = outcomes.find(o => o.sources)?.sources[0];
      const name = source ? 'read_web_page' : 'web_search';
      const done = outcomes.some(o => o.text);
      const delta = done ? { content: `The Eiffel Tower is in Paris [source:${source.sourceId}].` } : { tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(source ? { sourceId: source.sourceId } : { query: 'Eiffel Tower' }) } }] };
      res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: done ? 'stop' : 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
      return;
    }
    if(JSON.stringify(latestUser).includes('AGENT TOOL TEST')) {
      res.writeHead(200, { 'Content-Type':'text/event-stream' });
      const catalog=request.messages.find(m=>m.role==='system' && m.content.startsWith('Authorized target catalog'));
      const mediaId=JSON.parse(catalog.content.slice(catalog.content.indexOf('[')))[0].mediaId;
      const done=request.messages.at(-1).role==='tool';
      const delta=done?{content:'Suggestions are ready for your review.'}:{tool_calls:[
        {index:0,id:'title-review',type:'function',function:{name:'propose_title',arguments:JSON.stringify({mediaId,title:'Reviewed title'})}},
        {index:1,id:'description-review',type:'function',function:{name:'propose_description',arguments:JSON.stringify({mediaId,description:'Decline this description'})}}
      ]};
      const finish = () => res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:done?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
      if (done) setTimeout(finish, 1200); else finish();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  "你好！ **Blue image**\n\n- A simple test photo\n- No metadata edits",
              },
            },
          ],
        }) +
        "\n\n",
    );
    if (body.includes("STOP TEST")) {
      const timer = setTimeout(() => res.end("data: [DONE]\n\n"), 15000);
      res.on("close", () => clearTimeout(timer));
    } else res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { DEFAULT } = require("../../src/main/chat/provider");
  await fsp.writeFile(
    paths.chatProviderFile,
    yaml.dump({
      ...DEFAULT,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: "test-only",
    }),
  );
  const searchProvider = require('../../src/main/chat/search-provider');
  const originalAdapter = searchProvider.adapter;
  searchProvider.adapter = c => originalAdapter(c, async url => new Response(JSON.stringify({ results: [url.endsWith('/search')
    ? { title: 'The Eiffel Tower — official visitor information', url: 'https://www.toureiffel.paris/en', content: 'The Eiffel Tower is a landmark in Paris.' }
    : { url: 'https://www.toureiffel.paris/en', raw_content: 'The Eiffel Tower is in Paris, France.' }], usage: { credits: 0.2 } })));
  require("../../src/main/main");
  for (let n = 0; n < 100 && !win; n++) {
    win = BrowserWindow.getAllWindows()[0];
    await sleep(100);
  }
  await waitFor(
    `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Open library'&&!b.disabled))`,
  );
  if (process.env.LIBRARY_UI_SMOKE) {
    await sleep(250);
    await fsp.writeFile(path.resolve('release/library-entry-v0383.png'), (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Open library').click()`,
  );
  await waitFor(`Boolean(document.querySelector('.photo-card'))`);
  if (process.env.ETA_SMOKE) {
    await click('.gallery-settings-trigger');
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('.gallery-settings-menu button')].find(b => b.textContent.includes('Generate Thumbnails')).click()`);
    await click('.maintenance-options .btn-primary');
    await waitFor(`Boolean(document.querySelector('.maintenance-progress .library-helper')?.textContent.includes('Elapsed:')) || document.querySelector('.maintenance-progress')?.textContent.includes('Elapsed:')`);
    await waitFor(`Boolean(document.querySelector('.maintenance-result-actions'))`);
    assert.match(await win.webContents.executeJavaScript(`document.querySelector('.maintenance-progress').textContent`), /Elapsed: \d+s/);
    console.log('ETA_SMOKE_PASS: maintenance elapsed time remains in the completed dialog.');
    return;
  }
  if (process.env.LOGGING_SMOKE) {
    const result = await win.webContents.executeJavaScript(`window.photoManagerApi.startMaintenance({ operation: 'video-covers', force: false })`);
    assert.equal(result.ok, true);
    await win.webContents.executeJavaScript(`window.photoManagerApi.closeLibrary()`);
    const logDir = path.join(library, '.photo_manager', 'logs');
    const logs = (await Promise.all((await fsp.readdir(logDir)).filter(name => name.endsWith('.log')).map(name => fsp.readFile(path.join(logDir, name), 'utf8')))).join('');
    assert.match(logs, /event="start" operation="video-covers"/);
    assert.match(logs, /event="complete" operation="video-covers".*generated=0.*outcome="success"/);
    assert.match(logs, /event="library-open"/);
    assert.match(logs, /event="library-close"/);
    console.log('LOGGING_SMOKE_PASS: real worker start, summary and library close destination.');
    return;
  }
  if (process.env.SHARED_UI_SMOKE) {
    await require('./shared-ui-checks.cjs')({win, click, waitFor, setValue});
    return;
  }
  if (process.env.DIALOG_SHELL_SMOKE) {
    await require('./dialog-shell-checks.cjs')({win, click, waitFor, setValue});
    return;
  }
  if (process.env.ESCAPE_UI_SMOKE) {
    await require('./escape-popup-checks.cjs')({win, click, waitFor, setValue});
    return;
  }
  if (process.env.MANUAL_CACHE_SMOKE) {
    await require('./manual-cache-checks.cjs')({win,library,click,waitFor});
    return;
  }
  if (process.env.BATCH_POPUP_SMOKE) {
    await require('./batch-popup-checks.cjs')({win, click, waitFor, setValue});
    return;
  }
  if (process.env.REGISTRY_UI_SMOKE) {
    await require('./registry-filter-checks.cjs').check({win, click, waitFor, setValue});
    return;
  }
  if (process.env.LIBRARY_UI_SMOKE) {
    await require('./library-dialog-checks.cjs')({ win, library, click, waitFor, setValue });
    assert.deepEqual(await fsp.readFile(path.join(library, '.photo_manager', 'data', 'photo_metadata.jsonl')), metadata);
    return;
  }
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-controls-toggle').getAttribute('aria-expanded')`), 'true');
  await click('.gallery-controls-toggle');
  await waitFor(`!document.querySelector('#gallery-filter-panel')`);
  await click('.gallery-controls-toggle');
  await waitFor(`Boolean(document.querySelector('#gallery-filter-panel'))`);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-controls-toggle').getBoundingClientRect().top >= document.querySelector('#gallery-filter-panel').getBoundingClientRect().bottom - 1`), true);

  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.gallery-footer'))`), false);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-brand')?.textContent`), 'Photo Manager');
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.gallery-header-tools [aria-label="Reset gallery"]'))`), true);
  await click('.gallery-settings-trigger');
  await waitFor(`Boolean(document.querySelector('.gallery-settings-menu'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-settings-menu').getBoundingClientRect().top > document.querySelector('.gallery-settings-trigger').getBoundingClientRect().bottom`), true);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(b => b.textContent.includes('LLM Provider Settings')).click()`);
  await waitFor(`Boolean(document.querySelector('.provider-dialog[open] input[type=password]'))`);
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.gallery-settings-menu'))`), false);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog').textContent.includes('Stream responses')`), false);
  await setValue('.provider-fields input[type=url]', 'https://changed.example/v1');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog footer button').disabled`), true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-footnote').textContent.includes('Save changes before testing')`), true);
  await click('.provider-dialog [aria-label="Close dialog"]');
  await click(".photo-card");
  await waitFor(`Boolean(document.querySelector('.viewer-sidebar-tabs'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.parameters-toggle').getAttribute('aria-expanded')`), 'false');
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.left-panel .viewer-sidebar-tabs')) && !document.querySelector('.right-panel .viewer-sidebar-tabs')`), true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.right-panel .registry-field-icon').length`), 4);
  const titleHeight = await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').getBoundingClientRect().height`);
  await setValue('.viewer-title-input', 'Unicode title 首钢园\nSecond line');
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').getBoundingClientRect().height`) > titleHeight, 'Title grows for multiline stored text');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').value.includes('\\n')`), true, 'Wrapping must not destroy stored line breaks');
  await require('./title-wrap-checks.cjs')({win,setValue,click,waitFor});
  if (process.env.TITLE_UI_SMOKE) return;
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.viewer-left-tools button').textContent.trim()`), '', 'Delete stays icon-only');
  await fsp.mkdir(path.resolve('release'), { recursive: true });
  await sleep(400);
  await fsp.writeFile(path.resolve('release/viewer-photo-v036.png'), (await win.webContents.capturePage()).toPNG());
  if (process.env.VIEWER_VISUAL_SMOKE) {
    await click('.inline-feedback .btn:not(.btn-primary)');
    await click('.parameters-toggle');
    await click('.nav-btn.right');
    await sleep(300);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.parameters-toggle').getAttribute('aria-expanded')`), 'true', 'Parameter expansion survives media navigation');
    await click('.nav-btn.left');
    await sleep(300);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.parameters-toggle').getAttribute('aria-expanded')`), 'true');
    const panelsFit = () => win.webContents.executeJavaScript(`['.left-panel','.right-panel'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})`);
    const mediaSource = () => win.webContents.executeJavaScript(`document.querySelector('.image-stage video')?.src || document.querySelector('.image-stage img')?.src`);
    const arrow = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(250);
    };
    for (const selector of ['.parameters-toggle', '.viewer-tools button', '.viewer-sidebar-tabs button:first-child', '.viewer-detail-toggle', '.viewer-sidebar-tabs button:last-child']) {
      const before = await mediaSource();
      await win.webContents.executeJavaScript(`{const button=document.querySelector(${JSON.stringify(selector)});button.focus();button.click();}`);
      await arrow('Right');
      assert.notEqual(await mediaSource(), before, `Arrow navigates after ${selector}`);
      await arrow('Left');
      assert.equal(await mediaSource(), before);
      if (selector === '.viewer-detail-toggle') await click(selector);
    }
    await click('.viewer-sidebar-tabs button:first-child');
    const beforeNavButton = await mediaSource();
    await win.webContents.executeJavaScript(`{const button=document.querySelector('.nav-btn.right');button.focus();button.click();}`);
    await arrow('Left');
    assert.equal(await mediaSource(), beforeNavButton, 'Arrows work after navigation button clicks');
    const beforeInput = await mediaSource();
    await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').focus()`);
    await arrow('Right');
    assert.equal(await mediaSource(), beforeInput, 'Text field owns arrows');
    await win.webContents.executeJavaScript(`document.querySelector('.viewer-tools input[type=range]').focus()`);
    await arrow('Right');
    assert.equal(await mediaSource(), beforeInput, 'Zoom slider owns arrows');
    await win.webContents.executeJavaScript(`document.activeElement.blur()`);
    for (const [width,height] of [[1280,720],[1920,1080]]) {
      win.setSize(width,height); await sleep(500);
      assert.equal(await panelsFit(), true, 'Side panels must not overflow horizontally');
      assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').getBoundingClientRect().height`), titleHeight);
    }
    await fsp.writeFile(path.resolve('release/viewer-photo-v036.png'), (await win.webContents.capturePage()).toPNG());
    await click('.topbar .left-tools button');
    await waitFor(`Boolean(document.querySelector('.photo-card'))`);
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('.photo-card')].find(e=>e.textContent.includes('viewer-video')).click()`);
    await waitFor(`Boolean(document.querySelector('video')) && document.querySelector('video').readyState >= 1`);
    await waitFor(`document.querySelector('.viewer-image-surface .viewer-image')?.naturalWidth === 1280`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.viewer-image-surface .viewer-image').src.startsWith('viewer-image://')`), true);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('video').hasAttribute('poster')`), false);
    const coverFiles = await fsp.readdir(path.join(library, '.photo_manager', 'video_covers'));
    const coverFile = path.join(library, '.photo_manager', 'video_covers', coverFiles.find(name => name.endsWith('.webp')));
    const coverModified = (await fsp.stat(coverFile)).mtimeMs;
    await sleep(500);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.parameters-toggle').getAttribute('aria-expanded')`), 'false', 'Reopening the viewer resets parameter expansion');
    assert.equal(await win.webContents.executeJavaScript(`(()=>{const stage=document.querySelector('.image-stage').getBoundingClientRect();const video=document.querySelector('video').getBoundingClientRect();return video.width<=stage.width*.89 && video.height<=stage.height*.89})()`), true, 'Video fits inside the padded stage');
    assert.equal(await panelsFit(), true);
    assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.viewer-tools [data-tip="Open in system player"]'))`), true);
    await fsp.writeFile(path.resolve('release/viewer-video-v036.png'), (await win.webContents.capturePage()).toPNG());
    await click('.video-center-play-button');
    await waitFor(`!document.querySelector('video').paused`);
    await waitFor(`!document.querySelector('video').classList.contains('video-awaiting-frame')`);
    await win.webContents.executeJavaScript(`document.querySelector('video').pause()`);
    const playingSource = await mediaSource();
    await win.webContents.executeJavaScript(`document.querySelector('.parameters-toggle').focus()`);
    await arrow('Right');
    assert.equal(await mediaSource(), playingSource, 'After playback arrows seek without navigating');
    assert.ok(await win.webContents.executeJavaScript(`document.querySelector('video').currentTime > 0.5`));
    await arrow('Left');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('video').currentTime`), 0);
    await arrow('Left', ['shift']);
    assert.notEqual(await mediaSource(), playingSource, 'Shift arrows navigate after playback');
    await arrow('Right', ['shift']);
    assert.equal(await mediaSource(), playingSource);
    await arrow('Left');
    assert.notEqual(await mediaSource(), playingSource, 'Before playback arrows navigate');
    await arrow('Right');
    await click('[aria-label="Expand privacy level"]');
    await waitFor(`document.querySelector('.viewer-image-surface .viewer-image')?.naturalWidth === 1280`);
    assert.equal((await fsp.stat(coverFile)).mtimeMs, coverModified, 'Returning to a video reuses its cover without extraction');
    // Slow decode exposes blank-frame regressions even with a warm filesystem cache.
      await win.webContents.executeJavaScript(`window.originalViewerDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = async function() { await window.originalViewerDecode.call(this); await new Promise(r => setTimeout(r, 300)); }; void 0;`);
      for (const direction of ['left', 'right']) {
        const continuity = await win.webContents.executeJavaScript(`new Promise(resolve => {
          let blank = 0, samples = 0; const start = performance.now();
          document.querySelector('.nav-btn.${direction}').click();
          function sample() {
            const visible = [...document.querySelectorAll('.viewer-image')].some(img => img.naturalWidth && getComputedStyle(img).visibility === 'visible');
            if (!visible) blank++; samples++;
            if (performance.now() - start < 450) requestAnimationFrame(sample); else resolve({ blank, samples });
          } requestAnimationFrame(sample);
        })`);
        assert.equal(continuity.blank, 0, 'Keep the displayed image during delayed decode');
        assert.ok(continuity.samples > 2);
      }
      await click('.video-center-play-button');
      await waitFor(`document.querySelector('video') && !document.querySelector('video').classList.contains('video-awaiting-frame')`);
      await win.webContents.executeJavaScript(`window.outgoingVideo = document.querySelector('video'); document.querySelector('.nav-btn.left').click();`);
      await waitFor(`document.querySelector('.viewer-held-frame')?.width > 0`);
      assert.equal(await win.webContents.executeJavaScript(`window.outgoingVideo.paused && !window.outgoingVideo.hasAttribute('src')`), true, 'Release the decoder while retaining a display-sized frame');
      await waitFor(`document.querySelector('.viewer-held-frame')?.width === 0 && document.querySelector('.viewer-image-surface').getAttribute('aria-busy') === 'false'`);
      await win.webContents.executeJavaScript(`document.querySelector('.nav-btn.right').click(); setTimeout(() => document.querySelector('.nav-btn.left').click(), 30);`);
      await sleep(450);
      assert.equal(await win.webContents.executeJavaScript(`[...document.querySelectorAll('.viewer-image')].filter(img => getComputedStyle(img).visibility === 'visible').length`), 1, 'Rapid switching keeps only the latest decoded image');
      assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('video'))`), false);
      await win.webContents.executeJavaScript(`HTMLImageElement.prototype.decode = window.originalViewerDecode; delete window.originalViewerDecode; delete window.outgoingVideo;`);
      await click('.nav-btn.right');
      await waitFor(`document.querySelector('.viewer-image-surface').getAttribute('aria-busy') === 'false'`);
      await win.webContents.executeJavaScript(`window.originalViewerDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function() { return this.classList.contains('viewer-image') ? Promise.reject(new Error('Test decode failure')) : window.originalViewerDecode.call(this); }; void 0;`);
      await click('.nav-btn.left');
      await waitFor(`document.querySelector('.viewer-image-status')?.textContent === 'Image unavailable'`);
      assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.viewer-image').length`), 0, 'A failed replacement must not leave misleading old pixels');
      await win.webContents.executeJavaScript(`HTMLImageElement.prototype.decode = window.originalViewerDecode; delete window.originalViewerDecode;`);
      await click('.nav-btn.right');
      await waitFor(`document.querySelector('.viewer-image-surface').getAttribute('aria-busy') === 'false'`);
      const timings = [];
    for (let sample = 0; sample < 3; sample++) {
      for (const direction of ['left', 'right']) {
        timings.push(await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
          const start=performance.now();
          const finish=event=>{if(!event.target.classList?.contains('viewer-image'))return;
            document.removeEventListener('load',finish,true);clearTimeout(timer);
            requestAnimationFrame(()=>resolve({kind:'${direction === 'right' ? 'cover' : 'photo'}',ms:Math.round(performance.now()-start)}));};
          const timer=setTimeout(()=>{document.removeEventListener('load',finish,true);reject(new Error('Image timing timeout'));},5000);
          document.addEventListener('load',finish,true);document.querySelector('.nav-btn.${direction}').click();
        })`));
      }
    }
    console.log('VIEWER_IMAGE_TIMINGS', JSON.stringify(timings));
    await waitFor(`document.querySelectorAll('.privacy-level-btn svg').length === 5`);
    await sleep(150);
    await fsp.writeFile(path.resolve('release/viewer-video-v036.png'), (await win.webContents.capturePage()).toPNG());
    await click('.viewer-sidebar-tabs button:last-child');
    await waitFor(`Boolean(document.querySelector('.left-panel .chat-panel'))`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.right-panel .viewer-title-input').getBoundingClientRect().height > 0`), true);
    console.log('VIEWER_VISUAL_SMOKE_PASS: photo/video, two window sizes, title, fields, footer and Assistant.');
    return;
  }
  await setValue(".viewer-title-input", "Unsaved draft title");
  await click(".viewer-sidebar-tabs button:last-child");
  await waitFor(`Boolean(document.querySelector('.chat-composer .chat-attachment-tile'))`);
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.left-panel .chat-panel')) && document.querySelector('.right-panel .viewer-title-input').getBoundingClientRect().height > 0`), true, 'Assistant and Customization remain visible together');
  await waitFor(`document.querySelector('.chat-composer .chat-attachment-tile img')?.naturalWidth > 0`);
  await click('.chat-composer .chat-attachment-tile.is-previewable > img');
  await waitFor(`document.querySelector('.chat-image-preview-dialog[open] img')?.naturalWidth > 160`);
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.chat-image-preview-dialog img')).borderTopWidth`), '6px');
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.chat-image-preview-dialog'), '::backdrop').backdropFilter.includes('blur')`), true);
  await click('.chat-image-preview-dialog');
  await waitFor(`!document.querySelector('.chat-image-preview-dialog')`);

  await click('[aria-label="Options"]');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.chat-options fieldset input[type=checkbox]').length`), 5);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.chat-options details').length`), 0);
  await fsp.mkdir(path.resolve('release'), { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/message-options.png'), (await win.webContents.capturePage()).toPNG());

  await click('[aria-label="Provider settings"]');
  await waitFor(`Boolean(document.querySelector('.provider-dialog[open] input[type=password]'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog input[type=password]').value`), '');
  await click('.provider-dialog .btn-primary');
  await waitFor(`document.querySelector('.provider-dialog')?.textContent.includes('Settings saved.')`);
  await fsp.mkdir(path.resolve('release'), { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/provider-settings.png'), (await win.webContents.capturePage()).toPNG());
  await click('.provider-dialog [aria-label="Close dialog"]');

  assert.equal(
    requests.length,
    0,
    "Opening Assistant must not contact the provider",
  );
  await setValue(".chat-composer textarea", "Describe this photo");
  await win.webContents.executeJavaScript(
    `document.querySelector('.chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))`,
  );
  assert.equal(requests.length, 0, "IME Enter must not send");
  await win.webContents.executeJavaScript(
    `document.querySelector('.chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await waitFor(`Boolean(document.querySelector('.chat-markdown strong'))`);
  await waitFor(`document.querySelector('.chat-sent-tiles img')?.naturalWidth > 0`);
  await click('.chat-sent-tiles .chat-attachment-tile.is-previewable > img');
  await waitFor(`document.querySelector('.chat-image-preview-dialog[open] img')?.naturalWidth > 160`);
  await click('[aria-label="Close image preview"]');
  await waitFor(`!document.querySelector('.chat-image-preview-dialog')`);
  await click('.assistant .chat-message-copy');
  await waitFor(`document.querySelector('.assistant .chat-message-copy')?.getAttribute('aria-label') === 'Copied'`);
  assert.ok(copiedText.includes('**'), 'Copy preserves raw Markdown');
  await click('.user .chat-message-copy');
  await waitFor(`document.querySelector('.user .chat-message-copy')?.getAttribute('aria-label') === 'Copied'`);
  assert.equal(copiedText, 'Describe this photo');
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('[aria-label="Message details"]'))`), false);

  await waitFor(
    `document.querySelector('.chat-composer .btn-primary')?.getAttribute('aria-label')==='Send message'`,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.querySelector('.chat-markdown strong').textContent`,
    ),
    "Blue image",
  );
  assert.equal(requests.length, 1);
  assert.equal(
    JSON.parse(requests[0].messages.filter(m=>m.role==='user').at(-1).content[1].text).metadata.title,
    "",
  );
  await click(".viewer-sidebar-tabs button:first-child");
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.querySelector('.viewer-title-input').value`,
    ),
    "Unsaved draft title",
  );
  // Restore the empty draft before navigating; this test must not save metadata.
  await setValue(".viewer-title-input", "");
  await click(".viewer-sidebar-tabs button:last-child");
  await click('[aria-label="Options"]');
  await click('button[aria-label="Add attachments"]');
  await click(".chat-attachment-menu button");
  await click('[aria-label="Options"]');
  await waitFor(`Boolean(document.querySelector('.chat-composer .chat-attachment-tile'))`);
  await win.webContents.executeJavaScript(
    `const e=document.querySelector('.chat-options select');e.value='original';e.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await waitFor(
    `document.querySelector('.chat-composition').textContent.includes('Original file: larger upload')`,
  );
  await click('[aria-label="Close options"]');
  await setValue(".chat-composer textarea", "Original please");
  await click(".chat-composer .btn-primary");
  await waitFor(
    `document.querySelectorAll('.chat-markdown strong').length===2`,
  );
  await waitFor(
    `document.querySelector('.chat-composer .btn-primary')?.getAttribute('aria-label')==='Send message'`,
  );
  const upload = requests[1].messages
    .filter(m=>m.role==='user').at(-1)
    .content.find((c) => c.type === "image_url");
  assert.deepEqual(
    Buffer.from(upload.image_url.url.split(",")[1], "base64"),
    await fsp.readFile(path.join(library, "sample.jpg")),
  );
  await setValue(".chat-composer textarea", "STOP TEST");
  await click(".chat-composer .btn-primary");
  await waitFor(
    `document.querySelectorAll('.chat-markdown strong').length===3`,
  );
  await click(".nav-btn.right");
  await waitFor(
    `document.querySelector('.left-panel dd')?.textContent==='second.jpg'`,
  );
  await waitFor(
    `document.querySelector('.chat-composer .chat-attachment-tile')?.getAttribute('title') === 'second.jpg'`,
  );
  assert.equal(await win.webContents.executeJavaScript(
    `document.querySelectorAll('.chat-markdown strong').length`), 0,
    "Navigation opens a fresh draft");
  await click('[aria-label="History"]');
  await waitFor(`Boolean(document.querySelector('.chat-history-open'))`);
  await click(".chat-history-open");
  await waitFor(
    `document.querySelectorAll('.chat-markdown strong').length===3`,
  );
  await win.webContents.executeJavaScript(`(()=>{
    const host=document.querySelector('.chat-conversation');
    const item=document.createElement('article'); item.className='chat-message'; item.id='overflow-probe';
    item.innerHTML='<div class="chat-markdown"><p>'+ '长文本 LongText'.repeat(80) +'</p><pre><code>'+ 'wide-code-'.repeat(150) +'</code></pre><table><tbody><tr>'+ '<td>Column content</td>'.repeat(30) +'</tr></tbody></table></div>';
    host.append(item);
  })()`);
  assert.equal(await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.chat-conversation');return el.scrollWidth <= el.clientWidth+1})()`), true, 'Markdown must not widen the conversation');
  assert.equal(await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('#overflow-probe pre');return el.scrollWidth > el.clientWidth})()`), true, 'Wide code remains locally scrollable');
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.chat-conversation')).overflowX`), 'hidden');
  await win.webContents.executeJavaScript(`(()=>{const host=document.querySelector('.chat-conversation');host.style.width='281.5px';host.style.height='240px';host.style.flex='none';document.querySelector('#overflow-probe').insertAdjacentHTML('beforeend','<p>'+ '（注：目前官方并未发布内容，此图极大概率是自制模组。）'.repeat(30) +'</p>');host.scrollTop=host.scrollHeight;})()`);
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.chat-conversation')).overflowX`), 'hidden', 'Fractional widths and CJK punctuation must not enable transcript horizontal scrolling');
  await win.webContents.executeJavaScript(`(()=>{const host=document.querySelector('.chat-conversation');host.style.width='';host.style.height='';host.style.flex='';document.querySelector('#overflow-probe').remove();})()`);
  assert.equal(await win.webContents.executeJavaScript(`(()=>{const a=document.querySelector('.chat-message.assistant .chat-message-actions');const r=[...a.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return Math.abs(r[0].top-r[1].top)<1 && r[0].height===r[1].height})()`), true);
  assert.equal(await win.webContents.executeJavaScript(`(()=>{const a=document.querySelector('[aria-label="Session token usage"]').getBoundingClientRect();const b=document.querySelector('[aria-label="New chat"]').getBoundingClientRect();return a.height===b.height && Math.abs(a.top-b.top)<1})()`), true);
  await click('[aria-label="Session token usage"]');
  await waitFor(`Boolean(document.querySelector('.usage-menu'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.usage-menu').textContent.includes('Input (cache hit)')`), true);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await waitFor(`!document.querySelector('.usage-menu')`);
  await click('[aria-label="Token usage"]');
  await waitFor(`Boolean(document.querySelector('.usage-menu'))`);
  await win.webContents.executeJavaScript(`document.body.click()`);
  await waitFor(`!document.querySelector('.usage-menu')`);
  const pasted = Array.from(
    await sharp({
      create: { width: 20, height: 12, channels: 3, background: "red" },
    })
      .png()
      .toBuffer(),
  );
  await win.webContents.executeJavaScript(
    `(()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(${JSON.stringify(pasted)})],'pasted.png',{type:'image/png'}));document.querySelector('.chat-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));})()`,
  );
  await waitFor(`Boolean(document.querySelector('.chat-composer .chat-attachment-tile'))`);
  await fsp.mkdir(path.resolve("release"), { recursive: true });
  await sleep(300);
  await fsp.writeFile(
    path.resolve("release/chat-smoke.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click('[aria-label="History"]');
  await waitFor(`Boolean(document.querySelector('.chat-history-item .btn'))`);
  await win.webContents.executeJavaScript(`document.querySelector('.chat-history-actions .btn').click()`);
  await setValue('.conversation-action-dialog input', 'Renamed conversation');
  await click('.conversation-action-dialog .btn-primary');
  await waitFor(`document.querySelector('.chat-history-open strong')?.textContent === 'Renamed conversation'`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/chat-history.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.chat-history-heading-actions button')).find(b=>b.textContent==='Select').click()`);
  await click('[aria-label="Select all conversations"]');
  await waitFor(`document.querySelector('.chat-selection-summary').textContent.includes('1 selected')`);
  await fsp.writeFile(path.resolve('release/chat-history-selection.png'), (await win.webContents.capturePage()).toPNG());
  await click('.chat-selection-footer .chat-danger');
  await waitFor(`Boolean(document.querySelector('.conversation-action-dialog[open]'))`);
  await click('.conversation-action-dialog footer button');
  await waitFor(`!document.querySelector('.conversation-action-dialog[open]')`);
  await click('.chat-selection-footer .chat-danger');
  await waitFor(`Boolean(document.querySelector('.conversation-action-dialog[open]'))`);
  await click(".conversation-action-dialog .danger-delete-btn");
  await waitFor(
    `document.querySelector('.chat-history')?.textContent.includes('No saved chats.')`,
  );
  assert.deepEqual(
    await fsp.readFile(
      path.join(library, ".photo_manager", "data", "photo_metadata.jsonl"),
    ),
    metadata,
  );
  assert.equal(
    (
      await fsp.readdir(
        path.join(library, ".photo_manager", "chat", "sessions"),
      )
    ).length,
    0,
  );
  await click('[aria-label="Provider settings"]');
  await waitFor(`Boolean(document.querySelector('.provider-dialog[open] input[type=password]'))`);
  const heightBeforeTest = await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog').getBoundingClientRect().height`);
  await click('.provider-dialog footer button');
  await waitFor(`document.querySelector('.provider-banner-success')?.textContent.includes('Connection successful')`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog').getBoundingClientRect().height`), heightBeforeTest);
  const closePoint = await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[aria-label="Dismiss notification"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseDown', ...closePoint, button:'left', clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp', ...closePoint, button:'left', clickCount:1});
  await waitFor(`!document.querySelector('.provider-banner')`);
  await click('.provider-dialog footer button');
  await waitFor(`Boolean(document.querySelector('.provider-banner-success'))`);
  await sleep(10300);
  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.provider-banner'))`), false);

  await click('.provider-dialog [aria-label="Close dialog"]');
  await click('[aria-label="New chat"]');
  await waitFor(`document.querySelectorAll('.chat-suggestions button').length===4`);
  const beforeStarter=requests.length;
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.chat-suggestions button')].find(b=>b.textContent.trim()==='Suggest a title').click()`);
  assert.equal(requests.length,beforeStarter);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.chat-composer textarea').value.includes('title')`));
  await click('.viewer-sidebar-tabs button:first-child');
  await setValue('.viewer-title-input','Unsaved review draft');
  await click('.viewer-sidebar-tabs button:last-child');
  await setValue('.chat-composer textarea','AGENT TOOL TEST');
  await click('.chat-composer .btn-primary');
  await waitFor(`document.querySelectorAll('.chat-proposal').length===2`);
  await click('.viewer-sidebar-tabs button:first-child');
  await sleep(1600);
  await click('.viewer-sidebar-tabs button:last-child');
  await waitFor(`document.querySelectorAll('.chat-proposal').length===2 && document.querySelector('[aria-label="Send message"]')`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.chat-conversation').textContent.includes('Reply stopped.')`),false);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.chat-conversation').textContent.includes('Suggestions are ready for your review.')`),true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.chat-proposal .btn-primary').disabled`),true);
  assert.deepEqual(await fsp.readFile(path.join(library,'.photo_manager','data','photo_metadata.jsonl')),metadata);
  await click('.viewer-sidebar-tabs button:first-child');
  await setValue('.viewer-title-input','');
  await click('.viewer-sidebar-tabs button:last-child');
  await waitFor(`!document.querySelector('.chat-proposal .btn-primary').disabled`);
  await click('.chat-proposal .btn-primary');
  await waitFor(`document.querySelector('.chat-proposal [role="status"]').textContent==='Accepted'`);
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.chat-proposal button')].find(b=>b.textContent.trim()==='Decline').click()`);
  await waitFor(`[...document.querySelectorAll('.chat-proposal [role="status"]')].some(e=>e.textContent==='Declined')`);
  const saved=(await fsp.readFile(path.join(library,'.photo_manager','data','photo_metadata.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(saved.find(m=>m.FilePath==='second.jpg').Customization.Title,'Reviewed title');
  assert.notEqual(saved.find(m=>m.FilePath==='second.jpg').Customization.Description,'Decline this description');
  await click('.viewer-sidebar-tabs button:first-child');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.viewer-title-input').value`),'Reviewed title');
  await click('.viewer-sidebar-tabs button:last-child');
  await fsp.writeFile(path.resolve('release/chat-tools.png'),(await win.webContents.capturePage()).toPNG());

  await click('[aria-label="New chat"]');
  await waitFor(`document.querySelector('[aria-label="Web search"]').getAttribute('aria-pressed') === 'false' && !document.querySelector('[aria-label="Web search"]').disabled`);
  await click('[aria-label="Web search"]');
  await waitFor(`document.querySelector('.provider-tabs [aria-selected="true"]')?.textContent === 'Web search'`);
  await setValue('.provider-dialog input[type=password]', 'test-search-only');
  await click('.provider-dialog .btn-primary');
  await waitFor(`Boolean(document.querySelector('.provider-banner-success'))`);
  await click('.provider-dialog footer button');
  await waitFor(`document.querySelector('.provider-banner-success')?.textContent.includes('extraction succeeded')`);
  await fsp.writeFile(path.resolve('release/web-settings.png'), (await win.webContents.capturePage()).toPNG());
  await click('.provider-dialog [aria-label="Close dialog"]');
  if (process.env.VIEWER_VISUAL_SMOKE) {
    await click('.gallery-settings-trigger');
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(b => b.textContent.includes('Generate Video Covers')).click()`);
    await waitFor(`Boolean(document.querySelector('.maintenance-options'))`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.maintenance-options input[type=checkbox]').checked`), false);
    await click('.maintenance-options .btn-primary');
    await waitFor(`Boolean(document.querySelector('.maintenance-progress .btn-primary'))`);
    assert.equal(await win.webContents.executeJavaScript(`JSON.parse(document.querySelector('.maintenance-progress pre').textContent).generated`), 1);
    await click('.maintenance-progress .btn-primary');
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 1) {
        const manifestPath = path.join(library, '.photo_manager', 'thumb_cache', 'cache_manifest.json');
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        manifest.GeneratorVersion = 0;
        await fsp.writeFile(manifestPath, JSON.stringify(manifest));
      }
      await click('.gallery-settings-trigger');
      await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(b => b.textContent.includes('Generate Thumbnails')).click()`);
      await waitFor(`Boolean(document.querySelector('.maintenance-options'))`);
      assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.maintenance-options input[type=checkbox]').checked`), false);
      await click('.maintenance-options .btn-primary');
      await waitFor(`Boolean(document.querySelector('.maintenance-progress .btn-primary'))`);
      const stats = await win.webContents.executeJavaScript(`JSON.parse(document.querySelector('.maintenance-progress pre').textContent)`);
      assert.equal(stats.failed, 0);
      assert.equal(stats.force, pass < 2);
      assert.equal(stats.generated > 0, pass < 2);
      await click('.maintenance-progress .btn-primary');
    }
  }
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Web search"]').getAttribute('aria-pressed')`), 'false');
  await click('[aria-label="Web search"]');
  await waitFor(`document.querySelector('[aria-label="Web search"]').getAttribute('aria-pressed') === 'true'`);
  await setValue('.chat-composer textarea', 'WEB TOOL TEST');
  await click('[aria-label="Send message"]');
  await waitFor(`Boolean(document.querySelector('.chat-source-citation')) && Boolean(document.querySelector('[aria-label="Send message"]'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Web search"]').getAttribute('aria-pressed')`), 'true');
  await click('.chat-source-citation');
  for (let i = 0; !openedSources.length && i < 100; i++) await sleep(20);
  assert.deepEqual(openedSources, ['https://www.toureiffel.paris/en']);
  await fsp.writeFile(path.resolve('release/web-search.png'), (await win.webContents.capturePage()).toPNG());
  await click('[aria-label="New chat"]');
  await waitFor(`document.querySelector('[aria-label="Web search"]').getAttribute('aria-pressed') === 'false'`);

  console.log(
    "CHAT_UI_SMOKE_PASS: viewer, IME, Markdown, original bytes, Stop, History, paste, deletion, review tools, web settings, search/read, citations, external opening and permission reset.",
  );
}
run()
  .then(() => {
    server?.close();
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    server?.close();
    app.exit(1);
  });
// Chromium may retain cache handles until process exit; the temporary root is isolated and printed for cleanup.
app.on("will-quit", () => console.log("Chat smoke data: " + root));
