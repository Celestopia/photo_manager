// Execute with Electron after build:renderer. Uses an isolated library/settings root.
const {app,BrowserWindow,dialog,protocol}=require('electron');
const path=require('node:path');
const codeRoot=process.env.SEMANTIC_PACKAGED ? path.resolve('release/win-unpacked/resources/app.asar') : path.resolve(__dirname,'../..');
const fromApp=name=>require(path.join(codeRoot,name));
if(process.env.SEMANTIC_PACKAGED){
  Object.defineProperty(app,'isPackaged',{value:true});
  Object.defineProperty(process,'resourcesPath',{value:path.dirname(codeRoot)});
  process.env.PHOTO_MANAGER_RESOURCE_ROOT=path.dirname(codeRoot);
}
fromApp('src/main/viewer-image-resources').registerViewerImageScheme(protocol);
app.disableHardwareAcceleration();
const fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict'),sharp=require('sharp');
const realModels=fromApp('scripts/application-paths').resolveApplicationPaths().modelsDir;
const root=sync.mkdtempSync(path.join(os.tmpdir(),'photo-manager-semantic-ui-'));
process.env.APPDATA=path.join(root,'roaming');process.env.LOCALAPPDATA=path.join(root,'local');
app.setName('PhotoManager Semantic Smoke');
const {resolveApplicationPaths,configureElectronStoragePaths}=fromApp('scripts/application-paths');
const application=resolveApplicationPaths();configureElectronStoragePaths(app,application);
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.maximize=function(){};
const manager=fromApp('src/main/window-manager'),originalWindow=manager.createMainWindow;
manager.createMainWindow=options=>originalWindow(options,{electron:{dialog,BrowserWindow:class extends BrowserWindow{constructor(options){super({...options,webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});}}}});
dialog.showMessageBox=async()=>({response:1});
let win;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const js=code=>win.webContents.executeJavaScript(code);
async function wait(code){for(let i=0;i<300;i++){if(win&&!win.isDestroyed()&&await js(code))return;await sleep(100);}throw Error('Timeout: '+code+'\n'+await js('document.body.innerText'));}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const set=(selector,value,event='input')=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
const cardCount=()=>js(`document.querySelectorAll('.photo-card').length`);
async function run(){
  for(const model of fromApp('src/main/semantic/model-manifest.json').models)for(const file of model.files){
    const relative=path.join(model.repository,model.revision,file.path),dest=path.join(application.modelsDir,relative);
    await fs.mkdir(path.dirname(dest),{recursive:true});await fs.link(path.join(realModels,relative),dest);
  }
  const library=path.join(root,'library');await fs.mkdir(library);
  for(const [name,color] of [['sea.jpg','#4488cc'],['food.jpg','#ff6633']])await sharp({create:{width:640,height:420,channels:3,background:color}}).jpeg().toFile(path.join(library,name));
  const lp=fromApp('scripts/library-core').resolveLibraryPaths(library);
  await fromApp('scripts/init-metadata').run({paths:lp,config:structuredClone(fromApp('scripts/application-config').DEFAULT_CONFIG),logger:{info(){},warn(){},error(){}}});
  await require('./semantic-library.cjs').assignSemanticRegistries(lp);
  const before=await fs.readFile(lp.metadataFile);
  const built=await fromApp('scripts/build-semantic-index').run({paths:lp});assert.equal(built.generated,6);assert.equal(built.failed,0);
  await fs.writeFile(application.stateFile,JSON.stringify({lastLibraryPath:library}));
  fromApp('src/main/main');
  for(let i=0;i<100&&!win;i++){win=BrowserWindow.getAllWindows()[0];await sleep(100);}
  await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Open Library'&&!b.disabled)`);
  await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Open Library').click()`);
  await wait(`document.querySelectorAll('.photo-card').length===2`);
  assert.equal(await js(`Boolean(document.querySelector('.gallery-assistant'))`),false);
  await set('[aria-label="Search text"]','not-present');await sleep(150);assert.equal(await cardCount(),2);
  await js(`document.querySelector('.sort-tools select:last-child').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(`!document.querySelector('.summary').textContent.includes('Loading')`);assert.equal(await cardCount(),2);
  await click('.search-panel .btn-primary');await wait(`document.querySelectorAll('.photo-card').length===0`);
  await set('[aria-label="Search field"]','filename','change');await set('[aria-label="Search text"]','sea');
  await click('.search-panel .btn-primary');await wait(`document.querySelectorAll('.photo-card').length===1`);
  await set('[aria-label="Search field"]','description','change');await set('[aria-label="Search text"]','Waves');
  await js(`document.querySelector('[aria-label="Search text"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`);
  await sleep(150);assert.equal(await cardCount(),1);
  await js(`document.querySelector('[aria-label="Search text"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await wait(`document.querySelectorAll('.photo-card').length===2`);
  await set('[aria-label="Search field"]','semantic','change');await set('[aria-label="Search text"]','海边 日落 风景');
  await wait(`Boolean(document.querySelector('[aria-label="Results"]'))`);
  assert.equal(await js(`document.querySelector('[aria-label="Results"]').getBoundingClientRect().left > document.querySelector('.search-panel .btn-primary').getBoundingClientRect().right`),true);
  await click('.search-panel .btn-primary');
  await wait(`document.querySelector('.semantic-sort') && !document.querySelector('.summary').textContent.includes('Loading')`);
  assert.equal(await cardCount(),2);assert.equal(await js(`document.querySelectorAll('.date-title').length`),0);
  await set('[aria-label="Search text"]','unfinished draft');await set('[aria-label="Results"]','1','change');
  await wait(`document.querySelectorAll('.photo-card').length===1`);
  assert.match(await js(`document.querySelector('.gallery-applied-search').textContent`),/海边/);
  await click('.photo-card');await wait(`Boolean(document.querySelector('.viewer-title-input'))`);
  await click('[data-tip="Back to Gallery"]');
  await wait(`Boolean(document.querySelector('.search-panel'))`);assert.equal(await cardCount(),1);
  await fs.mkdir(path.resolve('release'),{recursive:true});await fs.writeFile(path.resolve('release/semantic-search-v039.png'),(await win.webContents.capturePage()).toPNG());
  await click('[aria-label="Reset gallery"]');await wait(`document.querySelectorAll('.photo-card').length===2`);
  await click('.gallery-settings-trigger');await js(`Array.from(document.querySelectorAll('.gallery-settings-menu button')).find(b=>b.textContent.includes('Build Semantic Index')).click()`);
  await wait(`document.querySelector('.semantic-index-options')?.textContent.includes('Ready')`);
  await js(`Array.from(document.querySelectorAll('.maintenance-modal button')).find(b=>b.textContent==='Start').click()`);
  await wait(`Boolean(document.querySelector('.maintenance-progress pre'))`);
  assert.match(await js(`document.querySelector('.maintenance-progress pre').textContent`),/"reused":\s*6/);
  assert.deepEqual(await fs.readFile(lp.metadataFile),before);
  console.log('SEMANTIC_UI_PASS: ordinary explicit submission, IME, multilingual inference, count position, draft isolation, relevance, viewer return, maintenance reuse, unchanged metadata.');
}
run().then(()=>app.quit()).catch(e=>{console.error(e);app.exit(1)});
app.on('will-quit',()=>console.log('Semantic smoke root: '+root));
