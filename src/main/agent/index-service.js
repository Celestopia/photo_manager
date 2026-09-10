const fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
const {writeTextAtomic}=require("../../../scripts/library-core");
const {projectMetadata}=require("./metadata-projection");
const {mediaFrames,resolveSource}=require("./media-assets");
const {digest}=require("./model-assets");
const {exact,fingerprint,assertUuidV4}=require("../../shared/agent-schema");
const models=require("./model-manifest.json");
const {rejectSymlinkPath}=require("./path-safety");
const {pruneGenerations}=require("./storage-maintenance");
const INDEX_PROFILE=fingerprint({models,preprocessing:2,sampling:3,projection:1});
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
async function readGeneration(paths,signal){
  signal?.throwIfAborted();
  await rejectSymlinkPath(paths.agentIndexDir,{allowMissing:true});
  let pointer;try{pointer=JSON.parse(await fs.readFile(path.join(paths.agentIndexDir,"current.json"),"utf8"));}catch(e){if(e.code==="ENOENT")return null;throw new Error("Invalid index pointer; rebuild the index");}
  exact(pointer,["version","generation"]);
  assertUuidV4(pointer.generation);
  if(pointer.version!==1||! /^[a-f0-9-]{36}$/.test(pointer.generation))throw new Error("Invalid index generation");
  const directory=path.join(paths.agentIndexDir,"generations",pointer.generation);
  await rejectSymlinkPath(directory);
  await rejectSymlinkPath(path.join(directory,"manifest.json"));
  const manifest=JSON.parse(await fs.readFile(path.join(directory,"manifest.json"),"utf8"));
  exact(manifest,["version","profile","generation","shards","failures","createdAt"]);
  if(!Array.isArray(manifest.failures)||!Number.isFinite(Date.parse(manifest.createdAt)))throw new Error("Invalid index manifest");
  for(const failure of manifest.failures){exact(failure,["mediaId","phase","error"]);assertUuidV4(failure.mediaId);if(!["text","visual"].includes(failure.phase)||typeof failure.error!=="string")throw new Error("Invalid index failure record");}
  if(manifest.version!==1||manifest.profile!==INDEX_PROFILE||manifest.generation!==pointer.generation||!Array.isArray(manifest.shards))throw new Error("Incompatible index; rebuild required");
  for(const s of manifest.shards){
    exact(s,["name","count","dimension","vectorsHash","rowsHash"]);
    if(!/^shard-\d+$/.test(s.name)||![384,512].includes(s.dimension)||!Number.isInteger(s.count)||s.count<1||s.count>4096)throw new Error("Invalid index shard");
    await rejectSymlinkPath(path.join(directory,s.name+".f32"));await rejectSymlinkPath(path.join(directory,s.name+".json"));
    if(await digest(path.join(directory,s.name+".f32"),signal)!==s.vectorsHash||await digest(path.join(directory,s.name+".json"),signal)!==s.rowsHash)throw new Error("Corrupt index; rebuild required");
  }
  if(new Set(manifest.shards.map(shard=>shard.name)).size!==manifest.shards.length)throw new Error("Duplicate index shard");
  const identities=new Map();
  for await(const {row}of indexRows({directory,manifest},signal)){
    const key=`${row.mediaId}:${row.lane}`,record=identities.get(key)||{inputHash:row.inputHash,expected:row.expected,parts:new Set()};
    if(record.inputHash!==row.inputHash||record.expected!==row.expected||record.parts.has(row.part))throw new Error("Inconsistent or duplicate index rows");
    record.parts.add(row.part);identities.set(key,record);
  }
  return {directory,manifest};
}
async function* indexRows(generation,signal){
  if(!generation)return;
  for(const shard of generation.manifest.shards){
    signal?.throwIfAborted();
    const rows=JSON.parse(await fs.readFile(path.join(generation.directory,shard.name+".json"),"utf8"));
    const bytes=await fs.readFile(path.join(generation.directory,shard.name+".f32"));
    if(rows.length!==shard.count||bytes.length!==rows.length*shard.dimension*4)throw new Error("Invalid shard size");
    for(let i=0;i<rows.length;i++){
      signal?.throwIfAborted();
      const row=rows[i];exact(row,["mediaId","lane","inputHash","part","timestamp","start","end","complete","expected"]);
      assertUuidV4(row.mediaId);
      if(!/^[a-f0-9]{64}$/.test(row.inputHash)||!Number.isInteger(row.part)||row.part<0||!Number.isInteger(row.expected)||row.expected<1||row.part>=row.expected||row.complete!==true)throw new Error("Invalid index row coverage");
      if(row.lane==="visual"?(row.start!==null||row.end!==null||row.timestamp!==null&&(!Number.isFinite(row.timestamp)||row.timestamp<0)):(!Number.isInteger(row.start)||!Number.isInteger(row.end)||row.start<0||row.end<=row.start||row.timestamp!==null))throw new Error("Invalid index source span");
      if(!["visual","description","context"].includes(row.lane)||(row.lane==="visual"?512:384)!==shard.dimension)throw new Error("Invalid index lane");
      const vector=new Float32Array(shard.dimension);let norm=0;for(let j=0;j<vector.length;j++){vector[j]=bytes.readFloatLE((i*vector.length+j)*4);if(!Number.isFinite(vector[j]))throw new Error("Invalid vector");norm+=vector[j]*vector[j];}
      if(Math.abs(norm-1)>0.001)throw new Error("Index vector is not normalized");
      yield {row,vector};
    }
  }
}
async function buildIndex({paths,items,scopeIds,registries,embeddings,resourceRoot,mediaConfig,signal,onProgress=()=>{},kind="update",textLimit=20000,timeLimitMs=1800000}){
  await rejectSymlinkPath(paths.agentIndexDir,{allowMissing:true});
  const started=Date.now();let previous=null;
  if(!["update","visual","text","refresh-text","rebuild"].includes(kind))throw new Error("Invalid index build kind");
  if(kind!=="rebuild")previous=await readGeneration(paths,signal);
  const scope=scopeIds?new Set(scopeIds):new Set(items.map(i=>i.MediaId));
  const projections=new Map(items.map(i=>[i.MediaId,projectMetadata(i,registries)]));
  const generation=crypto.randomUUID(),directory=path.join(paths.agentIndexDir,"generations",generation);
  const copiedBytes=(previous?.manifest.shards||[]).reduce((sum,shard)=>sum+shard.count*(shard.dimension*4+512),0);
  const space=await fs.statfs(paths.managerDir);if(space.bavail*space.bsize<512*1024*1024+copiedBytes+64*1024*1024)throw new Error("Insufficient disk space for an index generation (512 MiB reserve required)");
  await fs.mkdir(directory,{recursive:true});
  const manifest={version:1,profile:INDEX_PROFILE,generation,shards:[],failures:[],createdAt:new Date().toISOString()};
  const known=new Set(),documents=new Map(),completedDocuments=new Set();let pending=[],dimension=0,visualCount=0,textCount=0;
  async function flush(){
    if(!pending.length)return;
    const name=`shard-${manifest.shards.length}`,rows=JSON.stringify(pending.map(p=>p.row)),data=Buffer.alloc(pending.length*dimension*4);
    pending.forEach((p,i)=>p.vector.forEach((x,j)=>data.writeFloatLE(x,(i*dimension+j)*4)));
    await fs.writeFile(path.join(directory,name+".f32"),data);await fs.writeFile(path.join(directory,name+".json"),rows);
    manifest.shards.push({name,count:pending.length,dimension,vectorsHash:hash(data),rowsHash:hash(rows)});pending=[];
    await writeTextAtomic(path.join(directory,"manifest.json"),JSON.stringify(manifest));
    await writeTextAtomic(path.join(paths.agentIndexDir,"current.json"),JSON.stringify({version:1,generation}));
  }
  const key=r=>`${r.mediaId}:${r.lane}:${r.inputHash}:${r.part}`;
  async function add(row,vector){
    if(pending.length&&(dimension!==vector.length||pending.length>=256))await flush();dimension=vector.length;
    if(![384,512].includes(vector.length))throw new Error("Invalid embedding dimension");
    pending.push({row,vector});known.add(key(row));
    if(row.lane!=="visual"){
      const prefix=`${row.mediaId}:${row.lane}:${row.inputHash}:`;
      const parts=documents.get(prefix)||new Set();parts.add(row.part);documents.set(prefix,parts);
      if(parts.size===row.expected&&Array.from({length:row.expected},(_,i)=>i).every(i=>parts.has(i)))completedDocuments.add(prefix);
    }
  }
  const byId=new Map(items.map(i=>[i.MediaId,i]));
  const oldVisualCoverage=new Map(),invalidSources=new Map();
  for(const shard of previous?.manifest.shards||[]){
    if(shard.dimension!==512)continue;
    const rows=JSON.parse(await fs.readFile(path.join(previous.directory,shard.name+".json"),"utf8"));
    for(const row of rows){const record=oldVisualCoverage.get(row.mediaId)||{parts:new Set(),expected:row.expected,inputHash:row.inputHash};record.parts.add(row.part);oldVisualCoverage.set(row.mediaId,record);}
  }
  if(!["text","refresh-text"].includes(kind))for(const item of items){
    if(!scope.has(item.MediaId))continue;signal?.throwIfAborted();
    try{
      if(item.FileSystem.FileType==="video"&&item.Video?.DurationSeconds>1800)throw new Error("Video exceeds 30 minutes; metadata-only indexing");
      const source=await resolveSource(paths,item),old=oldVisualCoverage.get(item.MediaId);
      const reusable=kind==="update"&&old?.inputHash===fingerprint({hash:item.SHA256Hash,profile:INDEX_PROFILE})&&old.parts.size===old.expected;
      if(!reusable&&await digest(source,signal)!==item.SHA256Hash)throw new Error("Media content changed; run Update Metadata first");
    }catch(error){if(signal?.aborted)throw error;invalidSources.set(item.MediaId,error.message);manifest.failures.push({mediaId:item.MediaId,phase:"visual",error:String(error.message).slice(0,200)});}
    onProgress({phase:"validate",mediaId:item.MediaId,visualCount,textCount});
  }
  for await(const entry of indexRows(previous,signal)){
    const item=byId.get(entry.row.mediaId);if(!item)continue;
    if(entry.row.lane==="visual"&&invalidSources.has(item.MediaId))continue;
    const fresh=entry.row.lane==="visual"?fingerprint({hash:item.SHA256Hash,profile:INDEX_PROFILE}):projections.get(item.MediaId).fingerprint;
    const rebuilding=scope.has(item.MediaId)&&(kind==="visual"&&entry.row.lane==="visual"||kind==="text"&&entry.row.lane!=="visual");
    if(entry.row.inputHash===fresh&&!rebuilding)await add(entry.row,entry.vector);
  }
  function check(){signal?.throwIfAborted();if(Date.now()-started>timeLimitMs||visualCount>=5000||textCount>=textLimit)throw Object.assign(new Error("Index window complete; resume to continue"),{code:"BUDGET"});}
  try{
    for(const phase of ["text","visual"])for(const item of [...items].sort((a,b)=>a.MediaId.localeCompare(b.MediaId))){
      if(!scope.has(item.MediaId))continue;
      check();if(kind==="visual"&&phase==="text"||["text","refresh-text"].includes(kind)&&phase==="visual")continue;
      try{
        if(phase==="text"){
          const projected=projections.get(item.MediaId);
          for(const lane of ["description","context"]){
            if(!projected[lane])continue;
            const prefix=`${item.MediaId}:${lane}:${projected.fingerprint}:`;
            // A completed document is checkpointed as a unit; interrupted documents
            // are re-encoded and their already published chunks are retained.
            if(completedDocuments.has(prefix))continue;
            const [chunks]=await embeddings.encode("metadata",[projected[lane]],signal);
            for(let part=0;part<chunks.length;part++){if(known.has(prefix+part))continue;check();const c=chunks[part];await add({mediaId:item.MediaId,lane,inputHash:projected.fingerprint,part,timestamp:null,start:c.start,end:c.end,complete:true,expected:chunks.length},c.vector);textCount++;}
          }
        }else{
          if(invalidSources.has(item.MediaId))continue;
          const inputHash=fingerprint({hash:item.SHA256Hash,profile:INDEX_PROFILE});
          const old=oldVisualCoverage.get(item.MediaId);
          if(kind==="update"&&old?.inputHash===inputHash&&old.parts.size===old.expected)continue;
          let part=0;
          for await(const frame of mediaFrames(paths,item,{resourceRoot,mediaConfig,signal})){
            check();if(frame.error){manifest.failures.push({mediaId:item.MediaId,phase:"visual",error:`Sample ${frame.part}: ${frame.error}`});continue;}
            const framePart=frame.part??part;const k=`${item.MediaId}:visual:${inputHash}:${framePart}`;
            if(!known.has(k)){
              const [vector]=await embeddings.encode("image",[frame.image],signal);
              await add({mediaId:item.MediaId,lane:"visual",inputHash,part:framePart,timestamp:frame.timestamp,start:null,end:null,complete:true,expected:frame.expected??1},vector);visualCount++;
            }part++;
          }
        }
        onProgress({phase,mediaId:item.MediaId,visualCount,textCount,elapsedSeconds:Math.round((Date.now()-started)/1000)});
      }catch(e){if(signal?.aborted||e.code==="BUDGET")throw e;manifest.failures.push({mediaId:item.MediaId,phase,error:String(e.message).slice(0,200)});}
    }
  }finally{await flush();await writeTextAtomic(path.join(directory,"manifest.json"),JSON.stringify(manifest));await writeTextAtomic(path.join(paths.agentIndexDir,"current.json"),JSON.stringify({version:1,generation}));}
  await pruneGenerations(paths,new Set([generation,previous?.manifest.generation].filter(Boolean)));
  return {generation,visualCount,textCount,failures:manifest.failures};
}
module.exports={INDEX_PROFILE,readGeneration,indexRows,buildIndex};
