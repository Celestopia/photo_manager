import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { useAppDialog } from '../src/renderer/composables/use-app-dialog.js';
import { useLibrarySession } from '../src/renderer/composables/use-library-session.js';
const {createWindowMessages}=createRequire(import.meta.url)('../src/main/window-messages.js');
test('confirmation defaults to cancellation and rejects overlapping requests',async()=>{
 const d=useAppDialog();const p=d.request({title:'Delete tag?',message:'Example',danger:true});
 assert.equal(await d.request({title:'Second'}),false);assert.equal(d.state.title,'Delete tag?');d.reset();assert.equal(await p,false);
 const next=d.request({title:'Notice',notice:true});assert.equal(d.state.danger,false);d.settle(true);assert.equal(await next,true);assert.equal(d.state.visible,false);
});
test('disposed library cannot act on a late confirmation',async()=>{
 let approve,calls=0;const s=useLibrarySession({api:{closeLibrary:async()=>{calls++}},showToastMessage(){},requestConfirm:()=>new Promise(r=>approve=r)});
 s.libraryState.value.active={root:'fixture'};const p=s.returnToLibraryEntry();s.dispose();approve(true);await p;assert.equal(calls,0);
});
function fixture(){const ipcMain=new EventEmitter(),wc=new EventEmitter(),win=new EventEmitter();const sent=[];let fallback=0;
 wc.mainFrame={};wc.send=(channel,payload)=>sent.push({channel,payload});win.webContents=wc;win.isDestroyed=()=>false;
 const m=createWindowMessages(win,{ipcMain,dialog:{showMessageBox:async()=>{fallback++;return {response:0}}}});
 return {ipcMain,wc,win,sent,m,fallback:()=>fallback};}
test('window decisions validate sender, frame, request identity, and cleanup',async()=>{
 const f=fixture();const event={sender:f.wc,senderFrame:f.wc.mainFrame};f.ipcMain.emit('window:message-ready',event);
 const p=f.m.request({title:'Close?',confirmLabel:'Close'}),id=f.sent[0].payload.id;
 f.ipcMain.emit('window:message-answer',{sender:{}},{id,accepted:true});
 f.ipcMain.emit('window:message-answer',{sender:f.wc,senderFrame:{}},{id,accepted:true});
 f.ipcMain.emit('window:message-answer',event,{id:'wrong',accepted:true});
 assert.equal(await f.m.request({}),false);
 f.ipcMain.emit('window:message-answer',event,{id,accepted:true});assert.equal(await p,true);
 const next=f.m.request({});f.win.emit('closed');assert.equal(await next,false);assert.equal(f.ipcMain.listenerCount('window:message-answer'),0);
});
test('window messages use native fallback only when renderer cannot present them',async()=>{
 const f=fixture();assert.equal(await f.m.request({confirmLabel:'Close'}),false);assert.equal(f.fallback(),1);
 f.ipcMain.emit('window:message-ready',{sender:f.wc});const p=f.m.request({});f.wc.emit('unresponsive');assert.equal(await p,false);
 await f.m.request({confirmLabel:'OK',notice:true});assert.equal(f.fallback(),2);f.win.emit('closed');
});
