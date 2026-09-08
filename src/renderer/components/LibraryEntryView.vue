<template>
  <header class="topbar library-entry-topbar">
    <div class="library-entry-brand">PhotoManager</div>
    <div class="window-controls">
      <button class="btn ghost icon-btn" data-tip="Minimize" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="Minimize" /></button>
      <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
      <button class="btn ghost danger icon-btn" data-tip="Close" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="Close" /></button>
    </div>
  </header>
  <main class="library-entry-main">
    <section class="library-entry-panel">
      <header>
        <h1>Select a Library</h1>
        <p>Library management data are stored in <code>.photo_manager</code> under the selected directory.</p>
      </header>

      <div v-if="!libraryState.mediaTools?.available" class="library-entry-alert error">
        <strong>Media tools unavailable</strong>
        <p>{{ libraryState.mediaTools?.error || 'FFmpeg and FFprobe are unavailable.' }}</p>
        <button class="btn" :disabled="entry.busy" @click="recheckMediaTools">Check again</button>
      </div>

      <div v-if="entry.libraryName || entry.libraryPath" class="library-entry-current">
        <div class="library-entry-current-info">
          <strong>{{ entry.libraryName || 'Unnamed Library' }}</strong>
          <span>{{ entry.libraryPath }}</span>
        </div>
        <button v-if="entry.canOpenLibrary" class="btn" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="enterLibraryFromEntry">Open Library</button>
      </div>

      <div v-if="entry.busy" class="library-progress-panel">
        <div class="library-progress-heading"><strong>{{ progressTitle }}</strong><span v-if="entry.progress.total">{{ entry.progress.processed || 0 }} / {{ entry.progress.total }}</span></div>
        <progress v-if="entry.progress.total" :value="entry.progress.processed || 0" :max="entry.progress.total"></progress>
        <div class="library-progress-path" v-if="entry.progress.current">{{ entry.progress.current }}</div>
        <button v-if="entry.cancellable" class="btn danger-text" @click="cancelLibraryOperation">Cancel</button>
      </div>

      <div v-if="entry.error" class="library-entry-alert error">
        <strong>Unable to open library</strong>
        <p>{{ entry.error }}</p>
      </div>

      <div class="library-entry-actions">
        <button class="btn btn-primary" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="chooseLibrary">Select Library</button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, inject } from "vue";
import { LIBRARY_CONTEXT } from "../context/renderer-contexts.js";

const app = inject(LIBRARY_CONTEXT);
if (!app) throw new Error("LibraryEntryView must be used under App.vue provider");

const {
  ICONS,
  WINDOW_ACTIONS,
  libraryState,
  entry,
  chooseLibrary,
  enterLibraryFromEntry,
  recheckMediaTools,
  cancelLibraryOperation,
  doWindowAction,
  toggleWindowMaximizeRestore,
  windowToggleTip,
  windowToggleIcon,
} = app;

const progressTitle = computed(() => {
  const phase = entry.progress?.phase || "";
  const labels = {
    validate: "Validating library directory",
    "scan-directories": "Checking library boundaries",
    "quick-scan": "Counting media files",
    scan: "Scanning media files",
    metadata: "Reading media metadata",
    write: "Writing library data",
    verify: "Verifying library data",
    complete: "Complete",
  };
  return entry.progress?.message || labels[phase] || "Processing library";
});
</script>
