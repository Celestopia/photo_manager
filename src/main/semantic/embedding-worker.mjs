import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  pipeline,
  RawImage,
} from "@huggingface/transformers";
import { parentPort } from "node:worker_threads";
import sharp from "sharp";
import { loadMultilingualClip } from './multilingual-clip.mjs';
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
let session = null,
  kind = "",
  tokenizer = null,
  processor = null,
  timer = null,
  work = Promise.resolve();
const sessions = new Map();
async function release() {
  clearTimeout(timer);
  for (const cached of sessions.values()) await cached.session.dispose();
  sessions.clear();
  session = null;
  kind = "";
  tokenizer = processor = null;
}
async function load(request) {
  const family = request.kind === 'queryMetadata' ? 'metadata' : request.kind;
  if (sessions.has(family)) {
    ({ session, tokenizer, processor } = sessions.get(family));
    kind = family;
    return;
  }
  if (family === 'image' || sessions.has('image')) await release();
  const options = {
    local_files_only: true,
    dtype: "q8",
    device: "cpu",
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  };
  if (family === "metadata") {
    session = await pipeline("feature-extraction", request.directory, options);
    tokenizer = session.tokenizer;
  } else if (request.kind === "visualText") {
    tokenizer = processor = null;
    session = await loadMultilingualClip(request.directory);
  } else {
    processor = await AutoProcessor.from_pretrained(request.directory, options);
    session = await CLIPVisionModelWithProjection.from_pretrained(
      request.directory,
      options,
    );
  }
  kind = family;
  sessions.set(family, { session, tokenizer, processor });
}
function normalized(data) {
  let sum = 0;
  for (const x of data) {
    if (!Number.isFinite(x)) throw new Error("Nonfinite embedding");
    sum += x * x;
  }
  if (!sum) throw new Error("Zero embedding");
  const d = Math.sqrt(sum);
  return Array.from(data, (x) => x / d);
}
async function run(request) {
  clearTimeout(timer);
  await load(request);
  const results = [];
  if (request.kind === "metadata" || request.kind === 'queryMetadata') {
    for (const input of request.texts) {
      if (request.kind === 'queryMetadata' && tokenizer.encode(input).length > 128)
        throw new Error('Search keywords exceed the model limit; shorten the query.');
      const tokens = tokenizer.encode(input, { add_special_tokens: false });
      const chunks = [];
      for (let start = 0; start < tokens.length; ) {
        let end = Math.min(start + 126, tokens.length);
        let value = tokenizer.decode(tokens.slice(start, end), {
          skip_special_tokens: true,
        });
        while (tokenizer.encode(value).length > 128 && end > start + 1) {
          end--;
          value = tokenizer.decode(tokens.slice(start, end), {
            skip_special_tokens: true,
          });
        }
        if (tokenizer.encode(value).length > 128)
          throw new Error("Text chunk exceeds model token limit");
        const output = await session(value, {
          pooling: "mean",
          normalize: true,
          truncation: false,
        });
        chunks.push({ start, end, vector: normalized(output.data) });
        if (end >= tokens.length) break;
        start = Math.max(start + 1, end - 16);
      }
      results.push(chunks);
    }
  } else if (request.kind === "visualText") {
    for (const input of request.texts) {
      results.push(normalized(await session.encode(input)));
    }
  } else {
    for (const input of request.images) {
      const { data, info } = await sharp(Buffer.from(input), {
        limitInputPixels: 100000000,
      })
        .rotate()
        .toColourspace("srgb")
        .flatten({ background: "#ffffff" })
        .resize(224, 224, {
          fit: "contain",
          background: { r: 123, g: 117, b: 104 },
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels = new RawImage(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        info.channels,
      );
      const output = await session(await processor(pixels));
      results.push(normalized(output.image_embeds.data));
    }
  }
  return results;
}
const port = process.parentPort || parentPort;
port.on("message", (event) => {
  clearTimeout(timer);
  work = work.then(async () => {
    const message = process.parentPort ? event.data : event;
    try {
      port.postMessage({ id: message.id, result: await run(message) });
    } catch (e) {
      port.postMessage({
        id: message.id,
        error: String(e.message).slice(0, 300),
      });
    } finally {
      timer = setTimeout(() => {
        work = work.then(release).catch(() => {});
      }, 60000);
      timer.unref?.();
    }
  });
});
