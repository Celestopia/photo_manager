# Models, Provider Contracts and Budgets

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

## Selected roles

| Role | Implementation |
| --- | --- |
| Cloud chat, Q&A, selected-media analysis | qwen3-vl-plus-2025-12-19; thinking disabled |
| Photo/frame and visual-query embeddings | Local quantized CLIP ViT-B/32, 512D |
| Descriptive/contextual metadata embeddings | Local quantized multilingual MiniLM-L12-v2, 384D |
| Runtime/downloads | [local-embeddings.md](local-embeddings.md) defines exact revisions, files, CPU runtime and upload boundary |

Cloud embeddings and their adapters are not part of the MVP. The local embedding profiles cannot be changed to HTTP endpoints. Changing local artifacts requires a validated manifest and rebuilding the affected vector space.

## Cloud VLM and user-operated chat server

Keep the Beijing default: base URL https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1, append /chat/completions. User enters its matching API key and model name. Use direct HTTPS JSON POST; standard messages/tools and SSE tool-call deltas. enable_thinking=false, temperature=0.2, max_tokens=4096 for conversation/proposals and 1024 for optional selected-item verification. Never execute partial tool arguments. No hosted agent service.

A user-operated server can replace chat/vision through the same chat-completions contract, optional Bearer key, configurable base URL/model. Omit Alibaba-specific options for local servers. No arbitrary protocol guessing or automatic remote fallback. Image/tool capabilities must pass a synthetic connection test. Chat-only servers cannot perform visual Q&A.

Cloud query planning receives only the user's typed query, a generic predicate schema and no library tools. It returns a plan and concise English visualQuery. Entity resolution and candidate ranking happen locally; no cloud result-summary call receives library facts. The separate local-query mode uses English visual text plus existing filters without a cloud call.

Viewer/batch and optional search-result analysis send only the selected media and enabled metadata groups when the user presses Send. Shared-context inspection is optional in composer Options; no second confirmation is required. A run-scoped main-process gate prevents tools expanding that scope. See local-embeddings.md.

## Configuration file

Source of truth: %LOCALAPPDATA%/PhotoManager/app-data/agent-providers.yml, via application-paths helpers. Generic budgets/retention remain in roaming config.yml.agent.

```yaml
schemaVersion: 1
active:
  conversation: qwen-vlm
  vision: qwen-vlm
  visualEmbedding: local-clip
  metadataEmbedding: local-minilm
profiles:
  qwen-vlm:
    protocol: chat-completions
    baseUrl: "https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    apiKey: ""
    apiKeyEnv: "PHOTO_MANAGER_QWEN_API_KEY"
    model: "qwen3-vl-plus-2025-12-19"
    modelRevision: "2025-12-19"
    supportsImages: true
    supportsTools: true
    streaming: true
    providerOptions:
      enable_thinking: false
  local-clip:
    protocol: local-onnx-clip
    model: "Xenova/clip-vit-base-patch32"
    modelRevision: "d15189d7028b43f1d3e65039190477f6af591c2a"
    dimension: 512
    dtype: q8
  local-minilm:
    protocol: local-onnx-text
    model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
    modelRevision: "2c4055b12046f11709e9df2c122e59ffbdc2f900"
    dimension: 384
    dtype: q8
```

Local model directories derive from the pinned model ID/revision under Local AppData; no arbitrary executable/model code. Embedding protocols intentionally have no apiKey/baseUrl.

Nonempty apiKey takes precedence; otherwise resolve apiKeyEnv. Inline keys are plaintext in this machine-local file, never renderer output/logs/library backups. Empty key and environment means unauthenticated local server access only. Strip a trailing base URL slash; reject URL credentials, query/fragment, redirects and non-HTTP(S). Remote requires HTTPS; explicit local/LAN profiles may use HTTP. Unknown keys and malformed YAML disable new runs with a sanitized error and leave the file untouched.

Settings offers Open configuration / Reload / Test connection, with redacted profile status. Reload is explicit, disabled during active runs; no watcher. Active run config is immutable. Missing placeholder values disable only cloud functions; installed local indexing remains usable. Cloud tests use synthetic text/two-color image and disclose the small possible charge; local model tests make no network calls.

## Limits

| Operation | Window |
| --- | --- |
| Viewer turn | 120 seconds, 8 VLM calls, 12 approved image/frame attachments, estimated CNY 1 |
| Pending local metadata refresh | 120 seconds, 500 chunks, zero API cost |
| Ordinary search | 180 seconds, at most 2 query-only planner calls, zero media attachments, estimated CNY 0.10 |
| Optional selected cloud verification | 180 seconds, <=40 selected media /50 calls /120 approved attachments, estimated CNY 2 |
| Batch selected-media analysis | 300 seconds, 100 new media /120 calls /400 approved attachments, estimated CNY 5 |
| Local index build | 30 minutes, 5,000 visual inputs /20,000 text chunks, zero API cost |

Stop on the first reached limit. Continue grants the same window and never expands the approved cloud-media scope. HTTP timeout 60 seconds; at most 2 retries for 429/502/503/504 (2 then 5 seconds, Retry-After capped at 30 seconds). Uncertain-billing timeout/disconnect or partial stream is not automatically replayed.

Maximum 8 tool rounds/4 calls per response; tool arguments <=64 KiB; result JSON <=4 MiB; one repair attempt for malformed structured output. At most 2 concurrent HTTP requests, one FFmpeg extraction, one embedding batch and one vector worker. VLM request <=16 MiB, <=8 images, text <=48 KiB; reserve conservatively within 24,000 estimated input tokens. Conversation context is last 12 completed turns within 24 KiB, preserving complete tool pairs.

Money limits are estimated scheduling stops, not invoice guarantees. Reserve input and maximum output before cloud dispatch, reconcile usage, show unknown cost for custom servers without a price table. Local indexing has no API bill but consumes CPU/time. Cancellation may not prevent billing of an already accepted cloud request. Logs contain only sanitized codes/role/request ID/operation ID.

No remote embedding drift probes: immutable local artifact checksums establish identity. No silent model upgrades or cloud embedding fallback. Cloud pricing remains a configurable estimate for Q&A/analysis only.
