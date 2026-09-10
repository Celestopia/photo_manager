const fs = require("node:fs/promises");
const yaml = require("js-yaml");
const { writeTextAtomic } = require("../../../scripts/library-core");
const { exact, text, fingerprint } = require("../../shared/agent-schema");

const DEFAULT_PROVIDERS = {
  schemaVersion: 1,
  active: { conversation: "qwen-vlm", vision: "qwen-vlm", visualEmbedding: "local-clip", metadataEmbedding: "local-minilm" },
  profiles: {
    "qwen-vlm": { protocol: "chat-completions", baseUrl: "https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", apiKey: "", apiKeyEnv: "PHOTO_MANAGER_QWEN_API_KEY", model: "qwen3-vl-plus-2025-12-19", modelRevision: "2025-12-19", supportsImages: true, supportsTools: true, streaming: true, providerOptions: { enable_thinking: false } },
    "local-clip": { protocol: "local-onnx-clip", model: "Xenova/clip-vit-base-patch32", modelRevision: "d15189d7028b43f1d3e65039190477f6af591c2a", dimension: 512, dtype: "q8" },
    "local-minilm": { protocol: "local-onnx-text", model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", modelRevision: "2c4055b12046f11709e9df2c122e59ffbdc2f900", dimension: 384, dtype: "q8" },
  },
};
function validateProviders(value) {
  exact(value, ["schemaVersion", "active", "profiles"]);
  if (value.schemaVersion !== 1) throw new Error("Unsupported provider schema");
  exact(value.active, Object.keys(DEFAULT_PROVIDERS.active));
  if (!value.profiles || Array.isArray(value.profiles) || Object.keys(value.profiles).length > 20) throw new Error("Invalid profiles");
  for (const [id, p] of Object.entries(value.profiles)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid profile ID");
    if (p?.protocol === "chat-completions") {
      exact(p, Object.keys(DEFAULT_PROVIDERS.profiles["qwen-vlm"]));
      for (const k of ["baseUrl", "apiKey", "apiKeyEnv", "model", "modelRevision"]) text(p[k], 2048, k);
      const u = new URL(p.baseUrl);
      const local = u.hostname === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname === "[::1]";
      if ((u.protocol !== "https:" && !(local && u.protocol === "http:")) || u.username || u.password || u.search || u.hash) throw new Error("Invalid provider URL");
      for (const k of ["supportsImages", "supportsTools", "streaming"]) if (typeof p[k] !== "boolean") throw new Error(`Invalid ${k}`);
      exact(p.providerOptions, ["enable_thinking"], []);
      if (Object.hasOwn(p.providerOptions, "enable_thinking") && typeof p.providerOptions.enable_thinking !== "boolean") throw new Error("Invalid thinking option");
    } else {
      const expected = p?.protocol === "local-onnx-clip" ? DEFAULT_PROVIDERS.profiles["local-clip"] : DEFAULT_PROVIDERS.profiles["local-minilm"];
      if (fingerprint(p) !== fingerprint(expected)) throw new Error("Only the pinned local embedding profiles are supported");
    }
  }
  for (const [role, id] of Object.entries(value.active)) {
    const expected = role === "visualEmbedding" ? "local-onnx-clip" : role === "metadataEmbedding" ? "local-onnx-text" : "chat-completions";
    if (value.profiles[id]?.protocol !== expected) throw new Error(`Invalid ${role} profile`);
  }
  return value;
}
function createProviderConfig(file, environment = process.env) {
  let config = null, error = "";
  async function reload() {
    try {
      let source;
      try { source = await fs.readFile(file, "utf8"); } catch (e) {
        if (e.code !== "ENOENT") throw e;
        source = yaml.dump(DEFAULT_PROVIDERS); await writeTextAtomic(file, source);
      }
      config = validateProviders(yaml.load(source)); error = "";
    } catch { config = null; error = "Invalid agent-providers.yml. Check the documented schema and reload."; }
    return status();
  }
  function status() {
    return { file, error, profiles: config ? Object.entries(config.active).map(([role, id]) => {
      const p = config.profiles[id];
      return { role, id, protocol: p.protocol, model: p.model, baseUrl: p.baseUrl || "", configured: p.protocol !== "chat-completions" || !p.baseUrl.includes("YOUR_WORKSPACE_ID"), keyConfigured: Boolean(p.apiKey || environment[p.apiKeyEnv]) };
    }) : [] };
  }
  function get(role) {
    if (!config) throw new Error(error || "Reload agent configuration first");
    const p = structuredClone(config.profiles[config.active[role]]);
    if (!p || p.baseUrl?.includes("YOUR_WORKSPACE_ID")) throw new Error("Configure the model base URL in agent-providers.yml");
    if (p.protocol === "chat-completions") p.apiKey = p.apiKey || environment[p.apiKeyEnv] || "";
    return p;
  }
  return { reload, status, get };
}
module.exports = { DEFAULT_PROVIDERS, validateProviders, createProviderConfig };
