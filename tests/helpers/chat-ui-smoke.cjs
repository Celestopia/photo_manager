/* Run with Electron: node_modules/.bin/electron tests/helpers/chat-ui-smoke.cjs.
   All library/configuration data and the fake provider are isolated to this test. */
const { app, BrowserWindow, dialog, clipboard } = require("electron");
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
app.setName("PhotoManager Chat Smoke");
const {
  resolveApplicationPaths,
  configureElectronStoragePaths,
} = require("../../scripts/application-paths");
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
  const { DEFAULT_CONFIG } = require("../../scripts/application-config");
  const { resolveLibraryPaths } = require("../../scripts/library-core");
  await require("../../scripts/init-metadata").run({
    paths: resolveLibraryPaths(library),
    config: structuredClone(DEFAULT_CONFIG),
    logger: { info() {}, warn() {}, error() {} },
  });
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
    requests.push(JSON.parse(body));
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
  require("../../src/main/main");
  for (let n = 0; n < 100 && !win; n++) {
    win = BrowserWindow.getAllWindows()[0];
    await sleep(100);
  }
  await waitFor(
    `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Open Library'&&!b.disabled))`,
  );
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Open Library').click()`,
  );
  await waitFor(`Boolean(document.querySelector('.photo-card'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-controls-toggle').getAttribute('aria-expanded')`), 'true');
  const searchTop = await win.webContents.executeJavaScript(`document.querySelector('.search-panel').getBoundingClientRect().top`);
  await click('.gallery-controls-toggle');
  await waitFor(`!document.querySelector('#gallery-filter-panel')`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.search-panel').getBoundingClientRect().top`), searchTop);
  await click('.gallery-controls-toggle');
  await waitFor(`Boolean(document.querySelector('#gallery-filter-panel'))`);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-controls-toggle').getBoundingClientRect().top >= document.querySelector('#gallery-filter-panel').getBoundingClientRect().bottom - 1`), true);

  assert.equal(await win.webContents.executeJavaScript(`Boolean(document.querySelector('.gallery-footer'))`), false);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.gallery-brand')?.textContent`), 'PhotoManager');
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
  await click('[aria-label="Close provider settings"]');
  await click(".photo-card");
  await waitFor(`Boolean(document.querySelector('.viewer-sidebar-tabs'))`);
  await setValue(".viewer-title-input", "Unsaved draft title");
  await click(".viewer-sidebar-tabs button:last-child");
  await waitFor(`Boolean(document.querySelector('.chat-composer .chat-attachment-tile'))`);
  await waitFor(`document.querySelector('.chat-composer .chat-attachment-tile img')?.naturalWidth > 0`);

  await click('[aria-label="Options"]');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.chat-options fieldset input[type=checkbox]').length`), 5);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.chat-options details').length`), 0);
  await fsp.mkdir(path.resolve('release'), { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/message-options.png'), (await win.webContents.capturePage()).toPNG());

  await click('[aria-label="Provider settings"]');
  await waitFor(`Boolean(document.querySelector('.provider-dialog[open] input[type=password]'))`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.provider-dialog input[type=password]').value`), '');
  await click('.provider-save');
  await waitFor(`document.querySelector('.provider-dialog')?.textContent.includes('Settings saved.')`);
  await fsp.mkdir(path.resolve('release'), { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/provider-settings.png'), (await win.webContents.capturePage()).toPNG());
  await click('[aria-label="Close provider settings"]');

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
    JSON.parse(requests[0].messages.at(-1).content[1].text).metadata.title,
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
    .at(-1)
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
  await click('.conversation-action-dialog .provider-save');
  await waitFor(`document.querySelector('.chat-history-open strong')?.textContent === 'Renamed conversation'`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fsp.writeFile(path.resolve('release/chat-history.png'), (await win.webContents.capturePage()).toPNG());
  await click(".chat-history-actions .chat-danger");
  await waitFor(`Boolean(document.querySelector('.conversation-action-dialog[open]'))`);
  await click(".conversation-delete-confirm");
  await waitFor(
    `document.querySelector('.chat-history')?.textContent.includes('No saved conversations.')`,
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

  console.log(
    "CHAT_UI_SMOKE_PASS: viewer, IME, Markdown, original bytes, Stop, History, paste, deletion and unchanged metadata.",
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
