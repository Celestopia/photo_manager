/** Developer-only: pin public artifact checksums; never reads a media library. */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sources = [
  { id: "clip", repository: "Xenova/clip-vit-base-patch32", revision: "d15189d7028b43f1d3e65039190477f6af591c2a", files: ["config.json", "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "onnx/text_model_quantized.onnx", "onnx/vision_model_quantized.onnx"] },
  { id: "minilm", repository: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900", files: ["config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"] },
];
async function main() {
  for (const source of sources) {
    const response = await fetch(`https://huggingface.co/api/models/${source.repository}/tree/${source.revision}?recursive=true`);
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const entries = await response.json();
    source.files = await Promise.all(source.files.map(async file => {
      const entry = entries.find(e => e.path === file);
      if (!entry) throw new Error(`Missing pinned artifact ${file}`);
      let sha256 = entry.lfs?.oid;
      if (!sha256) {
        const r = await fetch(`https://huggingface.co/${source.repository}/resolve/${source.revision}/${file}`);
        if (!r.ok) throw new Error(`Artifact HTTP ${r.status}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length !== entry.size) throw new Error("Unexpected artifact size");
        sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      }
      return { path: file, size: entry.size, sha256 };
    }));
  }
  const output = path.join(__dirname, "..", "src", "main", "agent", "model-manifest.json");
  await fs.writeFile(output, JSON.stringify({ version: 1, models: sources }, null, 2) + "\n");
  console.log(`Pinned ${sources.reduce((n, s) => n + s.files.length, 0)} public artifacts`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
