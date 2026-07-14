<template>
  <div class="tag-modal-backdrop" v-if="initializationConfirm.visible" @click="closeInitializationConfirm">
    <section class="library-confirm-modal" @click.stop>
      <header class="tag-manager-header"><h3>初始化新图库</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeInitializationConfirm">×</button></header>
      <div class="library-confirm-body">
        <p>你选择的目录尚未初始化为照片管理器图库。继续后，应用会递归遍历该目录及其中的普通隐藏目录，读取所有受支持的图片和视频，并为每个可读取的媒体计算完整 SHA-256、读取图片 EXIF 与技术信息、使用 FFprobe 探测视频。应用将在图库根目录创建 <code>.photo_manager</code>，用于保存元数据、标签/相册/人物/地点注册表、缩略图缓存、日志、备份和临时文件。</p>
        <p>初始化不会移动、重命名、修改或删除原始媒体文件，但大型图库可能需要较长时间，并会产生持续的磁盘读取和视频探测负载。初始化期间请不要断开移动硬盘、关闭计算机、修改目录权限或移动正在处理的文件。你可以取消初始化；取消后，本轮创建的全部未完成管理数据都会被删除。该目录必须是一个独立的图库根目录，不能位于其它图库中，也不能包含嵌套图库。</p>
        <div class="library-confirm-summary"><strong>{{ initializationConfirm.name }}</strong><span>{{ initializationConfirm.path }}</span><span>发现 {{ initializationConfirm.mediaCount }} 个支持的媒体文件</span></div>
        <label class="library-confirm-check"><input type="checkbox" v-model="initializationConfirm.acknowledged" />我已了解应用将遍历整个目录并创建图库管理数据。</label>
        <div class="tag-create-actions"><button class="btn" @click="closeInitializationConfirm">取消</button><button class="btn btn-primary" :disabled="!initializationConfirm.acknowledged" @click="confirmInitializeLibrary">开始初始化</button></div>
      </div>
    </section>
  </div>

  <div class="tag-modal-backdrop" v-if="libraryInfo.visible" @click="closeLibraryInfo">
    <section class="library-info-modal" @click.stop>
      <header class="tag-manager-header"><h3>图库信息</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeLibraryInfo">×</button></header>
      <div class="library-info-grid">
        <label>图库名称</label><input class="input" v-model="libraryInfo.name" maxlength="100" />
        <label>完整路径</label><div class="library-info-value">{{ libraryState.active?.root }}</div>
        <label>图库 UUID</label><div class="library-info-value">{{ libraryState.active?.libraryId }}</div>
        <label>创建时间</label><div class="library-info-value">{{ libraryState.active?.createdAt }}</div>
        <label>更新时间</label><div class="library-info-value">{{ libraryState.active?.updatedAt }}</div>
        <label>媒体数量</label><div class="library-info-value">{{ libraryState.active?.mediaCount || 0 }}（图片 {{ libraryState.active?.imageCount || 0 }} / 视频 {{ libraryState.active?.videoCount || 0 }}）</div>
      </div>
      <div class="library-info-actions"><button class="btn" @click="openLibraryRoot">打开图库目录</button><button class="btn" @click="openLibraryManagerDir">打开图库数据目录</button><span class="grow"></span><button class="btn" @click="closeLibraryInfo">取消</button><button class="btn btn-primary" @click="saveLibraryInfo">保存</button></div>
    </section>
  </div>

  <div class="tag-modal-backdrop" v-if="maintenanceDialog.visible" @click="maintenanceDialog.running ? null : closeMaintenanceDialog()">
    <section class="maintenance-modal" @click.stop>
      <header class="tag-manager-header"><h3>{{ maintenanceDialogTitle }}</h3><button v-if="!maintenanceDialog.running" class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeMaintenanceDialog">×</button></header>
      <div v-if="!maintenanceDialog.running && !maintenanceDialog.completed" class="maintenance-options">
        <p class="maintenance-description">{{ maintenanceDialogDescription }}</p>
        <label v-if="maintenanceDialog.operation === 'verify'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.reprobe" />重新使用 FFprobe 检查视频（耗时较长）</label>
        <label v-if="maintenanceDialog.operation === 'thumbnails'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.force" />强制重新生成全部缩略图</label>
        <p v-if="maintenanceDialog.operation === 'export'">CSV 将写入当前图库的 <code>.photo_manager/data/photo_metadata.csv</code>。</p>
        <div class="tag-create-actions"><button class="btn" @click="closeMaintenanceDialog">取消</button><button class="btn btn-primary" @click="startMaintenanceOperation">开始</button></div>
      </div>
      <div v-else class="maintenance-progress">
        <strong>{{ maintenanceDialog.progress.message || (maintenanceDialog.completed ? '任务已完成' : '正在处理') }}</strong>
        <progress v-if="maintenanceDialog.progress.total" :value="maintenanceDialog.progress.processed || 0" :max="maintenanceDialog.progress.total"></progress>
        <div class="library-progress-path" v-if="maintenanceDialog.progress.current">{{ maintenanceDialog.progress.current }}</div>
        <pre v-if="maintenanceDialog.reportText">{{ maintenanceDialog.reportText }}</pre>
        <div class="tag-create-actions" v-if="maintenanceDialog.completed"><button class="btn" @click="copyMaintenanceReport">复制报告</button><button class="btn" @click="openLibraryLogDir">打开日志</button><button v-if="maintenanceDialog.operation === 'export' && !maintenanceDialog.error" class="btn" @click="showMaintenanceOutput">定位 CSV</button><button class="btn btn-primary" @click="closeMaintenanceDialog">关闭</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { LIBRARY_CONTEXT } from "../../context/renderer-contexts.js";

const context = inject(LIBRARY_CONTEXT);
if (!context) throw new Error("LibraryDialogs requires LIBRARY_CONTEXT");
const {
  initializationConfirm, libraryInfo, libraryState, maintenanceDialog,
  maintenanceDialogTitle, maintenanceDialogDescription, closeInitializationConfirm,
  confirmInitializeLibrary, closeLibraryInfo, openLibraryRoot, openLibraryManagerDir,
  saveLibraryInfo, closeMaintenanceDialog, startMaintenanceOperation,
  copyMaintenanceReport, openLibraryLogDir, showMaintenanceOutput,
} = context;
</script>
