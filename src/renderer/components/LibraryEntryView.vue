<template>
  <header class="topbar library-entry-topbar">
    <div class="library-entry-brand">照片管理器</div>
    <div class="window-controls">
      <button class="btn ghost icon-btn" data-tip="最小化" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="最小化" /></button>
      <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
      <button class="btn ghost danger icon-btn" data-tip="关闭" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="关闭" /></button>
    </div>
  </header>
  <main class="library-entry-main">
    <section class="library-entry-panel">
      <header>
        <h1>选择图库</h1>
        <p>图库中的管理数据会保存在该目录下的 <code>.photo_manager</code> 中。</p>
      </header>

      <div v-if="!libraryState.mediaTools?.available" class="library-entry-alert error">
        <strong>媒体工具不可用</strong>
        <p>{{ libraryState.mediaTools?.error || '无法使用 FFmpeg 和 FFprobe。' }}</p>
        <button class="btn" :disabled="entry.busy" @click="recheckMediaTools">重新检查</button>
      </div>

      <div v-if="entry.libraryName || entry.libraryPath" class="library-entry-current">
        <strong>{{ entry.libraryName || '未命名图库' }}</strong>
        <span>{{ entry.libraryPath }}</span>
      </div>

      <div v-if="entry.busy" class="library-progress-panel">
        <div class="library-progress-heading"><strong>{{ progressTitle }}</strong><span v-if="entry.progress.total">{{ entry.progress.processed || 0 }} / {{ entry.progress.total }}</span></div>
        <progress v-if="entry.progress.total" :value="entry.progress.processed || 0" :max="entry.progress.total"></progress>
        <div class="library-progress-path" v-if="entry.progress.current">{{ entry.progress.current }}</div>
        <button v-if="entry.cancellable" class="btn danger-text" @click="cancelLibraryOperation">取消</button>
      </div>

      <div v-if="entry.error" class="library-entry-alert error">
        <strong>无法打开图库</strong>
        <p>{{ entry.error }}</p>
      </div>

      <div class="library-entry-actions">
        <button v-if="entry.canRetry" class="btn" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="retryLastLibrary">重试</button>
        <button class="btn btn-primary" :disabled="entry.busy || !libraryState.mediaTools?.available" @click="chooseLibrary">选择图库</button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, inject } from "vue";

const app = inject("appContext");
if (!app) throw new Error("LibraryEntryView must be used under App.vue provider");

const {
  ICONS,
  WINDOW_ACTIONS,
  libraryState,
  entry,
  chooseLibrary,
  retryLastLibrary,
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
    validate: "验证图库目录",
    "scan-directories": "检查图库边界",
    "quick-scan": "统计媒体文件",
    scan: "扫描媒体文件",
    metadata: "读取媒体元数据",
    write: "写入图库数据",
    verify: "验证图库数据",
    complete: "完成",
  };
  return entry.progress?.message || labels[phase] || "正在处理图库";
});
</script>
