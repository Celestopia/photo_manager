<template>
  <section class="semantic-index-options">
    <p v-if="!status && !error">Checking local models and index…</p>
    <template v-if="status">
      <p>
        <strong>Local embedding models</strong> ·
        {{ ready ? "Ready" : "Download or import required" }} ·
        {{
          Math.ceil(status.models.reduce((n, m) => n + m.bytes, 0) / 1048576)
        }}
        MiB
      </p>
      <div v-if="!ready" class="chat-row">
        <button class="btn" :disabled="busy" @click="install('download')">
          Download Models</button
        ><button class="btn" :disabled="busy" @click="install('import')">
          Import Model Folder
        </button>
      </div>
      <p v-if="status.index">
        {{ status.index.indexed }} / {{ status.index.total }} media indexed ·
        {{ status.index.missing }} without usable vectors ·
        {{ status.index.partial }} partially indexed
      </p>
      <p v-if="status.index?.outdated" class="retrieval-warning">
        {{ status.index.outdated }} indexed media have changed. Existing vectors
        remain searchable until you update this index.
      </p>
      <p v-if="status.error" class="chat-error">
        {{ status.error }}. Select Rebuild to repair the index.
      </p>
    </template>
    <p v-if="busy">{{ progress?.file || "Preparing models…" }}</p>
    <progress
      v-if="busy && progress?.total"
      :value="progress.completed"
      :max="progress.total"
    />
    <button v-if="busy" class="btn" @click="cancel">
      Cancel Download / Import
    </button>
    <p v-if="error" class="chat-error">{{ error }}</p>
    <small
      >Embeddings are built locally and updated only here. Hidden descriptions,
      file paths and ratings are excluded.</small
    >
  </section>
</template>
<script setup>
import { computed, watch } from "vue";
import { useSemanticIndex } from "../composables/use-semantic-index";
const props = defineProps({ api: Object });
const emit = defineEmits(["busy", "ready"]);
const { status, busy, error, progress, install, cancel } = useSemanticIndex(
  props.api,
);
const ready = computed(() =>
  Boolean(
    status.value?.models.length && status.value.models.every((m) => m.ready),
  ),
);
watch(busy, (v) => emit("busy", v), { immediate: true });
watch(ready, (v) => emit("ready", v), { immediate: true });
</script>
