<template>
  <header class="topbar library-entry-topbar">
    <div class="library-entry-brand"><img :src="appIcon" alt="" />Photo Manager</div>
    <div class="window-controls">
      <button class="btn ghost icon-btn" data-tip="Minimize" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="Minimize" /></button>
      <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
      <button class="btn ghost danger icon-btn" data-tip="Close" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="Close" /></button>
    </div>
  </header>
  <main class="library-entry-main">
    <div class="library-welcome-layout">
      <section class="library-welcome-intro" aria-labelledby="welcome-title">
        <div class="library-welcome-copy">
          <img class="library-welcome-icon" :src="appIcon" alt="" />
          <h1 id="welcome-title">Welcome to<br />Photo Manager</h1>
          <p class="library-welcome-tagline">Your photos and videos,<br />thoughtfully organized.</p>
        </div>
      </section>
      <section class="library-entry-panel" aria-labelledby="open-library-title" :aria-busy="entry.busy">
        <div class="library-entry-workflow">
          <header>
            <h2 id="open-library-title">Open a library</h2>
            <p>{{ entry.libraryPath ? 'Continue with your selected library.' : 'Choose a folder to get started.' }}</p>
          </header>
          <div v-if="!libraryState.mediaTools?.available" class="library-entry-alert error" role="alert">
            <strong>Media tools unavailable</strong>
            <p>{{ libraryState.mediaTools?.error || 'FFmpeg and FFprobe are unavailable.' }}</p>
            <button class="btn" :disabled="entry.busy" @click="recheckMediaTools">Check again</button>
          </div>
          <div v-if="entry.libraryName || entry.libraryPath" class="library-entry-current">
            <div class="library-entry-current-info">
              <strong>{{ entry.libraryName || 'Unnamed Library' }}</strong>
              <span class="library-filesystem-path">{{ entry.libraryPath }}</span>
            </div>
          </div>
          <div class="library-entry-actions">
            <button v-if="entry.canOpenLibrary" class="btn btn-primary" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="enterLibraryFromEntry">{{ entry.busy ? 'Opening library…' : 'Open library' }}</button>
            <button class="btn" :class="entry.canOpenLibrary ? 'library-entry-choose' : 'btn-primary'" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="chooseLibrary">{{ entry.libraryPath ? 'Choose another folder…' : 'Choose folder…' }}</button>
          </div>
          <div class="library-entry-status" aria-live="polite">
            <div v-if="entry.busy" class="library-progress-panel">
              <div class="library-progress-heading"><strong>{{ progressTitle }}</strong><span v-if="entry.progress.total">{{ entry.progress.processed || 0 }} / {{ entry.progress.total }}</span></div>
              <progress :value="entry.progress.total ? (entry.progress.processed || 0) : undefined" :max="entry.progress.total || 1" aria-label="Library opening progress"></progress>
              <div class="library-progress-path library-filesystem-path" v-if="entry.progress.current">{{ entry.progress.current }}</div>
              <button v-if="entry.cancellable" class="btn danger-text" @click="cancelLibraryOperation">Cancel</button>
            </div>
            <div v-if="entry.error" class="library-entry-alert error" role="alert">
              <strong>Unable to open library</strong><p>{{ entry.error }}</p>
            </div>
          </div>
          <p class="library-entry-note">A library is a folder containing your photos and videos.</p>
        </div>
      </section>
    </div>
    <footer class="library-entry-footer"><span>Photos · Videos · Places</span><span>v{{ appVersion }}</span></footer>
  </main>
</template>

<script setup>
import { computed, inject } from "vue";
import { version as appVersion } from "../../../package.json";
import appIcon from "../../../build/icon.svg";
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
