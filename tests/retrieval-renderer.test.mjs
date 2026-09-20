import test from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,ref,nextTick} from 'vue';
import {useRetrieval} from '../src/renderer/composables/use-retrieval.js';
test('retrieval state survives panel close, rejects stale events and resets across libraries',async()=>{
 let listener,unsubscribed=false,refreshes=0;
 const libraryState=ref({active:{libraryId:'one'}}),scope=effectScope();
 const state=(sequence,revision,libraryId='one')=>({libraryId,sequence,revision,resultRevision:0,messages:[],working:false});
 const retrieval=scope.run(()=>useRetrieval({libraryState,refresh:()=>{refreshes++;},copyText:async()=>{},api:{onEvent:fn=>{listener=fn;return()=>{unsubscribed=true;};},snapshot:async()=>state(1,0)}}));
 await retrieval.open();retrieval.visible.value=false;listener(state(2,1));assert.equal(refreshes,1);listener(state(1,0));assert.equal(retrieval.state.value.revision,1);
 listener({...state(3,1),resultRevision:1});assert.equal(refreshes,2);
 libraryState.value={active:{libraryId:'two'}};await nextTick();assert.equal(retrieval.state.value.messages.length,0);assert.equal(retrieval.visible.value,false);listener(state(100,5));assert.equal(retrieval.state.value.revision,0);
 scope.stop();assert.equal(unsubscribed,true);
});
test('a delayed send reply cannot clear the replacement library composer',async()=>{
 let resolve;const libraryState=ref({active:{libraryId:'one'}}),scope=effectScope();
 const retrieval=scope.run(()=>useRetrieval({libraryState,refresh:()=>{},copyText:async()=>{},api:{onEvent:()=>()=>{},send:()=>new Promise(r=>resolve=r)}}));
 retrieval.text.value='Old request';const sending=retrieval.send();libraryState.value={active:{libraryId:'two'}};await nextTick();retrieval.text.value='New request';resolve({libraryId:'one',sequence:4,revision:1});await sending;assert.equal(retrieval.text.value,'New request');scope.stop();
});
