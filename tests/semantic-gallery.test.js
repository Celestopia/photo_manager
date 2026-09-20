const test = require('node:test');
const assert = require('node:assert/strict');
const { createGallerySearch, validateSearch } = require('../src/main/semantic/gallery-search');
const { createGalleryQueryService } = require('../src/main/gallery-query');
const { sampleCount, selectFrames } = require('../src/main/semantic/domain');
const query = (text, limit=10) => ({ search:{field:'semantic',value:text},resultLimit:limit,sortBy:'shootingTime',sortOrder:'desc',filters:{privacyLevels:[1]} });
function fixture() {
  let lib={paths:{},manifest:{libraryId:'test'}}, encodes=0;
  const items=[1,2,3,4].map(n=>({MediaId:String(n),Customization:{Title:'title',Privacy:n===4?2:1,Rating:n},FileSystem:{FileType:'image'}}));
  const filter=createGalleryQueryService({getLocationDescendants:()=>[],getLocationIdsForRegion:()=>[],unassignedFilter:'none'});
  const search={ encode:async text=>{encodes++;return {text};},rank:async ({ids})=>[...ids].reverse(),dispose:async()=>{} };
  const service=createGallerySearch({search,getLibrary:()=>lib,getItems:()=>items,executeQuery:filter.execute});
  return { service,search,items,setLibrary:v=>lib=v,encodes:()=>encodes };
}
test('semantic queries combine only eligible media, filter before limiting, and reuse query embeddings',async()=>{
  const f=fixture();
  assert.deepEqual((await f.service.query(query('海边 风景',2))).items.map(i=>i.MediaId),['3','2']);
  const q=query('海边 风景',1);q.filters.ratingLevels=[1];
  assert.deepEqual((await f.service.query(q)).items.map(i=>i.MediaId),['1']);
  assert.equal(f.encodes(),1);
  await f.service.close();await f.service.query(query('海边 风景'));assert.equal(f.encodes(),2);
});
test('ordinary and empty searches never invoke embedding inference',async()=>{
  const f=fixture();for(const field of ['title','filename','description']){
    const q=query('');q.search.field=field;assert.equal((await f.service.query(q)).semantic,false);
  }
  await f.service.query(query('  '));assert.equal(f.encodes(),0);
  assert.throws(()=>validateSearch({field:'code',value:'x'}));
  assert.equal(validateSearch({field:'semantic',value:'  海边  '}).value,'海边');
  await assert.rejects(f.service.query(query('sea',101)),/Results/);
});
test('late worker replies cannot escape cancellation, library replacement, or new privacy edits',async()=>{
  const f=fixture();let finish,entered;
  const ready=new Promise(r=>entered=r);
  f.search.rank=()=>{entered();return new Promise(r=>finish=r)};
  const work=f.service.query(query('sea'));await ready;
  f.items[2].Customization.Privacy=2;finish(['3','3','4','2','1']);
  assert.deepEqual((await work).items.map(i=>i.MediaId),['2','1']);
  const g=fixture();let release;g.search.encode=()=>new Promise(r=>release=r);
  const old=g.service.query(query('old'));g.service.stop();release({});
  await assert.rejects(old);
  const h=fixture();h.search.encode=()=>new Promise(r=>release=r);
  const previous=h.service.query(query('old'));h.setLibrary({});release({});await assert.rejects(previous,/cancelled/);
});
test('sampling keeps piecewise boundaries, available frame caps and distinct indices',()=>{
  for(const [d,n] of [[0.1,10],[10,10],[59,30],[60,30],[600,120],[601,120]])assert.equal(sampleCount(d),n);
  assert.deepEqual(selectFrames([0,0.1,0.4],10),[0,1,2]);
  assert.equal(new Set(selectFrames(Array.from({length:1000},(_,i)=>i/30),120)).size,120);
});
