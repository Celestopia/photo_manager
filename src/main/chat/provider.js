const { normalizeUsage } = require("./usage");
const fs = require("node:fs/promises");
const yaml = require("js-yaml");
const { object } = require("./schema");
const { writeTextAtomic } = require("../../../scripts/library-core");
const DEFAULT = {
  schemaVersion: 1,
  baseUrl: "",
  apiKey: "",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  model: "qwen3-vl-plus-2025-12-19",
  streaming: true,
  enable_thinking: false,
};
async function ensureConfig(file) {
  try {
    await fs.access(file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await writeTextAtomic(file, yaml.dump(DEFAULT));
  }
}
async function readConfig(file) {
  await ensureConfig(file);
  let c;
  try {
    c = yaml.load(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error("Invalid chat-provider.yml. Correct the YAML and reload.");
  }
  return c;
}
function validateConfig(c, env = process.env) {
  if (!c || typeof c !== "object" || Array.isArray(c)) {
    throw new Error("Provider configuration must contain the documented YAML fields.");
  }
  const fields = [
    "schemaVersion",
    "baseUrl",
    "apiKey",
    "apiKeyEnv",
    "model",
    "streaming",
  ];
  object(
    c,
    [...fields, ...("enable_thinking" in (c || {}) ? ["enable_thinking"] : [])],
    "Provider configuration",
  );
  if (
    c.schemaVersion !== 1 ||
    fields.slice(1, 5).some((k) => typeof c[k] !== "string") ||
    typeof c.streaming !== "boolean" ||
    ("enable_thinking" in c && typeof c.enable_thinking !== "boolean")
  )
    throw new Error("Invalid provider configuration fields.");
  if (!c.model.trim())
    throw new Error("Set a model name in chat-provider.yml.");
  let url;
  try {
    url = new URL(c.baseUrl);
  } catch {
    throw new Error("Set your provider base URL in chat-provider.yml.");
  }
  const host = url.hostname;
  const local =
    host === "localhost" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use HTTPS for remote APIs or HTTP for a local server, without URL credentials or query parameters.",
    );
  return {
    ...c,
    streaming: true, // Normalize the former user preference to fixed streaming.
    baseUrl: c.baseUrl.replace(/\/+$/, ""),
    apiKey: c.apiKey || env[c.apiKeyEnv] || "",
  };
}
async function config(file, env = process.env) {
  return validateConfig(await readConfig(file), env);
}
async function editableConfig(file) {
  const c = await readConfig(file);
  // Never send a stored credential or environment value to the renderer.
  return { baseUrl: c.baseUrl, model: c.model, apiKeyEnv: c.apiKeyEnv,
    thinking: c.enable_thinking === undefined ? "omit" : String(c.enable_thinking),
    hasKey: Boolean(c.apiKey), apiKey: "", clearKey: false };
}
async function saveConfig(file, draft) {
  object(draft, ["baseUrl", "model", "apiKeyEnv", "thinking", "apiKey", "clearKey"], "Provider settings");
  if (["baseUrl", "model", "apiKeyEnv", "apiKey", "thinking"].some(k => typeof draft[k] !== "string" || draft[k].length > 4096) ||
      typeof draft.clearKey !== "boolean" || !["omit", "true", "false"].includes(draft.thinking))
    throw new Error("Invalid provider settings.");
  const previous = await readConfig(file);
  const c = { schemaVersion: 1, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(),
    apiKeyEnv: draft.apiKeyEnv.trim(), apiKey: draft.clearKey ? "" : (draft.apiKey || previous.apiKey), streaming: true };
  if (draft.thinking !== "omit") c.enable_thinking = draft.thinking === "true";
  validateConfig(c);
  await writeTextAtomic(file, yaml.dump(c));
  return editableConfig(file);
}
async function request(
  c,
  messages,
  { signal, onText = () => {}, onUsage = () => {}, fetchImpl = fetch } = {},
) {
  const body = {
    model: c.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 4096,
  };
  if ("enable_thinking" in c) body.enable_thinking = c.enable_thinking;
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
    throw new Error(
      "The request exceeds 32 MiB. Remove inputs or choose optimized quality.",
    );
  const timeout = AbortSignal.timeout(60000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(c.baseUrl + "/chat/completions", {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
      },
      body: serialized,
      signal: combined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Provider returned HTTP ${response.status}. Check credentials, model availability and input limits; retry explicitly.`,
      );
    }
    let total = 0,
      text = "",
      buffer = "",
      done = false;
    const decoder = new TextDecoder();
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      await response.body?.cancel();
      throw new Error("Provider does not support streaming responses. Choose a streaming-compatible endpoint and model.");
    }
    function consume(event) {
      const data = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      if (data === "[DONE]") {
        done = true;
        return;
      }
      const parsed = JSON.parse(data);
      if (parsed.error)
        throw new Error(
          "Provider reported an error during the reply. Retry explicitly.",
        );
      if (parsed.usage) onUsage(normalizeUsage(parsed.usage));
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string") {
        text += delta;
        if (text.length > 200000)
          throw new Error("Provider response is too large.");
        onText(text);
      }
      if (choice?.finish_reason) done = true;
    }
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 2 * 1024 * 1024)
        throw new Error("Provider response is too large.");
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!done)
      throw new Error(
        "The connection ended before the reply completed. Retry explicitly.",
      );
    if (!text) throw new Error("Provider returned no text response.");
    return text;
  } catch (e) {
    if (signal?.aborted) throw new Error("Request stopped.");
    if (timeout.aborted)
      throw new Error(
        "The provider request timed out after 60 seconds. Retry explicitly.",
      );
    // Never surface a server body, key, URL or raw transport error.
    if (/^Provider |^The connection |^The request /.test(e.message)) throw e;
    throw new Error(
      "Unable to read the provider response. Check the connection and provider settings, then retry.",
    );
  }
}
module.exports = { DEFAULT, ensureConfig, config, request, editableConfig, saveConfig };
