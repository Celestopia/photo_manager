const fs=require("node:fs/promises"),path=require("node:path");
const {execFile}=require("node:child_process");
const sharp=require("sharp");
const {assertPathInsideLibrary}=require("../../../scripts/library-core");
const {resolveMediaToolPaths}=require("../../../scripts/media-tools");
function sampleTimes(duration,cap=120){if(!Number.isFinite(duration)||duration<=0||duration>1800)throw new Error("Visual analysis supports videos up to 30 minutes");const n=Math.min(cap,Math.max(2,Math.ceil(duration/15)+1));return Array.from({length:n},(_,i)=>i*Math.max(0,duration-0.1)/(n-1));}
async function resolveSource(paths,item){
  const absolute=assertPathInsideLibrary(paths,path.resolve(paths.root,item.FilePath));
  let cursor=paths.root;for(const part of path.relative(paths.root,absolute).split(path.sep)){cursor=path.join(cursor,part);if((await fs.lstat(cursor)).isSymbolicLink())throw new Error("Symbolic-link media is not allowed");}
  const stat=await fs.stat(absolute);
  if(!stat.isFile()||stat.size!==item.FileSystem.FileSize||Math.abs(stat.mtimeMs-item.FileSystem.ModificationTimeMs)>1)throw new Error("Media changed; run Update Metadata first");
  return absolute;
}
async function derivative(bytes){
  for(const [size,quality]of [[1024,85],[1024,75],[1024,60],[768,60],[512,60]]){
    const result=await sharp(bytes,{limitInputPixels:100000000}).rotate().toColourspace("srgb").flatten({background:"#fff"}).resize(size,size,{fit:"inside",withoutEnlargement:true}).jpeg({quality}).toBuffer();
    if(result.length<=1024*1024)return result;
  }throw new Error("Media derivative exceeds 1 MiB");
}
function extractFrame(file,time,ffmpeg,signal){return new Promise((resolve,reject)=>{
  execFile(ffmpeg,["-hide_banner","-loglevel","info","-copyts","-ss",String(time),"-i",file,"-frames:v","1","-vf","scale=w='iw*sar*min(1,min(1024/(iw*sar),1024/ih))':h='ih*min(1,min(1024/(iw*sar),1024/ih))',setsar=1,showinfo","-fps_mode","passthrough","-f","image2pipe","-vcodec","png","pipe:1"],{encoding:"buffer",maxBuffer:16*1024*1024,timeout:60000,windowsHide:true,signal},(error,stdout,stderr)=>{
    const match=String(stderr).match(/\bn:\s*0\b[^\r\n]*?pts_time:([\d.e+-]+)/);
    if(error||!stdout.length||!match||!Number.isFinite(Number(match[1])))reject(new Error(signal?.aborted?"Frame extraction cancelled":"Requested frame is unavailable"));
    else resolve({bytes:stdout,timestamp:Number(match[1])});
  });
});}
async function* mediaFrames(paths,item,{resourceRoot,mediaConfig,signal,maxFrames=120,timestamps}={}){
  const source=await resolveSource(paths,item);signal?.throwIfAborted();
  if(item.FileSystem.FileType==="video"){
    const {ffmpegPath}=resolveMediaToolPaths(resourceRoot,mediaConfig);
    const targets=timestamps?.length?[...new Set(timestamps)].sort((a,b)=>a-b):sampleTimes(item.Video?.DurationSeconds,maxFrames),seen=new Set();
    if(targets.length>maxFrames||targets.some(time=>!Number.isFinite(time)||time<0||time>item.Video.DurationSeconds))throw new Error("Invalid requested frame times");
    for(let part=0;part<targets.length;part++){
      signal?.throwIfAborted();let frame,error;
      for(let attempt=0;attempt<2;attempt++){try{frame=await extractFrame(source,targets[part],ffmpegPath,signal);break;}catch(e){signal?.throwIfAborted();error=e;}}
      if(!frame){yield {part,expected:targets.length,error:error.message};continue;}
      if(seen.has(frame.timestamp))continue;seen.add(frame.timestamp);
      yield {part,expected:targets.length,timestamp:frame.timestamp,image:await derivative(frame.bytes)};
    }
  }else if(item.FileSystem.FileExtension?.toLowerCase()===".gif"||/\.gif$/i.test(item.FilePath)){
    const info=await sharp(source,{animated:true,limitInputPixels:100000000}).metadata(),pages=info.pages||1,n=Math.min(pages,8,maxFrames),delays=info.delay||[];
    if(pages>1&&(delays.length!==pages||delays.some(delay=>!Number.isFinite(delay)||delay<=0)))throw new Error("Animation timing is unavailable");
    const duration=delays.reduce((sum,delay)=>sum+delay,0)/1000,starts=[0];
    for(let page=1;page<pages;page++)starts.push(starts[page-1]+delays[page-1]/1000);
    const selected=[];
    for(let i=0;i<n;i++){const time=n===1?0:i*Math.max(0,duration-0.1)/(n-1);let page=pages-1;for(let j=0;j<pages;j++)if(time<starts[j]+(delays[j]||0)/1000){page=j;break;}if(!selected.includes(page))selected.push(page);}
    for(let part=0;part<selected.length;part++){const page=selected[part];const image=await sharp(source,{page,pages:1,limitInputPixels:100000000}).png().toBuffer();yield {part,expected:selected.length,timestamp:starts[page],image:await derivative(image)};}
  }else yield {timestamp:null,image:await derivative(await fs.readFile(source))};
}
module.exports={sampleTimes,resolveSource,derivative,mediaFrames};
