import { env, AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, pipeline, RawImage } from '@huggingface/transformers';
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
let session = null, kind = '', tokenizer = null, processor = null, timer = null;
async function release() { clearTimeout(timer); if (session) await session.dispose(); session = null; kind = ''; tokenizer = processor = null; }
async function load(request) {
  if (kind === request.kind && session) return;
  await release();
  const options = { local_files_only: true, dtype: 'q8', device: 'cpu' };
  if (request.kind === 'metadata') {
    session = await pipeline('feature-extraction', request.directory, options);
    tokenizer = session.tokenizer;
  } else if (request.kind === 'visualText') {
    tokenizer = await AutoTokenizer.from_pretrained(request.directory, options);
    session = await CLIPTextModelWithProjection.from_pretrained(request.directory, options);
  } else {
    processor = await AutoProcessor.from_pretrained(request.directory, options);
    session = await CLIPVisionModelWithProjection.from_pretrained(request.directory, options);
  }
  kind = request.kind;
}
function normalized(data) {
  let sum = 0; for (const x of data) { if (!Number.isFinite(x)) throw new Error('Nonfinite embedding'); sum += x*x; }
  if (!sum) throw new Error('Zero embedding');
  const d = Math.sqrt(sum); return Array.from(data, x => x/d);
}
async function run(request) {
  await load(request); clearTimeout(timer);
  const results = [];
  if (request.kind === 'metadata') {
    for (const input of request.texts) {
      const tokens = tokenizer.encode(input, { add_special_tokens: false });
      const chunks = [];
      for (let start = 0; start < tokens.length; start += 110) {
        const slice = tokens.slice(start, start + 126);
        const value = tokenizer.decode(slice, { skip_special_tokens: true });
        const output = await session(value, { pooling: 'mean', normalize: true, truncation: true, max_length: 128 });
        chunks.push({ start, end: Math.min(start + 126, tokens.length), vector: normalized(output.data) });
        if (start + 126 >= tokens.length) break;
      }
      results.push(chunks);
    }
  } else if (request.kind === 'visualText') {
    for (const input of request.texts) {
      if (tokenizer.encode(input).length > 77) throw new Error('Visual query exceeds 77 CLIP tokens; shorten it');
      const output = await session(tokenizer(input, { padding: true, truncation: false }));
      results.push(normalized(output.text_embeds.data));
    }
  } else {
    for (const input of request.images) {
      const { data, info } = await sharp(Buffer.from(input), { limitInputPixels: 100000000 }).rotate().flatten({ background: '#ffffff' }).resize(224,224,{fit:'contain',background:{r:123,g:117,b:104}}).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const pixels = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
      const output = await session(await processor(pixels));
      results.push(normalized(output.image_embeds.data));
    }
  }
  timer = setTimeout(release, 60000); timer.unref?.();
  return results;
}
const port = process.parentPort || parentPort;
port.on('message', async event => {
  const message = process.parentPort ? event.data : event;
  try { port.postMessage({ id: message.id, result: await run(message) }); }
  catch(e) { port.postMessage({ id: message.id, error: String(e.message).slice(0,300) }); }
});
