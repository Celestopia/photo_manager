# Consequences of the Local Embedding MVP

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

## Main changes

- **All embeddings are local**, including photo/video frames and descriptive metadata. Private images, hidden descriptions and people data are not sent to an embedding API.
- **Cloud VLM remains available** for explicitly selected chat/Q&A/edit analysis. Ordinary search no longer automatically sends candidate images or metadata for cloud verification.
- **New model download/import controls:** approximately 272 MB of quantized weights, roughly 300 MB with tokenizer/config files, plus the CPU runtime packaged with the application.
- **CPU inference:** no Python, CUDA, GPU or user-run embedding server. Initial indexing consumes local time, memory and disk; no embedding API charges.
- **MVP quality:** accept weaker visual retrieval, especially small details and Chinese visual queries. Return labelled candidates rather than pretending CLIP scores confirm every requested condition.

## Model assets

CLIP ViT-B/32 has separate quantized image/text encoders, approximately 89.1 MB +64.5 MB. [Selected files](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/d15189d7028b43f1d3e65039190477f6af591c2a/onnx). Multilingual MiniLM-L12-v2 quantized weights are approximately 118 MB. [Selected files](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/2c4055b12046f11709e9df2c122e59ffbdc2f900/onnx).

Download only the pinned files, not whole repositories. Model assets live under Local AppData and are shared by libraries. Download is explicit, cancellable, validated and resumable; offline folder import is supported. Reserve 1 GiB free disk for installation. Reading this specification or opening the application must not start a model download.

The new native dependency is CPU ONNX Runtime through Transformers.js. Package and test its Windows x64 native binaries; exact installer growth is measured during packaging. Target at most 1.5 GiB additional inference memory with one loaded encoder, not a promise of actual usage.

## What can still leave the computer

Cloud natural-language planning sends only the user's typed query, not stored metadata or media. It may translate the typed visual query into English for CLIP. Host-local tools resolve library identities and rank/display candidates. Local-query mode accepts English visual text and gallery filters and works offline after model installation.

Cloud Q&A/analysis sends selected derivatives and enabled metadata groups immediately when the user presses Send; optional context inspection is available in composer Options. Existing tags may be looked up for tagging requests without a separate catalogue checkbox. That action is explicitly scoped to those items/groups; it is not permission to upload the library. Optional Analyze selected with cloud on search results uses the same boundary. No automatic cloud reranking, result summarization with library evidence or remote embedding fallback.

Local indexing is free of API charges, but cloud planning/Q&A still incurs provider charges under the existing configurable budgets. Stop may not prevent billing for an already accepted cloud request. API key/base URL/model remain in the configuration file; inline keys are plaintext there, with an environment-variable alternative.

## Index size

Visual vectors are 512D (2,048 bytes); metadata vectors 384D (1,536 bytes), both float32. Illustrations assume exactly two metadata chunks per media:

| Library | Raw vector storage |
| --- | --- |
| 10,000 photos | 48.8 MiB |
| 8,000 photos +2,000 30-minute videos at 120 samples/video | 513.7 MiB |
| 10,000 30-minute videos | 2.32 GiB |

Token-based metadata chunking can produce more than two chunks, especially for long descriptions. These exclude models, manifests, receipts, backups and temporary generation copies. Sharded exact search remains local and memory-bounded. Changing the embedding model or preprocessing requires rebuilding the affected vector space; metadata and undo receipts are unaffected.

## Retained features and boundaries

Keep reviewed title/description/existing-tag editing, viewer draft merge/save, gallery batch review, explicit index manager, 30-day durable edit receipts/undo, temporary session chats and foreground Stop/Continue behavior. Batch windows remain 100 media with 500 items awaiting review. Video sampling remains capped at 120 frames through 30 minutes; longer videos remain metadata-only. No audio transcription, face recognition, geocoder or exhaustive retrieval guarantee.

The index manager gains model availability/download/import status. Search gains an explicit distinction between local visual candidates and voluntarily cloud-verified results. Lower semantic quality is accepted for MVP; strict write correctness, scope checks, stale-vector exclusion and no-upload tests remain mandatory.

All interface controls are English under the latest AGENTS.md. Assistant replies follow the user's language. Existing light-blue styling and Unicode metadata remain unchanged.
