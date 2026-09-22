const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
app.setPath('userData',path.resolve('tmp/map-smoke-session'));
app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let requests=0,fail=false,window;
async function run(){
 await app.whenReady();
 await session.defaultSession.protocol.handle('https',request=>{
   assert.ok(request.url.startsWith('https://tile.openstreetmap.org/')); requests++;
   if(fail)return new Response('',{status:503});
   return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d9eddf"/><path d="M0 90H256M110 0V256" stroke="white" stroke-width="12"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
 });
 window=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const errors=[];window.webContents.on('console-message',(_,level,message)=>{if(level===3)errors.push(message)});
 await window.loadFile(process.argv[2]);
 const js=code=>window.webContents.executeJavaScript(code,true);
 const wheel=(ctrlKey,deltaY)=>js(`(() => { const el=document.querySelector('.gps-map-canvas'), r=el.getBoundingClientRect(); return el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:${ctrlKey},deltaY:${deltaY},clientX:r.x+r.width/2,clientY:r.y+r.height/2})); })()`);
 async function until(code){for(let i=0;i<100;i++){if(await js(code))return;await pause(50)}throw Error('Timed out: '+code)}
 async function checkTooltip(selector,label){
   await js(`document.querySelector('${selector}').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
   await until(`document.querySelector('.dynamic-tooltip:popover-open')?.textContent===${JSON.stringify(label)}`);
   assert.equal(await js(`(() => {const tip=document.querySelector('.dynamic-tooltip'),r=tip.getBoundingClientRect();tip.style.pointerEvents='auto';const above=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===tip;tip.style.pointerEvents='';return above;})()`),true);
   assert.equal(await js(`document.querySelector('${selector}').hasAttribute('title')`),false);
   await js(`document.querySelector('${selector}').dispatchEvent(new MouseEvent('mouseout',{bubbles:true}))`);
 }
 const gps={LatitudeRef:'N',Latitude:[22,30,0],LongitudeRef:'E',Longitude:[114,15,0]};
 await until('!!window.mapTest');await pause(150);assert.equal(requests,0);
 await js('mapTest.active(true)');await until('document.body.textContent.includes("GPS unavailable")');assert.equal(requests,0);
 await js(`mapTest.gps(${JSON.stringify(gps)})`);
 await until('!!document.querySelector(".leaflet-tile-loaded")');assert.ok(requests>0);
 await checkTooltip('.gps-map-recenter','Recenter');
 await checkTooltip('.leaflet-control-zoom-in','Zoom in');
 await checkTooltip('.leaflet-control-zoom-out','Zoom out');
 const tileZoom=zoom=>`[...document.querySelectorAll('.leaflet-tile-loaded')].some(e=>e.src.includes('/${zoom}/'))`;
 assert.equal(await wheel(false,-20),false);await until(tileZoom(16));await pause(350);
 assert.equal(await wheel(false,20),false);await until(tileZoom(15));await pause(350);
 for (const selector of ['.gps-map-recenter','.gps-map-expand','.gps-map-attribution','.leaflet-control-zoom-in']) {
   assert.equal(await js(`document.querySelector('${selector}').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:20}))`),false);
 }
 assert.equal(await js(`document.querySelector('.media-gps-map').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:20}))`),true);
 await js('document.querySelector(".leaflet-control-zoom-in").click()');await pause(350);
 await until('[...document.querySelectorAll(".leaflet-tile-loaded")].some(e=>e.src.includes("/16/"))');
 for (const selector of ['.gps-map-recenter','.gps-map-attribution','.leaflet-control-zoom-in']) {
   await js(`document.querySelector('${selector}').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
   assert.equal(await js('!!document.querySelector("dialog[open]")'),false);
 }
 await js('document.querySelector(".gps-map-canvas").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
 await until('!!document.querySelector("dialog[open] .leaflet-tile-loaded")');
 assert.equal(await js('document.querySelectorAll(".leaflet-container").length'),1);
 await until('!document.querySelector(".gps-map-status")');await pause(250);
 assert.equal(await js(`(() => { const map=document.querySelector('.gps-map-canvas').getBoundingClientRect(), marker=document.querySelector('.leaflet-interactive, .leaflet-overlay-pane path').getBoundingClientRect(); return Math.abs(marker.x+marker.width/2-map.x-map.width/2)<2 && Math.abs(marker.y+marker.height/2-map.y-map.height/2)<2; })()`),true);
 assert.equal(await js('document.querySelector(".gps-map-recenter").dataset.tip'), 'Recenter');
 await checkTooltip('.gps-map-recenter','Recenter');
 await checkTooltip('.leaflet-control-zoom-in','Zoom in');
 await checkTooltip('.leaflet-control-zoom-out','Zoom out');
 await checkTooltip('.gps-map-dialog header button','Close map');
 await js('document.querySelector(".gps-map-canvas").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await pause(350);
 assert.equal(await js(tileZoom(17)),false);
 await fs.writeFile(path.resolve('tmp/map-smoke-expanded.png'),(await window.webContents.capturePage()).toPNG());
 assert.equal(await js('[...document.querySelectorAll(".leaflet-tile-loaded")].some(e=>e.src.includes("/16/"))'),true);
 assert.equal(await wheel(false,20),false);await until(tileZoom(15));await pause(350);
 await js('document.querySelector(".gps-map-dialog header button").click()');await until('!!document.querySelector(".gps-map-inline .leaflet-tile-loaded")');
 await js('mapTest.active(false)');await pause(150);const before=requests;await pause(200);assert.equal(requests,before);
 assert.equal(await js('document.querySelectorAll(".leaflet-container").length'),0);
 fail=true;await js(`mapTest.gps(${JSON.stringify({...gps,Latitude:[40,0,0]})});mapTest.active(true)`);await until('document.body.textContent.includes("Map unavailable")');
 fail=false;await js('[...document.querySelectorAll("button")].find(b=>b.textContent==="Retry").click()');await until('!document.querySelector(".gps-map-status")');
 await fs.writeFile(path.resolve('tmp/map-smoke.png'),(await window.webContents.capturePage()).toPNG());
 await js('mapTest.gps({})');await until('document.body.textContent.includes("GPS unavailable")');
 assert.equal(await js('document.querySelectorAll(".leaflet-container").length'),0);
 assert.deepEqual(errors.filter(message=>!message.includes('Failed to load resource')),[]);console.log('Map UI smoke passed: lazy loading, GPS, zoom handoff, cleanup and retry.');
 window.destroy();app.quit();
}
run().catch(error=>{console.error(error);app.exit(1)});
