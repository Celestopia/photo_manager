import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import { useGalleryQuery } from '../src/renderer/composables/use-gallery-query.js';
import { readProjection, projectTokens } from '../src/main/semantic/multilingual-clip.mjs';
function fixture() {
  const calls=[],scope=effectScope();
  const api={cancelGallerySearch:async()=>{},queryGallery:async q=>{calls.push(structuredClone(q));return {total:1,groups:[{date:'x',items:[{MediaId:'a'}]}],semantic:q.search.field==='semantic'&&Boolean(q.search.value)}}};
  const state=scope.run(()=>useGalleryQuery({api,showToastMessage:()=>{}}));
  return {state,api,calls,scope};
}
for(const field of ['title','filename','description','semantic'])test(`${field} drafts require explicit submission and survive filter/refresh without accidental application`,async()=>{
  const f=fixture();const s=f.state;
  s.query.search.field=field;s.query.search.value='first';assert.equal(f.calls.length,0);
  await s.applyFilterSort();assert.equal(f.calls.at(-1).search.value,'');
  await s.applySearch();assert.equal(f.calls.at(-1).search.value,'first');
  s.query.search.value='unfinished';await s.setMediaTypeFilter('video');await s.queryGallery();
  assert.equal(f.calls.at(-1).search.value,'first');
  s.submitSearchKey({isComposing:true});s.submitSearchKey({keyCode:229});
  assert.equal(f.calls.at(-1).search.value,'first');
  await s.submitSearchKey({preventDefault(){}});assert.equal(f.calls.at(-1).search.value,'unfinished');
  await s.clearSearch();assert.equal(f.calls.at(-1).search.value,'');
  f.scope.stop();
});
test('count and reset respect library lifecycle and never submit pending draft text',async()=>{
  const f=fixture(),s=f.state;s.query.search={field:'semantic',value:'海边'};await s.applySearch();s.query.search.value='draft';
  await s.setResultLimit({target:{value:'7'}});assert.equal(f.calls.at(-1).search.value,'海边');assert.equal(f.calls.at(-1).resultLimit,7);
  const target={value:'101'};await s.setResultLimit({target});assert.equal(target.value,7);
  s.resetGalleryState();assert.equal(s.resultLimit.value,10);assert.equal(s.appliedSearchLabel.value,'');
  f.scope.stop();
});
test('clearing during an outstanding query ignores its late result',async()=>{
  const f=fixture(),s=f.state;let resolve;
  f.api.queryGallery=()=>new Promise(r=>resolve=r);
  s.query.search.value='pending';const old=s.applySearch();s.resetGalleryState();resolve({total:50,groups:[]});await old;
  assert.equal(s.total.value,0);assert.equal(s.appliedSearchLabel.value,'');f.scope.stop();
});
test('multilingual projection masks padding and applies the learned matrix after mean pooling',()=>{
  const weights=new Float32Array(512*768);weights[0]=2;weights[768+1]=3;
  const tokens=new Float32Array(3*768);tokens[0]=2;tokens[768]=4;tokens[1]=4;tokens[769]=6;tokens[1536]=999;
  const out=projectTokens(tokens,[1n,1n,0n],weights);
  assert.equal(out.length,512);assert.equal(out[0],6);assert.equal(out[1],15);
  assert.throws(()=>projectTokens(tokens,[0n,0n,0n],weights),/Empty/);
  const header=Buffer.from(JSON.stringify({'linear.weight':{dtype:'F32',shape:[512,768],data_offsets:[0,1572864]}}));
  const bytes=Buffer.alloc(8+header.length+weights.byteLength);bytes.writeBigUInt64LE(BigInt(header.length));header.copy(bytes,8);
  for(let i=0;i<weights.length;i++)bytes.writeFloatLE(weights[i],8+header.length+i*4);
  assert.equal(readProjection(bytes)[0],2);bytes.writeFloatLE(NaN,8+header.length);assert.throws(()=>readProjection(bytes),/Nonfinite/);
});
