# Native Agent Implementation Plan

Status: implementation in progress. This is the maintained target specification; the [agent runtime reference](../reference/agent-support.md) records implemented behavior and measured validation. The remaining release gates are not implied complete. Technical references were checked on 2026-09-09.

Parent: [project documentation](../README.md). Current behavior: [implemented reference](../../PROJECT.md).

## Fixed decisions

| Area | Decision |
| --- | --- |
| Chat, image Q&A, query planning, edit proposals, visual verification | Remote Qwen `qwen3-vl-plus-2025-12-19`, thinking disabled |
| Image and sampled-frame embeddings; compatible query embedding | Local quantized CLIP ViT-B/32, 512 dimensions |
| Descriptive metadata embeddings | Local quantized multilingual MiniLM-L12-v2, 384 dimensions |
| Default cloud service | Alibaba Cloud Model Studio, Beijing; base URL, model and API key in the configuration file; chat/query planning/explicit selected analysis only |
| Local support | User-operated server implementing the exact contracts in providers.md; no model installer |
| Vector storage/search | Library-local float32 shards, exact cosine search in a worker; no database or ANN |
| Metadata representation | Separate descriptive and contextual text documents, plus exact current metadata |
| Video | Uniform full-duration sampling every approximately 15 seconds, capped at 120 frames; up to 30 minutes |
| Editable fields | Title, description and existing tags only; review required |
| Viewer | Right sidebar Customization / Assistant tabs; review into draft, then explicit save |
| Gallery | One right sidebar, search / batch-agent modes, mutually exclusive with manual batch panel |
| Agent language/theme | English UI under current AGENTS.md; replies follow user language; light-blue tokens |
| Auxiliary screens | Agent settings, index management, and 30-day edit history/undo |
| Downloads/runtime | Approximately 300 MB model assets; Transformers.js/ONNX Runtime CPU; no Python/CUDA |
| Conversation lifetime | Bounded library-session memory only |
| Delivery | Six ordered implementation stages with release gates |

## Implementation documents

1. [requirements.md](requirements.md): product contract and exclusions.
2. [providers.md](providers.md): exact models, endpoints, payloads, credentials and budgets.
3. [retrieval.md](retrieval.md): projections, frame sampling, ranking, evidence and index files.
4. [ui.md](ui.md): concrete screens, dimensions, labels and interactions.
5. [architecture.md](architecture.md): modules, tools, IPC, writes, lifecycle and recovery.
6. [validation.md](validation.md): ordered work packages and acceptance tests.
7. [consequences.md](consequences.md): uploads, money, disk, limitations and auxiliary scope.

8. [local-embeddings.md](local-embeddings.md): pinned local models, runtime, download sizes and upload boundary.

Local indexing includes metadata; ordinary search uploads no candidate pixels or stored metadata. Cloud analysis requires an explicit selected-media send action.

Each fact has an owning document. Numeric defaults are selected engineering policy, not performance claims or values supplied by the owner. Tests validate this design; they do not leave model/storage/UI selection open. A failed release gate blocks release and requires a documented fix, not silent substitution.

[PROJECT.md](../../PROJECT.md) links to the implemented reference. As work ships, update [runtime architecture](../reference/architecture.md), [configuration](../reference/configuration.md), [persistence](../reference/library-lifecycle.md), [data contracts](../reference/data-model.md), [media processing](../reference/media-pipeline.md), [UI](../reference/interface.md) and [acceptance](../reference/maintenance-and-testing.md) as applicable. Core metadata schema remains version 4.

These files are permanent repository documentation. Review design changes alongside their consequences and update the owning implemented reference when functionality is delivered. Keep current decisions here, not discussion history.
