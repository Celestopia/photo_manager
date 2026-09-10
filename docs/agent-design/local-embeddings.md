# Local Embedding MVP

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

This is the selected implementation, replacing cloud embedding calls. Both pixel/frame and metadata embeddings run locally. Cloud chat remains a separate, explicitly invoked workflow.

## Models and runtime

- Visual: Xenova/clip-vit-base-patch32 at revision d15189d7028b43f1d3e65039190477f6af591c2a. Load only onnx/vision_model_quantized.onnx and onnx/text_model_quantized.onnx, with the corresponding config, tokenizer and preprocessor files. CLIP projected output: 512 dimensions.
- Metadata: Xenova/paraphrase-multilingual-MiniLM-L12-v2 at revision 2c4055b12046f11709e9df2c122e59ffbdc2f900. Load only onnx/model_quantized.onnx plus config/tokenizer files. Attention-mask mean pooling and L2 normalization produce 384 dimensions.
- Runtime: @huggingface/transformers 3.7.2, CPU ONNX Runtime backend, dtype=q8, in an Electron utility process. Load CLIPTextModelWithProjection, CLIPVisionModelWithProjection, AutoTokenizer and AutoProcessor for the visual model; feature-extraction with pooling=mean and normalize=true for metadata. Pin the dependency/its resolved native runtime in the implementation lockfile. Package the Windows x64 CPU ONNX Runtime native files outside ASAR. No Python, CUDA, GPU or local HTTP server required for embeddings.
- At most one embedding batch in flight; image batch 1, text batch 8. Load only one encoder session at a time and release it when switching phases or after 60 seconds idle. Build metadata phase then visual phase, with separate resumable cursors, rather than alternating models per media.
- Float32 normalized vectors on disk even though model weights are quantized. Separate 512D visual and 384D metadata spaces; never mix dimensions or compare vectors across spaces.

The selected quantized CLIP encoders are approximately 89.1 MB +64.5 MB. [CLIP files](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/d15189d7028b43f1d3e65039190477f6af591c2a/onnx). The metadata weights are approximately 118 MB. [MiniLM files](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/2c4055b12046f11709e9df2c122e59ffbdc2f900/onnx). Total weights approximately 272 MB; plan for approximately 300 MB including tokenizer/config assets, excluding packaged native runtime. Do not download the multi-gigabyte repositories or other precisions.

## Model installation

Add one explicit “Download embedding models” action in settings/index management. Download allowlisted public artifacts only, with progress/cancel/resume, into %LOCALAPPDATA%/PhotoManager/models/<repository>/<revision> through application-paths helpers. This is global machine-owned model data; library vectors stay in .photo_manager/agent. No media, metadata, API keys or library paths accompany model downloads.

The release contains an artifact manifest with full repository revisions, exact file sizes and SHA256 digests obtained during packaging. Validate complete files before atomic activation; never follow a moving main alias. Reserve 1 GiB free disk for initial installation/staging. Support “Import model folder” with the identical manifest validation for offline/blocked-network installation. Model removal is explicit and does not delete vectors or receipts; embeddings remain unavailable until reinstalled.

Configure Transformers.js to use only the validated local directory and allowRemoteModels=false. Its default node_modules cache must never be used. The inference utility process has no HTTP capabilities exposed by the application; tests deny network and verify it still indexes. Download manager is separate from inference. A missing/corrupt model fails locally without cloud fallback.

## Preprocessing and language

Preserve the existing orientation-correct full-frame derivative. For CLIP, fit the complete frame inside 224x224, letterbox with the CLIP normalization mean RGB approximately (123,117,104), normalize using the pinned processor, and disable center cropping. Do not stretch or crop away image borders. This deliberately favors full-frame coverage over exact training preprocessing; expect weaker detail matching. Keep the 1024px derivative only for explicitly selected cloud Q&A.

CLIP text input uses at most 77 tokens including special tokens. The cloud query planner translates ONLY the user's visual query into concise English, at most 60 CLIP content tokens; it receives no library records or registry dictionary. Host tokenization validates the length. Without a cloud planner, allow the user to enter an English visual query alongside local gallery filters. No hidden local translation model. Metadata queries use the original Chinese/English with multilingual MiniLM.

Metadata documents retain the existing field grouping and every available descriptive field. Replace character chunking with tokenizer-aware chunks: at most 126 content tokens plus special tokens, 16 content-token overlap. Include field labels within the token budget; preserve source spans and embed every chunk. Never truncate a whole description to the model context window. Long text creates more vectors. [MiniLM model and pooling](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).

## Upload boundary

Embedding builds, refreshes, query encoders, exact/lexical matching and candidate ranking are local. This includes hidden descriptions, people and registry descriptions. No embedding provider endpoint exists in the MVP.

Ordinary natural-language search may send the user's typed request to the configured cloud planner, including place/person names the user typed, but sends no candidate pixels, paths, stored metadata, registry descriptions or result sets. Tools executed locally cannot return library facts to that cloud planner. After plan parsing, host resolves entities locally and constructs result cards/explanations without a cloud summary. In local-query mode with English visual text/gallery filters, search works offline after models are installed.

Automatic cloud visual verification is removed. Local vector hits are “Visual candidates”, not visually confirmed results. Exact metadata matches, metadata-supported hits, unknown facts and conflicts remain distinct.

Optional “Analyze selected with cloud” is a separate explicit action. Send freezes the selected MediaIds, derivative/frame bounds and enabled metadata groups before dispatch. Inspection of this context is optional in composer Options; a second confirmation is not required. The cloud model's tools can inspect only those selected IDs for that run. No automatic expansion to further gallery candidates. Changing selection or enabling additional metadata groups requires a new send action. Viewer/batch cloud chat uses the same selection chip, optional context inspection and single Send action; it does not silently attach hidden fields. All metadata remains available for an explicitly authorized selected-media analysis. Ordinary local indexing needs no privacy prompts.

There is no new persisted per-file privacy schema or automatic interpretation of existing privacy levels as cloud consent. Authorization is per run/selected scope, enforced by main. Selecting cloud Q&A intentionally transmits the approved content; local embeddings do not make cloud Q&A private.

## MVP expectations

Use the sampling, exact local storage, reviewed writes and undo specified in the other agent design documents. Accept lower retrieval quality and CPU build time; no GPU requirement or promise of cloud-model parity. Semantic recall and precision are reported measurements rather than numerical MVP release gates. Correctness and no-upload tests remain mandatory. Model installation is always an explicit application action.
