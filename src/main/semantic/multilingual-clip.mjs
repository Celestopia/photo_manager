import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer } from '@huggingface/transformers';

// The upstream ONNX graph exports token features, not CLIP-space sentences.
export function readProjection(bytes) {
  const headerSize = Number(bytes.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerSize) || headerSize < 1 || headerSize > 65536)
    throw new Error('Invalid multilingual projection header');
  const header = JSON.parse(bytes.subarray(8, 8 + headerSize).toString('utf8'));
  const weight = header['linear.weight'];
  if (weight?.dtype !== 'F32' || JSON.stringify(weight.shape) !== '[512,768]' ||
      JSON.stringify(weight.data_offsets) !== '[0,1572864]' || bytes.length !== 8 + headerSize + 1572864)
    throw new Error('Invalid multilingual projection weights');
  const result = new Float32Array(512 * 768);
  for (let i = 0; i < result.length; i++) {
    result[i] = bytes.readFloatLE(8 + headerSize + i * 4);
    if (!Number.isFinite(result[i])) throw new Error('Nonfinite projection weight');
  }
  return result;
}

export function projectTokens(data, mask, projection) {
  if (data.length !== mask.length * 768 || projection.length !== 512 * 768)
    throw new Error('Invalid multilingual encoder output dimensions');
  const mean = new Float64Array(768);
  let count = 0;
  for (let token = 0; token < mask.length; token++) {
    if (!Number(mask[token])) continue;
    count++;
    for (let j = 0; j < 768; j++) mean[j] += data[token * 768 + j];
  }
  if (!count) throw new Error('Empty multilingual query');
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    let value = 0;
    for (let j = 0; j < 768; j++) value += projection[i * 768 + j] * mean[j] / count;
    out[i] = value;
  }
  return out;
}

export async function loadMultilingualClip(directory) {
  const tokenizer = await AutoTokenizer.from_pretrained(directory, { local_files_only: true });
  const projection = readProjection(await fs.readFile(path.join(directory, '2_Dense/model.safetensors')));
  const session = await ort.InferenceSession.create(path.join(directory, 'onnx/model_quint8_avx2.onnx'), {
    executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1,
  });
  return {
    async encode(text) {
      if (tokenizer.encode(text).length > 128)
        throw new Error('Search keywords exceed the model limit; shorten the query.');
      const tokens = await tokenizer(text, { padding: true, truncation: false });
      const feeds = Object.fromEntries(session.inputNames.map(name => {
        const tensor = tokens[name];
        if (!tensor) throw new Error('Unsupported multilingual model input');
        return [name, new ort.Tensor(tensor.type, tensor.data, tensor.dims)];
      }));
      const result = await session.run(feeds);
      const features = result.last_hidden_state;
      if (!features || features.dims.length !== 3 || features.dims[0] !== 1 || features.dims[2] !== 768)
        throw new Error('Unexpected multilingual model output');
      return projectTokens(features.data, tokens.attention_mask.data, projection);
    },
    dispose: () => session.release(),
  };
}
