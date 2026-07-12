<template>
  <div class="app-shell">
    <GalleryView v-if="view === 'gallery'" />
    <ViewerView v-else />
    <div class="copy-toast" v-if="toast.visible">{{ toast.message }}</div>
    <div
      class="dynamic-tooltip"
      v-if="dynamicTooltip.visible"
      ref="dynamicTooltipRef"
      :style="{ left: dynamicTooltip.x + 'px', top: dynamicTooltip.y + 'px' }"
    >{{ dynamicTooltip.text }}</div>
    <div class="tag-modal-backdrop" v-if="tagManager.visible" @click="closeTagManager">
      <section class="tag-manager-modal" @click.stop>
        <header class="tag-manager-header">
          <h3>标签管理</h3>
          <div class="tag-manager-header-actions">
            <button class="btn icon-btn modal-symbol-btn" data-tip="新建标签" @click="openCreateTagMenu('manager')">+</button>
            <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeTagManager">×</button>
          </div>
        </header>
        <div class="tag-manager-controls">
          <input class="input tag-manager-search" v-model="tagManager.search" placeholder="搜索标签或说明" />
        </div>
        <div class="tag-manager-list">
          <article class="tag-manager-item" v-for="tag in managerFilteredTags" :key="'manager_' + tag.Text">
            <div class="tag-manager-item-main">
              <div class="tag-manager-item-title">
                <strong>{{ tag.Text }}</strong>
                <span>{{ tag.UsageCount || 0 }} 个媒体</span>
              </div>
              <textarea
                v-if="tagManager.editingText === tag.Text"
                class="input tag-manager-description-input"
                v-model="tagManager.editDescription"
                placeholder="可留空"
              ></textarea>
              <p v-else>{{ tag.Description || '无说明' }}</p>
              <div class="tag-manager-error" v-if="tagManager.error && tagManager.editingText === tag.Text">{{ tagManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="tagManager.editingText === tag.Text">
              <button class="btn btn-primary" @click="saveTagDescription">保存</button>
              <button class="btn" @click="cancelTagDescriptionEdit">取消</button>
            </div>
            <div class="tag-manager-actions" v-else>
              <button class="btn" @click="startTagDescriptionEdit(tag)">编辑说明</button>
              <button class="btn danger-text" @click="deleteTagGlobally(tag)">全局删除</button>
            </div>
          </article>
          <div class="tag-manager-empty" v-if="!managerFilteredTags.length">没有匹配的标签</div>
        </div>
      </section>
    </div>
    <div class="tag-modal-backdrop" v-if="albumManager.visible" @click="closeAlbumManager">
      <section class="tag-manager-modal" @click.stop>
        <header class="tag-manager-header">
          <h3>相册管理</h3>
          <div class="tag-manager-header-actions">
            <button class="btn icon-btn modal-symbol-btn" data-tip="新建相册" @click="openCreateAlbumMenu('manager')">+</button>
            <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeAlbumManager">×</button>
          </div>
        </header>
        <div class="tag-manager-controls">
          <input class="input tag-manager-search" v-model="albumManager.search" placeholder="搜索相册或说明" />
        </div>
        <div class="tag-manager-list">
          <article class="tag-manager-item" v-for="album in managerFilteredAlbums" :key="'album_manager_' + album.Title">
            <div class="tag-manager-item-main">
              <div class="tag-manager-item-title">
                <strong>{{ album.Title }}</strong>
                <span>{{ album.UsageCount || 0 }} 个媒体</span>
              </div>
              <textarea
                v-if="albumManager.editingTitle === album.Title"
                class="input tag-manager-description-input"
                v-model="albumManager.editDescription"
              ></textarea>
              <p v-else>{{ album.Description }}</p>
              <div class="tag-manager-error" v-if="albumManager.error && albumManager.editingTitle === album.Title">{{ albumManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="albumManager.editingTitle === album.Title">
              <button class="btn btn-primary" @click="saveAlbumDescription">保存</button>
              <button class="btn" @click="cancelAlbumDescriptionEdit">取消</button>
            </div>
            <div class="tag-manager-actions" v-else>
              <button class="btn" @click="startAlbumDescriptionEdit(album)">编辑说明</button>
              <button class="btn danger-text" @click="deleteAlbumGlobally(album)">全局删除</button>
            </div>
          </article>
          <div class="tag-manager-empty" v-if="!managerFilteredAlbums.length">没有匹配的相册</div>
        </div>
      </section>
    </div>
    <div class="tag-modal-backdrop" v-if="personManager.visible" @click="closePersonManager">
      <section class="tag-manager-modal" @click.stop>
        <header class="tag-manager-header">
          <h3>人物管理</h3>
          <div class="tag-manager-header-actions">
            <button class="btn icon-btn modal-symbol-btn" data-tip="新建人物" @click="openCreatePersonMenu('manager')">+</button>
            <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closePersonManager">×</button>
          </div>
        </header>
        <div class="tag-manager-controls">
          <input class="input tag-manager-search" v-model="personManager.search" placeholder="搜索姓名或说明" />
        </div>
        <div class="tag-manager-list">
          <article class="tag-manager-item" v-for="person in managerFilteredPeople" :key="'person_manager_' + person.Name">
            <div class="tag-manager-item-main">
              <div class="tag-manager-item-title">
                <strong>{{ person.Name }}</strong>
                <span>{{ person.UsageCount || 0 }} 个媒体</span>
              </div>
              <textarea
                v-if="personManager.editingName === person.Name"
                class="input tag-manager-description-input"
                v-model="personManager.editDescription"
                placeholder="可留空"
              ></textarea>
              <p v-else>{{ person.Description || '无说明' }}</p>
              <div class="tag-manager-error" v-if="personManager.error && personManager.editingName === person.Name">{{ personManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="personManager.editingName === person.Name">
              <button class="btn btn-primary" @click="savePersonDescription">保存</button>
              <button class="btn" @click="cancelPersonDescriptionEdit">取消</button>
            </div>
            <div class="tag-manager-actions" v-else>
              <button class="btn" @click="startPersonDescriptionEdit(person)">编辑说明</button>
              <button class="btn danger-text" @click="deletePersonGlobally(person)">全局删除</button>
            </div>
          </article>
          <div class="tag-manager-empty" v-if="!managerFilteredPeople.length">没有匹配的人物</div>
        </div>
      </section>
    </div>
    <div class="tag-modal-backdrop" v-if="locationManager.visible" @click="closeLocationManager">
      <section class="tag-manager-modal" @click.stop>
        <header class="tag-manager-header">
          <h3>地点管理</h3>
          <div class="tag-manager-header-actions">
            <button class="btn icon-btn modal-symbol-btn" data-tip="新建地点" @click="openCreateLocationMenu('manager')">+</button>
            <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeLocationManager">×</button>
          </div>
        </header>
        <div class="tag-manager-controls">
          <input class="input tag-manager-search" v-model="locationManager.search" placeholder="搜索地点、说明或行政区" />
        </div>
        <div class="location-manager-current-context" v-if="locationManagerContext">{{ locationManagerContext }}</div>
        <div class="tag-manager-list location-manager-list" ref="locationManagerListRef" @scroll="updateLocationManagerContext">
          <template v-for="row in managerLocationRows" :key="'location_manager_' + row.Key">
            <div
              v-if="row.Type === 'group' && !row.Location"
              class="location-manager-group-row"
              :style="{ paddingLeft: 12 + row.Depth * 18 + 'px' }"
            >{{ row.Label }}</div>
            <article
              v-else-if="row.Location"
              class="tag-manager-item location-manager-item"
              :style="{ marginLeft: row.Depth * 18 + 'px' }"
              :data-location-context="getLocationManagerRowContext(row)"
            >
              <div class="tag-manager-item-main">
                <div class="tag-manager-item-title location-manager-item-title">
                  <div class="location-manager-title-text">
                    <strong>{{ row.Label }}</strong>
                    <small v-if="row.Location.Description">{{ row.Location.Description }}</small>
                  </div>
                  <span>{{ row.Location.UsageCount || 0 }} 个媒体</span>
                </div>
                <div v-if="locationManager.editingName === row.Location.Name" class="location-manager-edit">
                  <label>国家</label><input class="input" v-model="locationManager.editCountry" />
                  <label>省</label><input class="input" v-model="locationManager.editProvince" />
                  <label>市</label><input class="input" v-model="locationManager.editCity" />
                  <label>父节点</label>
                  <select class="input" v-model="locationManager.editParent">
                    <option value="">无父节点</option>
                    <option v-for="option in getLocationParentOptions('', row.Location.Name)" :key="'manager_parent_' + row.Location.Name + '_' + option.Name" :value="option.Name">{{ getLocationTreeLabel(option) }}</option>
                  </select>
                  <label>说明</label><textarea class="input tag-manager-description-input" v-model="locationManager.editDescription" placeholder="可留空"></textarea>
                </div>
                <div class="tag-manager-error" v-if="locationManager.error && locationManager.editingName === row.Location.Name">{{ locationManager.error }}</div>
              </div>
              <div class="tag-manager-actions" v-if="locationManager.editingName === row.Location.Name">
                <button class="btn btn-primary" @click="saveLocationEdit">保存</button>
                <button class="btn" @click="cancelLocationEdit">取消</button>
              </div>
              <div class="tag-manager-actions" v-else>
                <button class="btn" @click="startLocationEdit(row.Location)">编辑</button>
                <button class="btn danger-text" @click="deleteLocationGlobally(row.Location)">全局删除</button>
              </div>
            </article>
          </template>
          <div class="tag-manager-empty" v-if="!managerLocationRows.length">没有匹配的地点</div>
        </div>
      </section>
    </div>
    <div class="registry-create-backdrop" v-if="tagCreate.visible && tagCreate.target === 'manager'" @click="closeCreateTagMenu">
      <section class="registry-create-modal" @click.stop>
        <header class="tag-manager-header"><h3>新建标签</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateTagMenu">×</button></header>
        <div class="tag-manager-create-panel">
          <label>标签名称</label><input class="input" v-model="tagCreate.text" />
          <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="tagCreate.description"></textarea>
          <div class="tag-create-error" v-if="tagCreate.error">{{ tagCreate.error }}</div>
          <div class="tag-create-actions"><button class="btn" @click="closeCreateTagMenu">取消</button><button class="btn btn-primary" @click="createTagAndSelect">创建</button></div>
        </div>
      </section>
    </div>
    <div class="registry-create-backdrop" v-if="albumCreate.visible && albumCreate.target === 'manager'" @click="closeCreateAlbumMenu">
      <section class="registry-create-modal" @click.stop>
        <header class="tag-manager-header"><h3>新建相册</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateAlbumMenu">×</button></header>
        <div class="tag-manager-create-panel">
          <label>相册名称</label><input class="input" v-model="albumCreate.title" />
          <label>说明</label><textarea class="input tag-create-description" v-model="albumCreate.description"></textarea>
          <div class="tag-create-error" v-if="albumCreate.error">{{ albumCreate.error }}</div>
          <div class="tag-create-actions"><button class="btn" @click="closeCreateAlbumMenu">取消</button><button class="btn btn-primary" @click="createAlbumAndSelect">创建</button></div>
        </div>
      </section>
    </div>
    <div class="registry-create-backdrop" v-if="personCreate.visible && personCreate.target === 'manager'" @click="closeCreatePersonMenu">
      <section class="registry-create-modal" @click.stop>
        <header class="tag-manager-header"><h3>新建人物</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreatePersonMenu">×</button></header>
        <div class="tag-manager-create-panel">
          <label>人物姓名</label><input class="input" v-model="personCreate.name" />
          <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="personCreate.description"></textarea>
          <div class="tag-create-error" v-if="personCreate.error">{{ personCreate.error }}</div>
          <div class="tag-create-actions"><button class="btn" @click="closeCreatePersonMenu">取消</button><button class="btn btn-primary" @click="createPersonAndSelect">创建</button></div>
        </div>
      </section>
    </div>
    <div class="registry-create-backdrop" v-if="locationCreate.visible && locationCreate.target === 'manager'" @click="closeCreateLocationMenu">
      <section class="registry-create-modal registry-create-location-modal" @click.stop>
        <header class="tag-manager-header"><h3>新建地点</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateLocationMenu">×</button></header>
        <div class="tag-manager-create-panel">
          <label>地点名称</label><input class="input" v-model="locationCreate.name" />
          <label>国家</label><input class="input" v-model="locationCreate.country" />
          <label>省</label><input class="input" v-model="locationCreate.province" />
          <label>市</label><input class="input" v-model="locationCreate.city" />
          <label>父节点</label>
          <div class="album-input-wrap">
            <button type="button" class="input registry-trigger location-parent-trigger" @click="locationCreate.parentDropdown = !locationCreate.parentDropdown"><span>{{ locationCreate.parent || '选择父地点，可留空' }}</span></button>
            <button type="button" class="album-clear-btn" v-if="locationCreate.parent" data-tip="清空父节点" @click.stop="clearCreateLocationParent">×</button>
            <div class="tag-dropdown location-dropdown" v-if="locationCreate.parentDropdown">
              <input autofocus class="input dropdown-search-input location-dropdown-search" v-model="locationCreate.parentSearch" placeholder="搜索父地点" @keydown.escape="locationCreate.parentDropdown = false" />
              <div class="location-dropdown-scroll">
                <template v-for="row in getLocationParentRows(locationCreate.parentSearch)" :key="'manager_create_parent_' + row.Key">
                  <button v-if="row.Location" type="button" class="tag-option location-option" :class="{ 'location-group-selectable': row.Type === 'group' }" :data-tip="getLocationTooltip(row.Location.Name)" :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }" @mousedown.prevent="setCreateLocationParent(row.Location.Name)"><span>{{ row.Label }}</span></button>
                  <div v-else class="location-group-row" :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }">{{ row.Label }}</div>
                </template>
                <div class="tag-option-empty" v-if="!getLocationParentRows(locationCreate.parentSearch).length">没有匹配的父地点</div>
              </div>
            </div>
          </div>
          <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="locationCreate.description"></textarea>
          <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
          <div class="tag-create-actions"><button class="btn" @click="closeCreateLocationMenu">取消</button><button class="btn btn-primary" @click="createLocationAndSelect">创建</button></div>
        </div>
      </section>
    </div>
  </div>
</template>

<script>
import { reactive, ref, computed, onMounted, onBeforeUnmount, watch, nextTick, provide } from "vue";
import GalleryView from "./components/GalleryView.vue";
import ViewerView from "./components/ViewerView.vue";
import { calculateFrameStepTarget, resolveHorizontalArrowAction } from "./video-playback.mjs";

/** Root renderer component in Single File Component format. */
const API = window.photoManagerApi;
if (!API) {
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML =
      "<div style=\"padding:24px;font-family:Microsoft YaHei, sans-serif;color:#173756;\">初始化失败：未检测到 photoManagerApi。请通过 Electron 启动应用。</div>";
  }
  throw new Error("photoManagerApi is not available");
}

const WINDOW_ACTIONS = {
  minimize: "minimize",
  maximize: "maximize",
  restore: "restore",
  close: "close",
};
const UNASSIGNED_ALBUM_FILTER = "__UNASSIGNED__";

const ICONS = {
  gallery: new URL("./assets/gallery.svg", import.meta.url).href,
  windowMinimize: new URL("./assets/window_minimize.svg", import.meta.url).href,
  windowMaximize: new URL("./assets/window_maximize.svg", import.meta.url).href,
  windowRestore: new URL("./assets/window_restore.svg", import.meta.url).href,
  windowClose: new URL("./assets/window_close.svg", import.meta.url).href,
  settings: new URL("./assets/settings.svg", import.meta.url).href,
  metadataInfo: new URL("./assets/metadata_info.svg", import.meta.url).href,
  zoomIn: new URL("./assets/image_zoom_in.svg", import.meta.url).href,
  zoomOut: new URL("./assets/image_zoom_out.svg", import.meta.url).href,
  rotateClockwise: new URL("./assets/image_rotate_clockwise.svg", import.meta.url).href,
  rotateCounterclockwise: new URL("./assets/image_rotate_counterclockwise.svg", import.meta.url).href,
  mirror: new URL("./assets/image_mirror.svg", import.meta.url).href,
  restoreView: new URL("./assets/image_restore_view.svg", import.meta.url).href,
  fullscreen: new URL("./assets/image_fullscreen.svg", import.meta.url).href,
  previousFrame: new URL("./assets/video_previous_frame.svg", import.meta.url).href,
  nextFrame: new URL("./assets/video_next_frame.svg", import.meta.url).href,
  openSystem: new URL("./assets/open_system.svg", import.meta.url).href,
  customization: new URL("./assets/customization.svg", import.meta.url).href,
  videoPlaceholder: new URL("./assets/video_placeholder.svg", import.meta.url).href,
};

// Human-readable file-size formatter for side panels.
/**
 * Convert raw byte size into readable KB/MB/GB text for UI display.
 */
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Convert a local filesystem path into an Electron-compatible file URL. */
function buildImageUrl(absolutePath) {
  if (!absolutePath) return "";
  const normalized = absolutePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  return normalized.startsWith("//") ? `file:${encoded}` : `file:///${encoded}`;
}

function readStoredNumber(key, fallback, min, max) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key, fallback) {
  try {
    const value = window.localStorage?.getItem(key);
    return value === "true" ? true : value === "false" ? false : fallback;
  } catch {
    return fallback;
  }
}

function formatDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || value === null || value === undefined) return "-";
  const total = Math.max(0, Math.floor(numeric));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBitRate(value) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0) return "-";
  if (bits >= 1000000) return `${(bits / 1000000).toFixed(2)} Mbps`;
  return `${Math.round(bits / 1000)} Kbps`;
}


export default {
  name: "PhotoManagerApp",
  components: {
    GalleryView,
    ViewerView,
  },
  setup() {
    // --- Core view / query state ---
    const config = ref(null);
    const view = ref("gallery");

    const query = reactive({
      page: 1,
      pageSize: 120,
      sortBy: "shootingTime",
      sortOrder: "desc",
      filters: { mediaType: "", album: "", tag: "", person: "", location: "" },
      search: { field: "title", value: "" },
    });

    const galleryGroups = ref([]);
    const total = ref(0);
    const mediaCounts = reactive({ all: 0, images: 0, videos: 0 });
    const hasMore = ref(false);
    const loading = ref(false);
    const filterOptions = reactive({ albums: [], tags: [], people: [], locations: [], unassignedAlbumCount: 0 });
    const tagRegistry = ref([]);
    const albumRegistry = ref([]);
    const personRegistry = ref([]);
    const locationRegistry = ref([]);
    const recentTags = ref(loadRecentRegistryValues("photoManager.recentTags", normalizeTagText));
    const recentPeople = ref(loadRecentRegistryValues("photoManager.recentPeople", normalizePersonName));
    const recentLocations = ref(loadRecentLocations());
    const tagSearch = reactive({ viewer: "", batch: "" });
    const albumSearch = reactive({ viewer: "", batch: "" });
    const personSearch = reactive({ viewer: "", batch: "" });
    const locationSearch = reactive({ viewer: "", batch: "" });
    const tagDropdown = reactive({ viewer: false, batch: false });
    const albumDropdown = reactive({ viewer: false, batch: false });
    const personDropdown = reactive({ viewer: false, batch: false });
    const locationDropdown = reactive({ viewer: false, batch: false });
    const tagCreate = reactive({ visible: false, target: "viewer", text: "", description: "", error: "" });
    const albumCreate = reactive({ visible: false, target: "viewer", title: "", description: "", error: "" });
    const personCreate = reactive({ visible: false, target: "viewer", name: "", description: "", error: "" });
    const locationCreate = reactive({ visible: false, target: "viewer", name: "", country: "", province: "", city: "", parent: "", parentSearch: "", parentDropdown: false, description: "", error: "" });
    const tagManager = reactive({ visible: false, search: "", editingText: "", editDescription: "", error: "" });
    const albumManager = reactive({ visible: false, search: "", editingTitle: "", editDescription: "", error: "" });
    const personManager = reactive({ visible: false, search: "", editingName: "", editDescription: "", error: "" });
    const locationManager = reactive({ visible: false, search: "", editingName: "", editCountry: "", editProvince: "", editCity: "", editParent: "", editDescription: "", error: "" });
    const locationManagerListRef = ref(null);
    const locationManagerContext = ref("");

    // --- Selection state ---
    const selectedItem = ref(null);
    const selectedGlobalIndex = ref(-1);
    const orderedItems = ref([]);
    const isSelectionMode = ref(false);
    const gallerySelection = ref(new Set());
    const batchEdit = reactive({
      title: "",
      album: "",
      tags: [],
      people: [],
      locationPlace: "",
    });
    const batchStatus = reactive({ visible: false, tone: "info", message: "" });
    const selectedGalleryCount = computed(() => gallerySelection.value.size);
    const batchHasChanges = computed(() => {
      if (batchEdit.title.trim()) return true;
      if (batchEdit.album.trim()) return true;
      if (batchEdit.tags.length) return true;
      if (batchEdit.people.length) return true;
      if (batchEdit.locationPlace.trim()) return true;
      return false;
    });
    const canApplyBatchEdit = computed(() => selectedGalleryCount.value > 0 && batchHasChanges.value);
    const managerFilteredTags = computed(() => {
      const keyword = tagManager.search.trim();
      const source = [...tagRegistry.value].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
      if (!keyword) return source;
      return source.filter((tag) => tag.Text.includes(keyword) || (tag.Description || "").includes(keyword));
    });
    const managerFilteredAlbums = computed(() => {
      const keyword = albumManager.search.trim();
      const source = [...albumRegistry.value].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
      if (!keyword) return source;
      return source.filter((album) => album.Title.includes(keyword) || (album.Description || "").includes(keyword));
    });
    const managerFilteredPeople = computed(() => {
      const keyword = personManager.search.trim();
      const source = [...personRegistry.value].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
      if (!keyword) return source;
      return source.filter((person) => person.Name.includes(keyword) || (person.Description || "").includes(keyword));
    });
    const managerFilteredLocations = computed(() => {
      const keyword = locationManager.search.trim();
      const source = [...locationRegistry.value];
      if (!keyword) return source;
      return source.filter((location) => locationMatchesKeyword(location, keyword));
    });
    const managerLocationRows = computed(() => buildLocationHierarchyRows(managerFilteredLocations.value));
    // --- Viewer transform state ---
    const zoomPercent = ref(100);
    const rotateDeg = ref(0);
    const mirror = ref(false);
    const pan = reactive({ x: 0, y: 0 });
    const dragging = reactive({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
    const showContextMenu = ref(false);
    const contextPosition = reactive({ x: 0, y: 0 });
    const showPrivateNote = ref(false);
    const showLeftPanel = ref(true);
    const showRightPanel = ref(true);
    const imageStageRef = ref(null);
    const videoElementRef = ref(null);
    const audioElementRef = ref(null);
    const videoPlaybackMode = ref("video");
    const videoPlaybackMessage = ref("");
    const videoFrameStepping = ref(false);
    const videoCurrentTime = ref(0);
    const videoDuration = ref(0);
    const hasVideoPlaybackStarted = ref(false);
    const videoVolume = ref(readStoredNumber("photoManager.videoVolume", 1, 0, 1));
    const videoMuted = ref(readStoredBoolean("photoManager.videoMuted", false));
    const videoPlaybackRate = ref(readStoredNumber("photoManager.videoPlaybackRate", 1, 0.25, 4));
    const isSelectedVideo = computed(() => selectedItem.value?.FileSystem?.FileType === "video");
    const canStepVideoBackward = computed(() => (
      isSelectedVideo.value
      && videoPlaybackMode.value === "video"
      && !videoFrameStepping.value
      && Number(selectedItem.value?.Video?.FrameRate) > 0
      && videoDuration.value > 0
      && videoCurrentTime.value > 0
    ));
    const canStepVideoForward = computed(() => (
      isSelectedVideo.value
      && videoPlaybackMode.value === "video"
      && !videoFrameStepping.value
      && Number(selectedItem.value?.Video?.FrameRate) > 0
      && videoDuration.value > 0
      && videoCurrentTime.value < videoDuration.value
    ));
    const isWindowMaximized = ref(false);
    const toast = reactive({ visible: false, message: "" });
    const saveNotice = reactive({ visible: false, message: "", field: "" });
    const dynamicTooltip = reactive({ visible: false, text: "", x: 0, y: 0 });
    const dynamicTooltipRef = ref(null);
    let toastTimer = null;
    let saveNoticeTimer = null;
    let tooltipTimer = null;
    let tooltipTarget = null;
    let removeWindowStateListener = null;
    let removeThumbnailReadyListener = null;

    // --- Editable draft model ---
    const editDraft = reactive({
      Title: "",
      Rating: 1,
      Album: "",
      LocationPlace: "",
      LocationDetail: "",
      Tags: [],
      People: [],
      Description: "",
      HiddenDescription: "",
    });
    const editingDirty = ref(false);
    const activeEditField = ref("");
    const STAR_LEVELS = [1, 2, 3, 4, 5];

    // Zoom limits are config-driven.
    const minZoom = computed(() => config.value?.ui?.viewer?.zoom?.minPercent ?? 10);
    const maxZoom = computed(() => config.value?.ui?.viewer?.zoom?.maxPercent ?? 1000);
    const zoomStep = computed(() => config.value?.ui?.viewer?.zoom?.stepPercent ?? 10);

    // Three-column ratio in viewer is config-driven.
    const ratioStyle = computed(() => {
      const ratio = config.value?.ui?.viewer?.panelRatio || { left: 1, center: 2, right: 1 };
      const left = showLeftPanel.value ? ratio.left : 0;
      const right = showRightPanel.value ? ratio.right : 0;
      return { gridTemplateColumns: `${left}fr ${ratio.center}fr ${right}fr` };
    });

    const viewerHeaderTime = computed(() => {
      const raw = selectedItem.value?.FileSystem?.ShootingTimeString || "";
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/);
      if (!match) return "-";
      const year = match[1];
      const month = String(Number(match[2])).padStart(2, "0");
      const day = String(Number(match[3])).padStart(2, "0");
      const hour = String(Number(match[4])).padStart(2, "0");
      const minute = String(Number(match[5])).padStart(2, "0");
      const second = String(Number(match[6])).padStart(2, "0");
      return `${year} 年 ${month} 月 ${day} 日 ${hour}:${minute}:${second}`;
    });
    const windowToggleTip = computed(() => (isWindowMaximized.value ? "还原" : "最大化"));
    const windowToggleIcon = computed(() => (isWindowMaximized.value ? ICONS.windowRestore : ICONS.windowMaximize));

    const viewerImageStyle = computed(() => ({
      transform:
        `translate(${pan.x}px, ${pan.y}px) ` +
        `scale(${zoomPercent.value / 100}) ` +
        `rotate(${rotateDeg.value}deg) ` +
        `scaleX(${mirror.value ? -1 : 1})`,
      transition: dragging.active ? "none" : "transform 90ms linear",
    }));

    /**

     * Load runtime config through bridge API and initialize UI defaults such as page size and panel visibility.

     */

    
    // ============================================================================
    // Configuration and Viewer Draft Initialization
    // ============================================================================
    async function loadConfig() {
      // Load runtime config once; gallery page size can be customized by config.yml.
      config.value = await API.getConfig();
      query.pageSize = config.value?.ui?.gallery?.pageSize || 120;
      showLeftPanel.value = config.value?.ui?.viewer?.panels?.showLeft ?? true;
      showRightPanel.value = config.value?.ui?.viewer?.panels?.showRight ?? true;
    }

    // Reset transform each time we enter viewer or switch image.
    /**
     * Reset viewer transform state (zoom/rotation/mirror/pan) when opening or switching photos.
     */
    function resetPanZoom() {
      zoomPercent.value = 100;
      rotateDeg.value = 0;
      mirror.value = false;
      pan.x = 0;
      pan.y = 0;
    }

    function saveVideoPreference(key, value) {
      try {
        window.localStorage?.setItem(key, String(value));
      } catch {
        // Playback preferences are optional local UI state.
      }
    }

    function applyVideoPreferences(element) {
      if (!element) return;
      element.volume = Math.min(1, Math.max(0, Number(videoVolume.value)));
      element.muted = Boolean(videoMuted.value);
      element.playbackRate = Math.min(4, Math.max(0.25, Number(videoPlaybackRate.value)));
    }

    function releaseCurrentMedia() {
      for (const element of [videoElementRef.value, audioElementRef.value]) {
        if (!element) continue;
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      videoElementRef.value = null;
      audioElementRef.value = null;
      videoFrameStepping.value = false;
      videoCurrentTime.value = 0;
      videoDuration.value = 0;
      hasVideoPlaybackStarted.value = false;
    }

    function resetVideoPlaybackState(item) {
      const status = item?.Video?.ProbeStatus;
      videoPlaybackMode.value = status === "failed" ? "unsupported" : status === "audio-only" ? "audio" : "video";
      videoPlaybackMessage.value = status === "failed"
        ? (item?.Video?.ProbeError || "视频无法解析")
        : status === "audio-only"
          ? "此媒体不包含视频画面，当前仅播放音频"
          : "";
      videoFrameStepping.value = false;
      videoCurrentTime.value = 0;
      videoDuration.value = 0;
      hasVideoPlaybackStarted.value = false;
    }

    function currentPlaybackElement(event, elementRef) {
      const element = event?.currentTarget || elementRef.value;
      if (!element) return null;
      const eventFilePath = String(element.dataset?.filePath || "");
      const selectedFilePath = String(selectedItem.value?.FilePath || "");
      return eventFilePath && eventFilePath === selectedFilePath ? element : null;
    }

    function reportPlaybackFallback(mode, message) {
      API.reportPlaybackIssue?.({
        filePath: selectedItem.value?.FilePath,
        mode,
        message,
      });
    }

    function onVideoLoadedMetadata(event) {
      const element = currentPlaybackElement(event, videoElementRef);
      if (!element) return;
      applyVideoPreferences(element);
      videoCurrentTime.value = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
      if (!element?.videoWidth && selectedItem.value?.Video?.HasAudio) {
        videoPlaybackMode.value = "audio";
        videoPlaybackMessage.value = "视频画面无法解码，当前仅播放音频";
        reportPlaybackFallback("audio", videoPlaybackMessage.value);
      }
    }

    function onVideoPlaybackError(event) {
      if (!currentPlaybackElement(event, videoElementRef)) return;
      if (selectedItem.value?.Video?.HasAudio) {
        videoPlaybackMode.value = "audio";
        videoPlaybackMessage.value = "视频画面无法解码，当前仅播放音频";
      } else {
        videoPlaybackMode.value = "unsupported";
        videoPlaybackMessage.value = "当前播放器无法解码此视频";
      }
      reportPlaybackFallback(videoPlaybackMode.value, videoPlaybackMessage.value);
    }

    function onAudioLoadedMetadata(event) {
      const element = currentPlaybackElement(event, audioElementRef);
      if (element) applyVideoPreferences(element);
    }

    function onAudioPlaybackError(event) {
      if (!currentPlaybackElement(event, audioElementRef)) return;
      videoPlaybackMode.value = "unsupported";
      videoPlaybackMessage.value = "当前播放器无法解码此媒体";
      reportPlaybackFallback("unsupported", videoPlaybackMessage.value);
    }

    function onVideoVolumeChange(event) {
      const element = currentPlaybackElement(
        event,
        event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef,
      );
      if (!element) return;
      videoVolume.value = element.volume;
      videoMuted.value = element.muted;
      saveVideoPreference("photoManager.videoVolume", videoVolume.value);
      saveVideoPreference("photoManager.videoMuted", videoMuted.value);
    }

    function onVideoRateChange(event) {
      const element = currentPlaybackElement(
        event,
        event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef,
      );
      if (!element || !Number.isFinite(element.playbackRate)) return;
      const rate = Math.min(4, Math.max(0.25, element.playbackRate));
      if (element.playbackRate !== rate) {
        element.playbackRate = rate;
        return;
      }
      videoPlaybackRate.value = rate;
      saveVideoPreference("photoManager.videoPlaybackRate", rate);
    }

    function onMediaPlaybackStarted(event) {
      const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
      if (currentPlaybackElement(event, elementRef)) hasVideoPlaybackStarted.value = true;
    }

    function onMediaTimeUpdate(event) {
      const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
      const element = currentPlaybackElement(event, elementRef);
      if (!element) return;
      const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      if (currentTime > 0) hasVideoPlaybackStarted.value = true;
      if (element.tagName === "VIDEO") {
        videoCurrentTime.value = currentTime;
        videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
      }
    }

    async function toggleVideoPlayback() {
      const element = videoElementRef.value || audioElementRef.value;
      if (!element) return;
      if (element.paused) {
        try {
          await element.play();
        } catch (error) {
          showToastMessage(`播放失败：${error?.message || "未知错误"}`);
        }
      } else {
        element.pause();
      }
    }

    function seekVideo(seconds) {
      const element = videoElementRef.value || audioElementRef.value;
      if (!element || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.min(element.duration, Math.max(0, element.currentTime + seconds));
    }

    function stepVideoFrame(direction) {
      const element = videoElementRef.value;
      const frameRate = Number(selectedItem.value?.Video?.FrameRate);
      if (!element || videoFrameStepping.value) return;
      const targetTime = calculateFrameStepTarget(element.currentTime, element.duration, frameRate, direction);
      if (targetTime === null) return;
      hasVideoPlaybackStarted.value = true;
      if (Math.abs(targetTime - element.currentTime) < Number.EPSILON) return;
      element.pause();
      videoFrameStepping.value = true;
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        videoCurrentTime.value = Number.isFinite(element.currentTime) ? element.currentTime : 0;
        videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
        videoFrameStepping.value = false;
      };
      element.addEventListener("seeked", () => {
        if (typeof element.requestVideoFrameCallback === "function") element.requestVideoFrameCallback(finish);
        else finish();
      }, { once: true });
      element.currentTime = targetTime;
      window.setTimeout(finish, 1000);
    }

    async function openCurrentWithSystem() {
      if (!selectedItem.value) return;
      const result = await API.openWithSystem(selectedItem.value.FilePath);
      if (!result?.ok) showToastMessage(`打开失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    async function showCurrentInFolder() {
      if (!selectedItem.value) return;
      const result = await API.showInFolder(selectedItem.value.FilePath);
      if (!result?.ok) showToastMessage(`定位失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    // Pull metadata values into editable text fields.
    /**
     * Copy selected item metadata into editable draft fields used by the right-side customization panel.
     */
    function setDraftFromItem(item, keepActiveField = false) {
      editDraft.Title = item?.Customization?.Title || "";
      editDraft.Rating = Number(item?.Customization?.Rating || 1);
      editDraft.Album = item?.Customization?.Album || "";
      editDraft.LocationPlace = item?.Location?.Place || item?.Location?.Site || "";
      editDraft.LocationDetail = item?.Location?.Detail || "";
      editDraft.Tags = [...(item?.Customization?.Tags || [])];
      editDraft.People = [...(item?.Customization?.People || [])];
      editDraft.Description = item?.Customization?.Description || "";
      editDraft.HiddenDescription = item?.Customization?.HiddenDescription || "";
      tagSearch.viewer = "";
      tagDropdown.viewer = false;
      personSearch.viewer = "";
      personDropdown.viewer = false;
      locationSearch.viewer = "";
      locationDropdown.viewer = false;
      editingDirty.value = false;
      if (!keepActiveField) activeEditField.value = "";
      nextTick(() => autoGrowAllFieldTextareas());
    }

    /**

     * Show bottom toast message for short user feedback and auto-hide it after a timeout.

     */

    function showToastMessage(message) {
      toast.message = message;
      toast.visible = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.visible = false;
      }, 1800);
    }

    /**

     * Show field-level save confirmation message right below the edited field.

     */

    function showSaveNotice(message, field) {
      saveNotice.message = message;
      saveNotice.field = field || "";
      saveNotice.visible = true;
      if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
      saveNoticeTimer = setTimeout(() => {
        saveNotice.visible = false;
        saveNotice.field = "";
      }, 1800);
    }

    /**

     * Hide tooltip immediately and clear any delayed show timer.

     */

    
    // ============================================================================
    // Tooltip Visibility and Smart Positioning
    // ============================================================================
    function hideDynamicTooltip() {
      dynamicTooltip.visible = false;
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
      }
    }

    /**

     * Compute adaptive tooltip coordinates so it stays inside viewport bounds.

     */

    async function positionDynamicTooltip(target) {
      if (!target || !dynamicTooltip.visible || !dynamicTooltipRef.value) return;
      const rect = target.getBoundingClientRect();
      const tipRect = dynamicTooltipRef.value.getBoundingClientRect();
      const margin = 8;
      let x = rect.left + rect.width / 2 - tipRect.width / 2;
      x = Math.max(margin, Math.min(x, window.innerWidth - tipRect.width - margin));

      const preferTop = rect.top - tipRect.height - 10;
      const preferBottom = rect.bottom + 10;
      let y = preferTop;
      if (preferTop < margin) y = preferBottom;
      if (y + tipRect.height > window.innerHeight - margin) {
        y = Math.max(margin, rect.top - tipRect.height - 10);
      }

      dynamicTooltip.x = x;
      dynamicTooltip.y = y;
    }

    /**

     * Delay tooltip display by 0.5s and bind it to current hovered icon button.

     */

    function scheduleDynamicTooltip(target) {
      hideDynamicTooltip();
      tooltipTarget = target;
      tooltipTimer = setTimeout(async () => {
        if (!tooltipTarget) return;
        dynamicTooltip.text = tooltipTarget.dataset.tip || "";
        if (!dynamicTooltip.text) return;
        dynamicTooltip.visible = true;
        await nextTick();
        await positionDynamicTooltip(tooltipTarget);
      }, 500);
    }

    /**

     * Start tooltip scheduling when pointer enters an icon button with data-tip text.

     */

    function onTooltipMouseOver(event) {
      const target = event.target.closest("[data-tip]");
      if (!target) return;
      if (target === tooltipTarget && dynamicTooltip.visible) return;
      scheduleDynamicTooltip(target);
    }

    /**

     * Cancel tooltip when pointer leaves the tracked icon target.

     */

    function onTooltipMouseOut(event) {
      const leaving = event.target.closest?.("[data-tip]");
      if (!leaving) return;
      if (leaving !== tooltipTarget) return;
      const related = event.relatedTarget;
      if (related && leaving.contains(related)) return;
      tooltipTarget = null;
      hideDynamicTooltip();
    }

    /**

     * Force-hide tooltip on global interactions like click/scroll/context changes.

     */

    function onTooltipGlobalHide() {
      tooltipTarget = null;
      hideDynamicTooltip();
    }

    /**

     * Reposition currently visible tooltip after resize/scroll/layout changes.

     */

    async function onTooltipViewportChange() {
      if (!dynamicTooltip.visible || !tooltipTarget) return;
      await nextTick();
      await positionDynamicTooltip(tooltipTarget);
    }

    function normalizeTagText(value) {
      return String(value ?? "").trim();
    }

    function applyTagRegistry(tags) {
      tagRegistry.value = (Array.isArray(tags) ? tags : [])
        .map((tag) => ({
          Text: normalizeTagText(tag?.Text),
          Description: normalizeTagText(tag?.Description),
          CreatedAt: tag?.CreatedAt || "",
          UpdatedAt: tag?.UpdatedAt || "",
          UsageCount: Number(tag?.UsageCount || 0),
        }))
        .filter((tag) => tag.Text);
      filterOptions.tags = tagRegistry.value.map((tag) => tag.Text);
      pruneRecentRegistryValues(recentTags, "photoManager.recentTags", filterOptions.tags);
      if (query.filters.tag && !filterOptions.tags.includes(query.filters.tag)) {
        query.filters.tag = "";
      }
    }

    async function loadTags() {
      if (typeof API.listTags !== "function") return;
      const result = await API.listTags();
      if (result?.ok) applyTagRegistry(result.tags);
    }

    function selectedTagsForTarget(target) {
      return target === "batch" ? batchEdit.tags : editDraft.Tags;
    }

    function getTagCandidates(target) {
      const keyword = normalizeTagText(tagSearch[target]);
      const selected = new Set(selectedTagsForTarget(target));
      return tagRegistry.value
        .filter((tag) => !selected.has(tag.Text))
        .filter((tag) => !keyword || tag.Text.includes(keyword) || (tag.Description || "").includes(keyword))
        .sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
    }

    function getTagOptions(target) {
      return getTagCandidates(target).slice(0, 50);
    }

    function getRecentTagOptions(target) {
      const byText = new Map(getTagCandidates(target).map((tag) => [tag.Text, tag]));
      return recentTags.value.map((text) => byText.get(text)).filter(Boolean).slice(0, 3);
    }

    function getTagDescription(tagText) {
      return tagRegistry.value.find((tag) => tag.Text === tagText)?.Description || "";
    }

    function openTagDropdown(target) {
      tagDropdown[target] = !tagDropdown[target];
    }

    function closeTagDropdown(target) {
      tagDropdown[target] = false;
    }

    function closeAllTagDropdowns() {
      tagDropdown.viewer = false;
      tagDropdown.batch = false;
    }

    function addTagToTarget(target, rawTagText) {
      const tagText = normalizeTagText(rawTagText);
      if (!tagText) return;
      const tags = selectedTagsForTarget(target);
      if (tags.includes(tagText)) {
        showToastMessage(`标签“${tagText}”已存在，添加失败`);
        tagSearch[target] = "";
        closeTagDropdown(target);
        return;
      }
      tags.push(tagText);
      rememberRecentRegistryValue(recentTags, "photoManager.recentTags", tagText, normalizeTagText);
      tagSearch[target] = "";
      closeTagDropdown(target);
      if (target === "viewer") requestEdit("Tags");
    }

    function addTag() {
      const first = getTagOptions("viewer")[0];
      if (first) addTagToTarget("viewer", first.Text);
    }

    function onTagSearchKeydown(event, target) {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = getRecentTagOptions(target)[0] || getTagOptions(target)[0];
        if (first) addTagToTarget(target, first.Text);
        return;
      }
      if (event.key === "Escape") {
        closeTagDropdown(target);
        return;
      }
      if (event.key === "Backspace" && !tagSearch[target]) {
        event.preventDefault();
        if (target === "batch") removeBatchTagAt(batchEdit.tags.length - 1);
        else removeTagAt(editDraft.Tags.length - 1);
      }
    }

    function openCreateTagMenu(target) {
      tagCreate.visible = true;
      tagCreate.target = target;
      tagCreate.text = target === "manager" ? "" : normalizeTagText(tagSearch[target]);
      tagCreate.description = "";
      tagCreate.error = "";
      if (target !== "manager") closeTagDropdown(target);
    }

    function closeCreateTagMenu() {
      tagCreate.visible = false;
      tagCreate.text = "";
      tagCreate.description = "";
      tagCreate.error = "";
    }

    async function createTagAndSelect() {
      const text = normalizeTagText(tagCreate.text);
      const description = normalizeTagText(tagCreate.description);
      if (!text) {
        tagCreate.error = "标签名称不能为空";
        return;
      }
      const result = await API.createTag({ text, description });
      if (!result?.ok) {
        tagCreate.error = result?.error || "创建标签失败";
        return;
      }
      applyTagRegistry(result.tags);
      const target = tagCreate.target;
      if (target === "manager") showToastMessage(`已创建标签“${result.tag.Text}”`);
      else addTagToTarget(target, result.tag.Text);
      closeCreateTagMenu();
    }

    async function openTagManager() {
      await loadTags();
      tagManager.visible = true;
      tagManager.error = "";
    }

    function closeTagManager() {
      if (tagCreate.target === "manager") closeCreateTagMenu();
      tagManager.visible = false;
      tagManager.search = "";
      tagManager.editingText = "";
      tagManager.editDescription = "";
      tagManager.error = "";
    }

    function startTagDescriptionEdit(tag) {
      tagManager.editingText = tag.Text;
      tagManager.editDescription = tag.Description || "";
      tagManager.error = "";
    }

    function cancelTagDescriptionEdit() {
      tagManager.editingText = "";
      tagManager.editDescription = "";
      tagManager.error = "";
    }

    async function saveTagDescription() {
      const text = tagManager.editingText;
      const description = normalizeTagText(tagManager.editDescription);
      if (!text) {
        tagManager.error = "标签不存在";
        return;
      }
      const result = await API.updateTagDescription({ text, description });
      if (!result?.ok) {
        tagManager.error = result?.error || "保存说明失败";
        return;
      }
      applyTagRegistry(result.tags);
      cancelTagDescriptionEdit();
      showToastMessage("标签说明已更新");
    }

    function stripTagFromItem(item, tagText) {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      if (!tags.includes(tagText)) return item;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          Tags: tags.filter((tag) => tag !== tagText),
        },
      };
    }

    function syncDeletedTagLocally(tagText) {
      if (selectedItem.value) selectedItem.value = stripTagFromItem(selectedItem.value, tagText);
      editDraft.Tags = editDraft.Tags.filter((tag) => tag !== tagText);
      batchEdit.tags = batchEdit.tags.filter((tag) => tag !== tagText);
      orderedItems.value = orderedItems.value.map((item) => stripTagFromItem(item, tagText));
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => stripTagFromItem(item, tagText));
      }
    }

    async function deleteTagGlobally(tag) {
      const usage = Number(tag?.UsageCount || 0);
      const ok = window.confirm(`确定全局删除标签“${tag.Text}”？这会从 ${usage} 个媒体中移除。`);
      if (!ok) return;
      const result = await API.deleteTagGlobally({ text: tag.Text });
      if (!result?.ok) {
        showToastMessage(`删除标签失败：${result?.error || "未知错误"}`);
        return;
      }
      applyTagRegistry(result.tags);
      syncDeletedTagLocally(tag.Text);
      if (query.filters.tag === tag.Text) {
        query.filters.tag = "";
        await queryGallery(true);
      }
      showToastMessage(`已全局删除标签“${tag.Text}”`);
    }

    function normalizePersonName(value) {
      return String(value ?? "").trim();
    }

    function applyPersonRegistry(people) {
      personRegistry.value = (Array.isArray(people) ? people : [])
        .map((person) => ({
          Name: normalizePersonName(person?.Name),
          Description: normalizePersonName(person?.Description),
          CreatedAt: person?.CreatedAt || "",
          UpdatedAt: person?.UpdatedAt || "",
          UsageCount: Number(person?.UsageCount || 0),
        }))
        .filter((person) => person.Name);
      filterOptions.people = personRegistry.value.map((person) => person.Name);
      pruneRecentRegistryValues(recentPeople, "photoManager.recentPeople", filterOptions.people);
      if (query.filters.person && !filterOptions.people.includes(query.filters.person)) {
        query.filters.person = "";
      }
    }

    async function loadPeople() {
      if (typeof API.listPeople !== "function") return;
      const result = await API.listPeople();
      if (result?.ok) applyPersonRegistry(result.people);
    }

    function selectedPeopleForTarget(target) {
      return target === "batch" ? batchEdit.people : editDraft.People;
    }

    function getPersonCandidates(target) {
      const keyword = normalizePersonName(personSearch[target]);
      const selected = new Set(selectedPeopleForTarget(target));
      return personRegistry.value
        .filter((person) => !selected.has(person.Name))
        .filter((person) => !keyword || person.Name.includes(keyword) || (person.Description || "").includes(keyword))
        .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
    }

    function getPersonOptions(target) {
      return getPersonCandidates(target).slice(0, 50);
    }

    function getRecentPersonOptions(target) {
      const byName = new Map(getPersonCandidates(target).map((person) => [person.Name, person]));
      return recentPeople.value.map((name) => byName.get(name)).filter(Boolean).slice(0, 3);
    }

    function getPersonDescription(personName) {
      return personRegistry.value.find((person) => person.Name === personName)?.Description || "";
    }

    function openPersonDropdown(target) {
      personDropdown[target] = !personDropdown[target];
    }

    function closePersonDropdown(target) {
      personDropdown[target] = false;
    }

    function closeAllPersonDropdowns() {
      personDropdown.viewer = false;
      personDropdown.batch = false;
    }

    function addPersonToTarget(target, rawName) {
      const name = normalizePersonName(rawName);
      if (!name) return;
      const people = selectedPeopleForTarget(target);
      if (people.includes(name)) {
        showToastMessage(`人物“${name}”已存在，添加失败`);
        personSearch[target] = "";
        closePersonDropdown(target);
        return;
      }
      people.push(name);
      rememberRecentRegistryValue(recentPeople, "photoManager.recentPeople", name, normalizePersonName);
      personSearch[target] = "";
      closePersonDropdown(target);
      if (target === "viewer") requestEdit("People");
    }

    function onPersonSearchKeydown(event, target) {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = getRecentPersonOptions(target)[0] || getPersonOptions(target)[0];
        if (first) addPersonToTarget(target, first.Name);
        return;
      }
      if (event.key === "Escape") {
        closePersonDropdown(target);
        return;
      }
      if (event.key === "Backspace" && !personSearch[target]) {
        event.preventDefault();
        if (target === "batch") removeBatchPersonAt(batchEdit.people.length - 1);
        else removePersonAt(editDraft.People.length - 1);
      }
    }

    function openCreatePersonMenu(target) {
      personCreate.visible = true;
      personCreate.target = target;
      personCreate.name = target === "manager" ? "" : normalizePersonName(personSearch[target]);
      personCreate.description = "";
      personCreate.error = "";
      if (target !== "manager") closePersonDropdown(target);
    }

    function closeCreatePersonMenu() {
      personCreate.visible = false;
      personCreate.name = "";
      personCreate.description = "";
      personCreate.error = "";
    }

    async function createPersonAndSelect() {
      const name = normalizePersonName(personCreate.name);
      const description = normalizePersonName(personCreate.description);
      if (!name) {
        personCreate.error = "人物姓名不能为空";
        return;
      }
      const result = await API.createPerson({ name, description });
      if (!result?.ok) {
        personCreate.error = result?.error || "创建人物失败";
        return;
      }
      applyPersonRegistry(result.people);
      const target = personCreate.target;
      if (target === "manager") showToastMessage(`已创建人物“${result.person.Name}”`);
      else addPersonToTarget(target, result.person.Name);
      closeCreatePersonMenu();
    }

    async function openPersonManager() {
      await loadPeople();
      personManager.visible = true;
      personManager.error = "";
    }

    function closePersonManager() {
      if (personCreate.target === "manager") closeCreatePersonMenu();
      personManager.visible = false;
      personManager.search = "";
      personManager.editingName = "";
      personManager.editDescription = "";
      personManager.error = "";
    }

    function startPersonDescriptionEdit(person) {
      personManager.editingName = person.Name;
      personManager.editDescription = person.Description || "";
      personManager.error = "";
    }

    function cancelPersonDescriptionEdit() {
      personManager.editingName = "";
      personManager.editDescription = "";
      personManager.error = "";
    }

    async function savePersonDescription() {
      const name = personManager.editingName;
      const description = normalizePersonName(personManager.editDescription);
      if (!name) {
        personManager.error = "人物姓名不能为空";
        return;
      }
      const result = await API.updatePersonDescription({ name, description });
      if (!result?.ok) {
        personManager.error = result?.error || "保存说明失败";
        return;
      }
      applyPersonRegistry(result.people);
      cancelPersonDescriptionEdit();
      showToastMessage("人物说明已更新");
    }

    function stripPersonFromItem(item, personName) {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      if (!people.includes(personName)) return item;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          People: people.filter((person) => person !== personName),
        },
      };
    }

    function syncDeletedPersonLocally(personName) {
      if (selectedItem.value) selectedItem.value = stripPersonFromItem(selectedItem.value, personName);
      editDraft.People = editDraft.People.filter((person) => person !== personName);
      batchEdit.people = batchEdit.people.filter((person) => person !== personName);
      orderedItems.value = orderedItems.value.map((item) => stripPersonFromItem(item, personName));
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => stripPersonFromItem(item, personName));
      }
    }

    async function deletePersonGlobally(person) {
      const usage = Number(person?.UsageCount || 0);
      const ok = window.confirm(`确定全局删除人物“${person.Name}”？这会从 ${usage} 个媒体中移除。`);
      if (!ok) return;
      const result = await API.deletePersonGlobally({ name: person.Name });
      if (!result?.ok) {
        showToastMessage(`删除人物失败：${result?.error || "未知错误"}`);
        return;
      }
      applyPersonRegistry(result.people);
      syncDeletedPersonLocally(person.Name);
      if (query.filters.person === person.Name) {
        query.filters.person = "";
        await queryGallery(true);
      }
      showToastMessage(`已全局删除人物“${person.Name}”`);
    }
    function normalizeLocationName(value) {
      return String(value ?? "").trim();
    }

    function normalizeLocationField(value) {
      return String(value ?? "").trim();
    }

    function getLocationRegionParts(location) {
      return [location?.Country, location?.Province, location?.City].map(normalizeLocationField).filter(Boolean);
    }

    function getLocationRegionLabel(location) {
      return getLocationRegionParts(location).join(" / ");
    }

    function getLocationPathLabel(location) {
      const path = Array.isArray(location?.Path) && location.Path.length ? location.Path : [location?.Name].filter(Boolean);
      return path.join(" / ");
    }

    function compareLocationsByRegionAndTree(a, b) {
      const keyA = [...getLocationRegionParts(a), ...getLocationPathLabel(a).split(" / "), a?.Name || ""].join("\u0001");
      const keyB = [...getLocationRegionParts(b), ...getLocationPathLabel(b).split(" / "), b?.Name || ""].join("\u0001");
      return keyA.localeCompare(keyB, "zh-CN");
    }

    function locationMatchesKeyword(location, keyword) {
      if (!keyword) return true;
      const haystack = [
        location.Name,
        location.Country,
        location.Province,
        location.City,
        location.Parent,
        location.Description,
        getLocationRegionLabel(location),
        getLocationPathLabel(location),
        ...(location.Path || []),
      ].join(" ");
      return haystack.includes(keyword);
    }

    function loadRecentRegistryValues(storageKey, normalize) {
      try {
        const raw = window.localStorage?.getItem(storageKey);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean).slice(0, 3) : [];
      } catch {
        return [];
      }
    }

    function saveRecentRegistryValues(storageKey, values) {
      try {
        window.localStorage?.setItem(storageKey, JSON.stringify(values.slice(0, 3)));
      } catch {
        // Recent registry entries are a convenience cache; ignore storage failures.
      }
    }

    function rememberRecentRegistryValue(recentRef, storageKey, rawValue, normalize) {
      const value = normalize(rawValue);
      if (!value) return;
      recentRef.value = [value, ...recentRef.value.filter((item) => item !== value)].slice(0, 3);
      saveRecentRegistryValues(storageKey, recentRef.value);
    }

    function pruneRecentRegistryValues(recentRef, storageKey, knownValues) {
      const known = new Set(knownValues);
      recentRef.value = recentRef.value.filter((value) => known.has(value)).slice(0, 3);
      saveRecentRegistryValues(storageKey, recentRef.value);
    }

    function loadRecentLocations() {
      try {
        const raw = window.localStorage?.getItem("photoManager.recentLocations");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed.map(normalizeLocationName).filter(Boolean).slice(0, 3) : [];
      } catch {
        return [];
      }
    }

    function saveRecentLocations() {
      try {
        window.localStorage?.setItem("photoManager.recentLocations", JSON.stringify(recentLocations.value.slice(0, 3)));
      } catch {
        // Recent locations are a convenience cache; ignore storage failures.
      }
    }

    function rememberRecentLocation(rawName) {
      const name = normalizeLocationName(rawName);
      if (!name) return;
      recentLocations.value = [name, ...recentLocations.value.filter((item) => item !== name)].slice(0, 3);
      saveRecentLocations();
    }

    function pruneRecentLocations() {
      const known = new Set(locationRegistry.value.map((location) => location.Name));
      recentLocations.value = recentLocations.value.filter((name) => known.has(name)).slice(0, 3);
      saveRecentLocations();
    }
    function applyLocationRegistry(locations) {
      locationRegistry.value = (Array.isArray(locations) ? locations : [])
        .map((location) => ({
          Name: normalizeLocationName(location?.Name),
          Country: normalizeLocationField(location?.Country),
          Province: normalizeLocationField(location?.Province),
          City: normalizeLocationField(location?.City),
          Parent: normalizeLocationName(location?.Parent),
          Description: normalizeLocationField(location?.Description),
          CreatedAt: location?.CreatedAt || "",
          UpdatedAt: location?.UpdatedAt || "",
          UsageCount: Number(location?.UsageCount || 0),
          Children: Array.isArray(location?.Children) ? location.Children : [],
          Depth: Number(location?.Depth || 0),
          Path: Array.isArray(location?.Path) ? location.Path : [],
        }))
        .filter((location) => location.Name)
        .sort(compareLocationsByRegionAndTree);
      filterOptions.locations = locationRegistry.value;
      pruneRecentLocations();
      if (query.filters.location && !locationRegistry.value.some((location) => location.Name === query.filters.location)) {
        query.filters.location = "";
      }
    }

    async function loadLocations() {
      if (typeof API.listLocations !== "function") return;
      const result = await API.listLocations();
      if (result?.ok) applyLocationRegistry(result.locations);
    }

    function selectedLocationForTarget(target) {
      return target === "batch" ? batchEdit.locationPlace : editDraft.LocationPlace;
    }

    function getLocationTreeLabel(location) {
      const region = getLocationRegionLabel(location);
      const suffix = region ? ` - ${region}` : "";
      return `${"　".repeat(Number(location?.Depth || 0))}${location?.Name || ""}${suffix}`;
    }

    function getLocationTooltip(locationName) {
      const location = locationRegistry.value.find((item) => item.Name === locationName);
      if (!location) return "";
      const region = getLocationRegionLabel(location);
      const path = getLocationPathLabel(location);
      return [region, path, location.Description].filter(Boolean).join("\n");
    }

    function getLocationSummary(location) {
      const region = getLocationRegionLabel(location) || "未设置行政区";
      const parent = location.Parent ? `父节点：${location.Parent}` : "无父节点";
      const description = location.Description || "无说明";
      return `${region}；${parent}；${description}`;
    }

    function getLocationManagerRowContext(row) {
      if (row?.Location) return getLocationRegionParts(row.Location).join(" | ");
      if (Array.isArray(row?.ContextParts) && row.ContextParts.length) return row.ContextParts.filter(Boolean).join(" | ");
      return "";
    }

    function updateLocationManagerContext() {
      const list = locationManagerListRef.value;
      if (!list) {
        locationManagerContext.value = "";
        return;
      }
      const listTop = list.getBoundingClientRect().top;
      const items = [...list.querySelectorAll(".location-manager-item[data-location-context]")];
      let current = null;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (rect.top <= listTop + 1 && rect.bottom > listTop) current = item;
        else if (!current && rect.top > listTop) {
          current = item;
          break;
        }
      }
      locationManagerContext.value = current?.dataset?.locationContext || "";
    }

    function scheduleLocationManagerContextUpdate() {
      if (!locationManager.visible) return;
      nextTick(() => updateLocationManagerContext());
    }

    function getLocationGroupSpecs(location) {
      const specs = [];
      if (location.Country) specs.push({ level: "country", label: location.Country, order: 0 });
      if (location.Province) specs.push({ level: "province", label: location.Province, order: 2 });
      else if (location.City) specs.push({ level: "city", label: location.City, order: 1 });
      if (location.Province && location.City) specs.push({ level: "city", label: location.City, order: 1 });
      return specs;
    }

    function isLocationRepresentedByGroup(location, spec) {
      if (!spec) return false;
      if (spec.level === "country") return location.Name === location.Country && !location.Province && !location.City;
      if (spec.level === "province") return location.Name === location.Province && !location.City;
      if (spec.level === "city") return location.Name === location.City;
      return false;
    }

    function getReducedLocationPath(location, groupSpecs) {
      const groupLabels = new Set(groupSpecs.map((spec) => spec.label));
      const path = Array.isArray(location.Path) && location.Path.length ? [...location.Path] : [location.Name];
      while (path.length > 1 && groupLabels.has(path[0])) path.shift();
      return path.length ? path : [location.Name];
    }

    function compareLocationRowsByPath(a, b) {
      return (a.Label || "").localeCompare(b.Label || "", "zh-CN");
    }

    function buildLocationTreeRows(locationRows, baseDepth, representedLocationName = "", contextParts = []) {
      const byName = new Map(locationRows.map((row) => [row.Location.Name, row]));
      const children = new Map();
      const roots = [];
      for (const row of locationRows) {
        const parentName = normalizeLocationName(row.Location?.Parent);
        if (parentName && parentName !== representedLocationName && byName.has(parentName)) {
          if (!children.has(parentName)) children.set(parentName, []);
          children.get(parentName).push(row);
        } else {
          roots.push(row);
        }
      }
      const output = [];
      const visit = (row, depth, ancestryParts = []) => {
        const childRows = [...(children.get(row.Location.Name) || [])].sort(compareLocationRowsByPath);
        const rowContextParts = [...contextParts, ...ancestryParts, row.Label].filter(Boolean);
        output.push({ ...row, Depth: depth, HasChildren: childRows.length > 0, ContextParts: rowContextParts });
        for (const child of childRows) visit(child, depth + 1, [...ancestryParts, row.Label]);
      };
      for (const root of roots.sort(compareLocationRowsByPath)) {
        visit(root, baseDepth + 1);
      }
      return output;
    }

    function createLocationGroupNode(key, label, level, depth, order) {
      return {
        Type: "group",
        Key: key,
        Label: label,
        Level: level,
        Depth: depth,
        Order: order,
        Location: null,
        Groups: new Map(),
        Locations: [],
      };
    }

    function buildLocationHierarchyRows(locations) {
      const root = { Key: "root", Groups: new Map(), Locations: [], Depth: -1 };
      for (const location of locations) {
        const specs = getLocationGroupSpecs(location);
        let parent = root;
        const groupPath = [];
        for (const spec of specs) {
          const key = `${parent.Key}>${spec.level}:${spec.label}`;
          if (!parent.Groups.has(key)) parent.Groups.set(key, createLocationGroupNode(key, spec.label, spec.level, parent.Depth + 1, spec.order));
          parent = parent.Groups.get(key);
          groupPath.push(spec);
        }
        const lastSpec = groupPath[groupPath.length - 1];
        if (isLocationRepresentedByGroup(location, lastSpec)) {
          parent.Location = location;
          parent.Key = `group-location:${location.Name}`;
          continue;
        }
        const reducedPath = getReducedLocationPath(location, groupPath);
        parent.Locations.push({
          Type: "location",
          Key: `location:${location.Name}`,
          Label: location.Name,
          Depth: parent.Depth + reducedPath.length,
          Location: location,
          SortKey: reducedPath.join("\u0001"),
          PathParts: reducedPath,
        });
      }

      const rows = [];
      const flatten = (node, contextParts = []) => {
        rows.push(...buildLocationTreeRows(node.Locations, node.Depth, node.Location?.Name, contextParts));
        const groups = [...node.Groups.values()].sort((a, b) => (a.Order - b.Order) || a.Label.localeCompare(b.Label, "zh-CN"));
        for (const group of groups) {
          const groupContextParts = [...contextParts, group.Label].filter(Boolean);
          rows.push({
            Type: "group",
            Key: group.Key,
            Label: group.Label,
            Depth: group.Depth,
            Location: group.Location,
            HasChildren: group.Locations.length > 0 || group.Groups.size > 0,
            ContextParts: groupContextParts,
          });
          flatten(group, groupContextParts);
        }
      };
      flatten(root);
      return rows;
    }


    function getLocationCandidates(target) {
      const keyword = normalizeLocationName(locationSearch[target]);
      const selected = selectedLocationForTarget(target);
      return locationRegistry.value
        .filter((location) => location.Name !== selected)
        .filter((location) => locationMatchesKeyword(location, keyword))
        .sort(compareLocationsByRegionAndTree);
    }

    function getRecentLocationOptions(target) {
      const candidates = getLocationCandidates(target);
      const byName = new Map(candidates.map((location) => [location.Name, location]));
      return recentLocations.value.map((name) => byName.get(name)).filter(Boolean).slice(0, 3);
    }

    function getLocationOptions(target) {
      return getLocationCandidates(target).slice(0, 50);
    }

    function getLocationMenuRows(target) {
      const recentRows = getRecentLocationOptions(target).map((location) => ({
        Type: "location",
        Key: `recent-location:${location.Name}`,
        Label: location.Name,
        Depth: 0,
        Location: location,
      }));
      const locationRows = buildLocationHierarchyRows(getLocationOptions(target));
      if (!recentRows.length) return locationRows;
      return [
        { Type: "section", Key: "section:recent", Label: "最近使用", Depth: 0 },
        ...recentRows,
        ...(locationRows.length ? [{ Type: "section", Key: "section:all", Label: "全部地点", Depth: 0 }, ...locationRows] : []),
      ];
    }
    function getLocationFilterRows(keywordValue = "") {
      const keyword = normalizeLocationName(keywordValue);
      const candidates = locationRegistry.value
        .filter((location) => locationMatchesKeyword(location, keyword))
        .sort(compareLocationsByRegionAndTree);
      const byName = new Map(candidates.map((location) => [location.Name, location]));
      const recentRows = recentLocations.value
        .map((name) => byName.get(name))
        .filter(Boolean)
        .slice(0, 3)
        .map((location) => ({
          Type: "location",
          Key: `filter-recent-location:${location.Name}`,
          Label: location.Name,
          Depth: 0,
          Location: location,
        }));
      const locationRows = buildLocationHierarchyRows(candidates);
      if (!recentRows.length) return locationRows;
      return [
        { Type: "section", Key: "filter-section:recent", Label: "最近使用", Depth: 0 },
        ...recentRows,
        ...(locationRows.length ? [{ Type: "section", Key: "filter-section:all", Label: "全部地点", Depth: 0 }, ...locationRows] : []),
      ];
    }

    async function setLocationFilter(rawName) {
      const name = normalizeLocationName(rawName);
      query.filters.location = name;
      if (name) rememberRecentLocation(name);
      await applyFilterSort();
    }

    function getLocationParentOptions(keywordValue = "", excludeName = "") {
      const keyword = normalizeLocationName(keywordValue);
      const exclude = normalizeLocationName(excludeName);
      const excluded = new Set([exclude]);
      const source = locationRegistry.value;
      const children = new Map(source.map((location) => [location.Name, []]));
      for (const location of source) {
        if (!location.Parent || !children.has(location.Parent)) continue;
        children.get(location.Parent).push(location.Name);
      }
      const stack = [...(children.get(exclude) || [])];
      while (stack.length) {
        const current = stack.pop();
        if (!current || excluded.has(current)) continue;
        excluded.add(current);
        stack.push(...(children.get(current) || []));
      }
      return source
        .filter((location) => !excluded.has(location.Name))
        .filter((location) => locationMatchesKeyword(location, keyword))
        .sort(compareLocationsByRegionAndTree)
        .slice(0, 50);
    }

    function getLocationParentRows(keywordValue = "", excludeName = "") {
      return buildLocationHierarchyRows(getLocationParentOptions(keywordValue, excludeName));
    }

    function openLocationDropdown(target) {
      locationDropdown[target] = !locationDropdown[target];
    }

    function closeLocationDropdown(target) {
      locationDropdown[target] = false;
    }

    function closeAllLocationDropdowns() {
      locationDropdown.viewer = false;
      locationDropdown.batch = false;
      locationCreate.parentDropdown = false;
    }

    function setLocationForTarget(target, rawName) {
      const name = normalizeLocationName(rawName);
      if (!name) return;
      if (target === "batch") {
        batchEdit.locationPlace = name;
      } else {
        editDraft.LocationPlace = name;
        requestEdit("Location");
      }
      rememberRecentLocation(name);
      locationSearch[target] = "";
      closeLocationDropdown(target);
    }

    function clearLocationForTarget(target) {
      if (target === "batch") {
        batchEdit.locationPlace = "";
      } else {
        editDraft.LocationPlace = "";
        requestEdit("Location");
      }
      locationSearch[target] = "";
      closeLocationDropdown(target);
    }

    function onLocationSearchKeydown(event, target) {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = getRecentLocationOptions(target)[0] || getLocationOptions(target)[0];
        if (first) setLocationForTarget(target, first.Name);
        return;
      }
      if (event.key === "Escape") {
        closeLocationDropdown(target);
        return;
      }
      if (event.key === "Backspace" && !locationSearch[target] && selectedLocationForTarget(target)) {
        event.preventDefault();
        clearLocationForTarget(target);
      }
    }

    function resetLocationCreateState() {
      locationCreate.visible = false;
      locationCreate.name = "";
      locationCreate.country = "";
      locationCreate.province = "";
      locationCreate.city = "";
      locationCreate.parent = "";
      locationCreate.parentSearch = "";
      locationCreate.parentDropdown = false;
      locationCreate.description = "";
      locationCreate.error = "";
    }

    function openCreateLocationMenu(target) {
      locationCreate.visible = true;
      locationCreate.target = target;
      locationCreate.name = target === "manager" ? "" : normalizeLocationName(locationSearch[target]);
      const current = target === "manager" ? "" : selectedLocationForTarget(target);
      const currentLocation = locationRegistry.value.find((location) => location.Name === current);
      locationCreate.country = currentLocation?.Country || "";
      locationCreate.province = currentLocation?.Province || "";
      locationCreate.city = currentLocation?.City || "";
      locationCreate.parent = current || "";
      locationCreate.parentSearch = "";
      locationCreate.parentDropdown = false;
      locationCreate.description = "";
      locationCreate.error = "";
      if (target !== "manager") closeLocationDropdown(target);
    }

    function closeCreateLocationMenu() {
      resetLocationCreateState();
    }

    function setCreateLocationParent(parent) {
      locationCreate.parent = normalizeLocationName(parent);
      locationCreate.parentSearch = "";
      locationCreate.parentDropdown = false;
    }

    function clearCreateLocationParent() {
      locationCreate.parent = "";
      locationCreate.parentSearch = "";
      locationCreate.parentDropdown = false;
    }

    async function createLocationAndSelect() {
      const name = normalizeLocationName(locationCreate.name);
      if (!name) {
        locationCreate.error = "地点名称不能为空";
        return;
      }
      const result = await API.createLocation({
        name,
        country: locationCreate.country,
        province: locationCreate.province,
        city: locationCreate.city,
        parent: locationCreate.parent,
        description: locationCreate.description,
      });
      if (!result?.ok) {
        locationCreate.error = result?.error || "创建地点失败";
        return;
      }
      applyLocationRegistry(result.locations);
      const target = locationCreate.target;
      if (target === "manager") {
        showToastMessage(`已创建地点“${result.location.Name}”`);
        scheduleLocationManagerContextUpdate();
      } else {
        setLocationForTarget(target, result.location.Name);
      }
      closeCreateLocationMenu();
    }

    async function openLocationManager() {
      await loadLocations();
      locationManager.visible = true;
      locationManager.error = "";
      scheduleLocationManagerContextUpdate();
    }

    function closeLocationManager() {
      if (locationCreate.target === "manager") closeCreateLocationMenu();
      locationManager.visible = false;
      locationManager.search = "";
      locationManagerContext.value = "";
      cancelLocationEdit();
    }

    function startLocationEdit(location) {
      locationManager.editingName = location.Name;
      locationManager.editCountry = location.Country || "";
      locationManager.editProvince = location.Province || "";
      locationManager.editCity = location.City || "";
      locationManager.editParent = location.Parent || "";
      locationManager.editDescription = location.Description || "";
      locationManager.error = "";
    }

    function cancelLocationEdit() {
      locationManager.editingName = "";
      locationManager.editCountry = "";
      locationManager.editProvince = "";
      locationManager.editCity = "";
      locationManager.editParent = "";
      locationManager.editDescription = "";
      locationManager.error = "";
    }

    async function saveLocationEdit() {
      const name = locationManager.editingName;
      if (!name) {
        locationManager.error = "地点不存在";
        return;
      }
      const result = await API.updateLocation({
        name,
        country: locationManager.editCountry,
        province: locationManager.editProvince,
        city: locationManager.editCity,
        parent: locationManager.editParent,
        description: locationManager.editDescription,
      });
      if (!result?.ok) {
        locationManager.error = result?.error || "保存地点失败";
        return;
      }
      applyLocationRegistry(result.locations);
      cancelLocationEdit();
      showToastMessage("地点已更新");
    }

    function clearLocationFromItem(item, locationName) {
      const current = normalizeLocationName(item?.Location?.Place || item?.Location?.Site);
      if (current !== locationName) return item;
      return {
        ...item,
        Location: { Place: "", Detail: "" },
      };
    }

    function syncDeletedLocationLocally(locationName) {
      if (selectedItem.value) selectedItem.value = clearLocationFromItem(selectedItem.value, locationName);
      if (editDraft.LocationPlace === locationName) {
        editDraft.LocationPlace = "";
        editDraft.LocationDetail = "";
      }
      if (batchEdit.locationPlace === locationName) batchEdit.locationPlace = "";
      orderedItems.value = orderedItems.value.map((item) => clearLocationFromItem(item, locationName));
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => clearLocationFromItem(item, locationName));
      }
    }

    async function deleteLocationGlobally(location) {
      const usage = Number(location?.UsageCount || 0);
      const childCount = Array.isArray(location?.Children) ? location.Children.length : 0;
      const ok = window.confirm(`确定全局删除地点“${location.Name}”？这会清空 ${usage} 个媒体的地点信息，并让 ${childCount} 个直接子地点变为无父节点。`);
      if (!ok) return;
      const result = await API.deleteLocationGlobally({ name: location.Name });
      if (!result?.ok) {
        showToastMessage(`删除地点失败：${result?.error || "未知错误"}`);
        return;
      }
      applyLocationRegistry(result.locations);
      syncDeletedLocationLocally(location.Name);
      if (query.filters.location === location.Name) {
        query.filters.location = "";
        await queryGallery(true);
      }
      showToastMessage(`已全局删除地点“${location.Name}”`);
    }
    function normalizeAlbumTitle(value) {
      return String(value ?? "").trim();
    }

    function applyAlbumRegistry(albums) {
      albumRegistry.value = (Array.isArray(albums) ? albums : [])
        .map((album) => ({
          Title: normalizeAlbumTitle(album?.Title),
          Description: normalizeAlbumTitle(album?.Description),
          CreatedAt: album?.CreatedAt || "",
          UpdatedAt: album?.UpdatedAt || "",
          UsageCount: Number(album?.UsageCount || 0),
        }))
        .filter((album) => album.Title);
      filterOptions.albums = albumRegistry.value.map((album) => album.Title);
      if (
        query.filters.album &&
        query.filters.album !== UNASSIGNED_ALBUM_FILTER &&
        !filterOptions.albums.includes(query.filters.album)
      ) {
        query.filters.album = "";
      }
    }

    async function loadAlbums() {
      if (typeof API.listAlbums !== "function") return;
      const result = await API.listAlbums();
      if (result?.ok) applyAlbumRegistry(result.albums);
    }

    function selectedAlbumForTarget(target) {
      return target === "batch" ? batchEdit.album : editDraft.Album;
    }

    function getAlbumOptions(target) {
      const keyword = normalizeAlbumTitle(albumSearch[target]);
      const selected = selectedAlbumForTarget(target);
      return albumRegistry.value
        .filter((album) => album.Title !== selected)
        .filter((album) => !keyword || album.Title.includes(keyword) || (album.Description || "").includes(keyword))
        .sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"))
        .slice(0, 50);
    }

    function getAlbumDescription(albumTitle) {
      return albumRegistry.value.find((album) => album.Title === albumTitle)?.Description || "";
    }

    function openAlbumDropdown(target) {
      albumDropdown[target] = !albumDropdown[target];
    }

    function closeAlbumDropdown(target) {
      albumDropdown[target] = false;
    }

    function closeAllAlbumDropdowns() {
      albumDropdown.viewer = false;
      albumDropdown.batch = false;
    }

    function setAlbumForTarget(target, rawTitle) {
      const title = normalizeAlbumTitle(rawTitle);
      if (!title) return;
      if (target === "batch") {
        batchEdit.album = title;
      } else {
        editDraft.Album = title;
        requestEdit("Album");
      }
      albumSearch[target] = "";
      closeAlbumDropdown(target);
    }

    function clearAlbumForTarget(target) {
      if (target === "batch") {
        batchEdit.album = "";
      } else {
        editDraft.Album = "";
        requestEdit("Album");
      }
      albumSearch[target] = "";
      closeAlbumDropdown(target);
    }

    function onAlbumSearchKeydown(event, target) {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = getAlbumOptions(target)[0];
        if (first) setAlbumForTarget(target, first.Title);
        return;
      }
      if (event.key === "Escape") {
        closeAlbumDropdown(target);
        return;
      }
      if (event.key === "Backspace" && !albumSearch[target] && selectedAlbumForTarget(target)) {
        event.preventDefault();
        clearAlbumForTarget(target);
      }
    }

    function openCreateAlbumMenu(target) {
      albumCreate.visible = true;
      albumCreate.target = target;
      albumCreate.title = target === "manager" ? "" : normalizeAlbumTitle(albumSearch[target]);
      albumCreate.description = "";
      albumCreate.error = "";
      if (target !== "manager") closeAlbumDropdown(target);
    }

    function closeCreateAlbumMenu() {
      albumCreate.visible = false;
      albumCreate.title = "";
      albumCreate.description = "";
      albumCreate.error = "";
    }

    async function createAlbumAndSelect() {
      const title = normalizeAlbumTitle(albumCreate.title);
      const description = normalizeAlbumTitle(albumCreate.description);
      if (!title || !description) {
        albumCreate.error = "相册名称和说明不能为空";
        return;
      }
      const result = await API.createAlbum({ title, description });
      if (!result?.ok) {
        albumCreate.error = result?.error || "创建相册失败";
        return;
      }
      applyAlbumRegistry(result.albums);
      const target = albumCreate.target;
      if (target === "manager") showToastMessage(`已创建相册“${result.album.Title}”`);
      else setAlbumForTarget(target, result.album.Title);
      closeCreateAlbumMenu();
    }

    async function openAlbumManager() {
      await loadAlbums();
      albumManager.visible = true;
      albumManager.error = "";
    }

    function closeAlbumManager() {
      if (albumCreate.target === "manager") closeCreateAlbumMenu();
      albumManager.visible = false;
      albumManager.search = "";
      albumManager.editingTitle = "";
      albumManager.editDescription = "";
      albumManager.error = "";
    }

    function startAlbumDescriptionEdit(album) {
      albumManager.editingTitle = album.Title;
      albumManager.editDescription = album.Description || "";
      albumManager.error = "";
    }

    function cancelAlbumDescriptionEdit() {
      albumManager.editingTitle = "";
      albumManager.editDescription = "";
      albumManager.error = "";
    }

    async function saveAlbumDescription() {
      const title = albumManager.editingTitle;
      const description = normalizeAlbumTitle(albumManager.editDescription);
      if (!title || !description) {
        albumManager.error = "说明不能为空";
        return;
      }
      const result = await API.updateAlbumDescription({ title, description });
      if (!result?.ok) {
        albumManager.error = result?.error || "保存说明失败";
        return;
      }
      applyAlbumRegistry(result.albums);
      cancelAlbumDescriptionEdit();
      showToastMessage("相册说明已更新");
    }

    function clearAlbumFromItem(item, albumTitle) {
      if (normalizeAlbumTitle(item?.Customization?.Album) !== albumTitle) return item;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          Album: "",
        },
      };
    }

    function syncDeletedAlbumLocally(albumTitle) {
      if (selectedItem.value) selectedItem.value = clearAlbumFromItem(selectedItem.value, albumTitle);
      if (editDraft.Album === albumTitle) editDraft.Album = "";
      if (batchEdit.album === albumTitle) batchEdit.album = "";
      orderedItems.value = orderedItems.value.map((item) => clearAlbumFromItem(item, albumTitle));
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => clearAlbumFromItem(item, albumTitle));
      }
    }

    async function deleteAlbumGlobally(album) {
      const usage = Number(album?.UsageCount || 0);
      const ok = window.confirm(`确定全局删除相册“${album.Title}”？这会清空 ${usage} 个媒体的相册字段。`);
      if (!ok) return;
      const result = await API.deleteAlbumGlobally({ title: album.Title });
      if (!result?.ok) {
        showToastMessage(`删除相册失败：${result?.error || "未知错误"}`);
        return;
      }
      applyAlbumRegistry(result.albums);
      syncDeletedAlbumLocally(album.Title);
      if (query.filters.album === album.Title) {
        query.filters.album = "";
        await queryGallery(true);
      }
      showToastMessage(`已全局删除相册“${album.Title}”`);
    }

    /**

     * Enable gallery selection mode for multi-select and batch editing.

     */

    
    // ============================================================================
    // Gallery Selection and Batch Edit Workflow
    // ============================================================================
    function enterSelectionMode() {
      isSelectionMode.value = true;
    }

    /**

     * Exit selection mode and reset selection/batch editor temporary state.

     */

    function exitSelectionMode() {
      isSelectionMode.value = false;
      clearGallerySelection();
      clearBatchEditInputs();
    }

    /**

     * Handle gallery card click: toggle selection in selection mode, otherwise open viewer.

     */

    function onGalleryCardClick(item) {
      if (isSelectionMode.value) {
        toggleGallerySelection(item.FilePath);
        return;
      }
      openViewer(item);
    }

    /**

     * Check whether a gallery item is currently selected for batch operations.

     */

    function isGallerySelected(filePath) {
      return gallerySelection.value.has(filePath);
    }

    /**

     * Toggle one FilePath in selection set while keeping state immutable for Vue reactivity.

     */

    function toggleGallerySelection(filePath) {
      const next = new Set(gallerySelection.value);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      gallerySelection.value = next;
    }

    /**

     * Clear all selected gallery items.

     */

    function clearGallerySelection() {
      gallerySelection.value = new Set();
    }

    /**

     * Select every currently loaded gallery item in selection mode.

     */

    function selectAllGalleryPhotos() {
      if (!isSelectionMode.value) return;
      const all = orderedItems.value.map((item) => item.FilePath).filter(Boolean);
      gallerySelection.value = new Set(all);
    }

    /**

     * Drop selected items that are no longer present after query/filter/page refresh.

     */

    function syncGallerySelectionWithLoadedItems() {
      const available = new Set(orderedItems.value.map((item) => item.FilePath));
      const next = new Set([...gallerySelection.value].filter((filePath) => available.has(filePath)));
      if (next.size !== gallerySelection.value.size) {
        gallerySelection.value = next;
      }
    }

    /**

     * Add a tag to batch-edit pending tag list, preventing duplicates in the pending set.

     */

    function addBatchTag() {
      const first = getTagOptions("batch")[0];
      if (first) addTagToTarget("batch", first.Text);
    }

    /**

     * Update batch panel status message and semantic tone (info/success/warning/error).

     */

    function setBatchStatus(tone, message) {
      batchStatus.visible = true;
      batchStatus.tone = tone;
      batchStatus.message = message;
    }

    /**

     * Reset all batch-edit form inputs, optionally keeping current status message visible.

     */

    function clearBatchEditInputs({ keepStatus = false } = {}) {
      batchEdit.title = "";
      batchEdit.album = "";
      batchEdit.tags = [];
      batchEdit.people = [];
      tagSearch.batch = "";
      tagDropdown.batch = false;
      personSearch.batch = "";
      personDropdown.batch = false;
      albumSearch.batch = "";
      albumDropdown.batch = false;
      locationSearch.batch = "";
      locationDropdown.batch = false;
      batchEdit.locationPlace = "";
      if (!keepStatus) {
        batchStatus.visible = false;
        batchStatus.message = "";
      }
    }

    /**

     * Patch updated metadata items back into gallery groups and flattened order cache.

     */

    function syncUpdatedItemsIntoGallery(updatedItems) {
      const byPath = new Map(updatedItems.map((item) => [item.FilePath, item]));
      orderedItems.value = orderedItems.value.map((item) => byPath.get(item.FilePath) || item);
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => byPath.get(item.FilePath) || item);
      }
    }

    /**

     * Remove one pending batch tag by index.

     */

    function removeBatchTagAt(index) {
      if (index < 0 || index >= batchEdit.tags.length) return;
      batchEdit.tags.splice(index, 1);
    }

    /**

     * Implement Bilibili-style batch tag input behavior (Enter add, Backspace remove last).

     */

    /**

     * Remove one pending batch person by index.

     */

    function removeBatchPersonAt(index) {
      if (index < 0 || index >= batchEdit.people.length) return;
      batchEdit.people.splice(index, 1);
    }

    function onBatchTagInputKeydown(event) {
      onTagSearchKeydown(event, "batch");
    }

    /**

     * Build batch patch payload, call API, handle partial success, and sync updated items locally.

     */

    async function applyBatchEdit() {
      const filePaths = [...gallerySelection.value];
      if (!filePaths.length) {
        showToastMessage("请先选择媒体");
        return;
      }

      const locationPatch = {};
      if (batchEdit.locationPlace.trim()) locationPatch.Place = batchEdit.locationPlace.trim();
      const customizationPatch = {};
      if (batchEdit.title.trim()) customizationPatch.Title = batchEdit.title.trim();
      if (batchEdit.album.trim()) customizationPatch.Album = batchEdit.album.trim();

      const addTags = [...new Set(batchEdit.tags.map((x) => x.trim()).filter(Boolean))];
      const addPeople = [...new Set(batchEdit.people.map((x) => x.trim()).filter(Boolean))];
      if (!addTags.length && !addPeople.length && !Object.keys(locationPatch).length && !Object.keys(customizationPatch).length) {
        showToastMessage("请先填写要批量修改的内容");
        return;
      }

      const result = await API.batchUpdateMetadata({
        filePaths,
        addTags,
        addPeople,
        locationPatch,
        customizationPatch,
      });
      if (!result?.ok) {
        const message = `批量修改失败：${result?.error || "未知错误"}`;
        showToastMessage(message);
        setBatchStatus("error", message);
        return;
      }

      const updatedItems = Array.isArray(result.items) ? result.items : [];
      syncUpdatedItemsIntoGallery(updatedItems);
      await loadTags();
      await loadAlbums();
      await loadPeople();
      await loadLocations();
      const updatedCount = Number(result.updatedCount || updatedItems.length || 0);
      const missingCount = Number(result.missingCount || 0);
      const requestedCount = Number(result.requestedCount || filePaths.length || 0);
      const detail = missingCount > 0
        ? `批量修改完成：成功 ${updatedCount} 个，失败 ${missingCount} 个（请求 ${requestedCount} 个）`
        : `批量修改完成：成功 ${updatedCount} 个媒体`;
      showToastMessage(detail);
      clearBatchEditInputs({ keepStatus: true });
      setBatchStatus(missingCount > 0 ? "warning" : "success", detail);
    }

    /**

     * Remove one tag from single-photo draft and mark tag field as pending save.

     */

    
    // ============================================================================
    // Single-Photo Tag and Rating Editing
    // ============================================================================
    function removeTagAt(index) {
      if (index < 0 || index >= editDraft.Tags.length) return;
      editDraft.Tags.splice(index, 1);
      requestEdit("Tags");
    }

    /**

     * Set star rating in draft and mark Rating field dirty when value changes.

     */

    /**

     * Remove one person from single-photo draft and mark people field as pending save.

     */

    function removePersonAt(index) {
      if (index < 0 || index >= editDraft.People.length) return;
      editDraft.People.splice(index, 1);
      requestEdit("People");
    }

    function setRating(ratingValue) {
      const normalized = Math.min(5, Math.max(1, Number(ratingValue || 1)));
      if (normalized === editDraft.Rating) return;
      editDraft.Rating = normalized;
      requestEdit("Rating");
    }

    /**

     * Handle single-photo tag input keyboard behavior (Enter add, Backspace delete last).

     */

    function onTagInputKeydown(event) {
      onTagSearchKeydown(event, "viewer");
    }

    /**

     * Fetch gallery page from backend based on current search/filter/sort/pagination settings.

     */

    
    // ============================================================================
    // Gallery Query, Search, Filter, Sort, and Pagination
    // ============================================================================
    async function queryGallery(reset = false) {
      if (loading.value) return;
      loading.value = true;
      try {
        if (reset) query.page = 1;
        // Send plain objects instead of reactive proxies over IPC.
        const safeQuery = {
          page: query.page,
          pageSize: query.pageSize,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
          filters: {
            mediaType: query.filters.mediaType,
            album: query.filters.album,
            tag: query.filters.tag,
            person: query.filters.person,
            location: query.filters.location,
          },
          search: {
            field: query.search.field,
            value: query.search.value,
          },
        };
        const res = await API.queryGallery(safeQuery);
        total.value = res.total;
        mediaCounts.all = Number(res?.mediaCounts?.all || 0);
        mediaCounts.images = Number(res?.mediaCounts?.images || 0);
        mediaCounts.videos = Number(res?.mediaCounts?.videos || 0);
        hasMore.value = res.hasMore;
        filterOptions.albums = Array.isArray(res?.filterOptions?.albums) ? res.filterOptions.albums : [];
        filterOptions.unassignedAlbumCount = Number(res?.filterOptions?.unassignedAlbumCount || 0);
        filterOptions.tags = Array.isArray(res?.filterOptions?.tags) ? res.filterOptions.tags : [];
        filterOptions.people = Array.isArray(res?.filterOptions?.people) ? res.filterOptions.people : [];
        applyLocationRegistry(Array.isArray(res?.filterOptions?.locations) ? res.filterOptions.locations : []);

        if (query.page === 1) {
          // First page replaces existing gallery snapshot.
          galleryGroups.value = res.groups;
        } else {
          // Subsequent pages append by date group.
          for (const incomingGroup of res.groups) {
            const existing = galleryGroups.value.find((g) => g.date === incomingGroup.date);
            if (existing) existing.items.push(...incomingGroup.items);
            else galleryGroups.value.push(incomingGroup);
          }
        }

        orderedItems.value = galleryGroups.value.flatMap((g) => g.items);
        syncGallerySelectionWithLoadedItems();
      } finally {
        loading.value = false;
      }
    }

    /**

     * Load next gallery page when user clicks the load-more button.

     */

    async function loadMore() {
      if (!hasMore.value || loading.value) return;
      query.page += 1;
      await queryGallery(false);
    }

    /**

     * Re-query gallery from first page using current search form values.

     */

    async function applySearch() { await queryGallery(true); }
    /**
     * Re-query gallery from first page after filter/sort controls changed.
     */
    async function applyFilterSort() { await queryGallery(true); }

    async function setMediaTypeFilter(type) {
      query.filters.mediaType = type === "image" || type === "video" ? type : "";
      await queryGallery(true);
    }

    // Restore default query + filter + sort state.
    /**
     * Restore gallery query controls to default state and reload first page data.
     */
    async function resetAll() {
      query.filters.mediaType = "";
      query.filters.album = "";
      query.filters.tag = "";
      query.filters.person = "";
      query.filters.location = "";
      query.search.field = "title";
      query.search.value = "";
      query.sortBy = "shootingTime";
      query.sortOrder = "desc";
      exitSelectionMode();
      await queryGallery(true);
    }

    /**

     * Switch to viewer mode for selected item and initialize draft/transform/index state.

     */

    
    // ============================================================================
    // Viewer Mode Navigation and Image Transform Controls
    // ============================================================================
    function openViewer(item) {
      releaseCurrentMedia();
      selectedItem.value = item;
      selectedGlobalIndex.value = orderedItems.value.findIndex((x) => x.FilePath === item.FilePath);
      setDraftFromItem(item);
      resetPanZoom();
      resetVideoPlaybackState(item);
      view.value = "viewer";
    }

    /**

     * Return from viewer mode to gallery and close transient overlays/menus.

     */

    function closeViewer() {
      releaseCurrentMedia();
      view.value = "gallery";
      showContextMenu.value = false;
    }

    /**

     * Navigate to previous/next photo in ordered list and show boundary toast at ends.

     */

    function switchPhoto(direction) {
      const next = selectedGlobalIndex.value + direction;
      if (next < 0) {
        showToastMessage("已经是第一个媒体");
        return;
      }
      if (next >= orderedItems.value.length) {
        showToastMessage("已经是最后一个媒体");
        return;
      }
      releaseCurrentMedia();
      selectedGlobalIndex.value = next;
      selectedItem.value = orderedItems.value[next];
      setDraftFromItem(selectedItem.value);
      resetPanZoom();
      resetVideoPlaybackState(selectedItem.value);
    }

    // Wheel controls zoom around current center.
    /**
     * Compute dynamic wheel zoom step based on current zoom range thresholds.
     */
    function getWheelZoomStep() {
      if (zoomPercent.value > 500) return 50;
      if (zoomPercent.value >= 200) return 20;
      return zoomStep.value;
    }

    // Wheel controls zoom around current center.
    /**
     * Apply wheel zoom with dynamic step, clamped to configured min/max zoom limits.
     */
    function onImageWheel(event) {
      event.preventDefault();
      const wheelStep = getWheelZoomStep();
      const delta = event.deltaY < 0 ? wheelStep : -wheelStep;
      zoomPercent.value = Math.min(maxZoom.value, Math.max(minZoom.value, zoomPercent.value + delta));
    }

    /**

     * Start image dragging and capture drag origin plus current pan baseline.

     */

    function startDrag(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging.active = true;
      dragging.startX = event.clientX;
      dragging.startY = event.clientY;
      dragging.baseX = pan.x;
      dragging.baseY = pan.y;
    }

    // Dragging updates pan offset in screen-space pixels.
    /**
     * Update pan offset during drag so image follows cursor movement in real time.
     */
    function onDrag(event) {
      if (!dragging.active) return;
      if ((event.buttons & 1) === 0) {
        endDrag();
        return;
      }
      pan.x = dragging.baseX + (event.clientX - dragging.startX);
      pan.y = dragging.baseY + (event.clientY - dragging.startY);
    }

    /**

     * End drag interaction and stop pan updates.

     */

    function endDrag() { dragging.active = false; }
    /**
     * Restore image transform to default viewing state.
     */
    function restoreImageState() { resetPanZoom(); }
    /**
     * Increase zoom by configured step while respecting maximum zoom boundary.
     */
    function zoomIn() { zoomPercent.value = Math.min(maxZoom.value, zoomPercent.value + zoomStep.value); }
    /**
     * Decrease zoom by configured step while respecting minimum zoom boundary.
     */
    function zoomOut() { zoomPercent.value = Math.max(minZoom.value, zoomPercent.value - zoomStep.value); }
    /**
     * Rotate current image clockwise by 90 degrees.
     */
    function rotateClockwise() { rotateDeg.value += 90; }
    /**
     * Rotate current image counterclockwise by 90 degrees.
     */
    function rotateCounterclockwise() { rotateDeg.value -= 90; }
    /**
     * Toggle horizontal mirror transform on the image.
     */
    function toggleMirror() { mirror.value = !mirror.value; }

    // Custom right-click menu for copy actions.
    /**
     * Open image context menu at pointer position for copy actions.
     */
    
    // ============================================================================
    // Context Menu, Overlay Panels, and Clipboard Actions
    // ============================================================================
    function openContextMenu(event) {
      event.preventDefault();
      contextPosition.x = event.clientX;
      contextPosition.y = event.clientY;
      showContextMenu.value = true;
    }

    /**

     * Close context/tooltip/popover style overlays that should not stay pinned.

     */

    function closeTransientPanels() {
      showContextMenu.value = false;
      closeAllTagDropdowns();
      closeAllAlbumDropdowns();
      closeAllPersonDropdowns();
      closeAllLocationDropdowns();
    }

    /**

     * Toggle floating location detail popover in right-side customization panel.

     */
    /**

     * Show or hide left metadata panel in viewer layout.

     */

    function toggleLeftPanel() { showLeftPanel.value = !showLeftPanel.value; }
    /**
     * Show or hide right customization panel in viewer layout.
     */
    function toggleRightPanel() { showRightPanel.value = !showRightPanel.value; }

    /**

     * Copy current image binary to clipboard through bridge API and show result toast.

     */

    async function contextCopyImage() {
      if (!selectedItem.value) return;
      const result = await API.copyImage(selectedItem.value.FilePath);
      if (result?.ok) showToastMessage("已成功复制到剪贴板");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Copy current image absolute path to clipboard and show result toast.

     */

    async function contextCopyPath() {
      if (!selectedItem.value) return;
      const result = await API.copyPath(selectedItem.value.__absolutePath);
      if (result?.ok) showToastMessage("已成功复制文件路径");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Copy current metadata JSON payload to clipboard and show result toast.

     */

    async function contextCopyJson() {
      if (!selectedItem.value) return;
      const result = await API.copyJson(selectedItem.value);
      if (result?.ok) showToastMessage("已成功复制媒体元信息");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Mark a specific field as dirty and display inline save confirmation controls.

     */

    
    // ============================================================================
    // Metadata Field Edit State and Persistence
    // ============================================================================
    function requestEdit(field) {
      editingDirty.value = true;
      if (field) activeEditField.value = field;
    }

    /**

     * Auto-resize single-line style textarea to fit wrapped content height.

     */

    function autoGrowFieldTextarea(element) {
      if (!element) return;
      const minHeight = 28;
      element.style.height = "auto";
      element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
    }

    /**

     * Apply auto-grow behavior to all viewer field textareas after render updates.

     */

    function autoGrowAllFieldTextareas() {
      const nodes = document.querySelectorAll(".field-textarea");
      for (const node of nodes) autoGrowFieldTextarea(node);
    }

    /**

     * Handle textarea input by resizing the field and marking it dirty.

     */

    function onFieldTextareaInput(event, field) {
      autoGrowFieldTextarea(event.target);
      requestEdit(field);
    }
    /**
     * Discard unsaved edits by restoring draft values from current selected metadata item.
     */
    function cancelEdit() {
      saveNotice.visible = false;
      saveNotice.field = "";
      setDraftFromItem(selectedItem.value);
    }

    // Persist editable metadata fields into JSONL through IPC.
    /**
     * Persist current dirty field to metadata backend and synchronize local caches with response.
     */
    async function confirmEdit() {
      if (!selectedItem.value) return;
      const saveField = activeEditField.value || "Title";
      const payload = {
        filePath: selectedItem.value.FilePath,
        customization: {
          Title: editDraft.Title,
          Rating: Math.min(5, Math.max(1, Number(editDraft.Rating || 1))),
          Album: editDraft.Album,
          Tags: [...editDraft.Tags],
          People: [...editDraft.People],
          Description: editDraft.Description,
          HiddenDescription: editDraft.HiddenDescription,
        },
        location: {
          Place: editDraft.LocationPlace,
          Detail: editDraft.LocationDetail,
        },
      };
      const result = await API.updateCustomization(payload);
      if (result.ok) {
        // Keep local caches in sync with server response.
        selectedItem.value = result.item;
        const inOrdered = orderedItems.value.findIndex((x) => x.FilePath === result.item.FilePath);
        if (inOrdered >= 0) orderedItems.value[inOrdered] = result.item;
        for (const group of galleryGroups.value) {
          const idx = group.items.findIndex((x) => x.FilePath === result.item.FilePath);
          if (idx >= 0) { group.items[idx] = result.item; break; }
        }
        setDraftFromItem(result.item, true);
        activeEditField.value = saveField;
        showSaveNotice("已修改", saveField);
        await loadTags();
        await loadAlbums();
        await loadPeople();
        await loadLocations();
      } else {
        showToastMessage(`修改失败：${result?.error || "未知错误"}`);
      }
    }

    /**

     * Enter/exit image-only fullscreen mode via Fullscreen API.

     */

    
    // ============================================================================
    // Fullscreen, Window State, and Global Keyboard Shortcuts
    // ============================================================================
    async function toggleFullscreen() {
      const root = imageStageRef.value;
      if (!root) return;
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    }

    /**

     * Query main process for maximized state to keep custom window button icon in sync.

     */

    async function refreshWindowState() {
      if (typeof API.getWindowState !== "function") return;
      const state = await API.getWindowState();
      isWindowMaximized.value = Boolean(state?.isMaximized);
    }

    // Keyboard shortcuts available in viewer mode.
    /**
     * Handle global viewer shortcuts (navigation/fullscreen/confirm-save) with input-focus guards.
     */
    function onGlobalKeydown(event) {
      if (view.value !== "viewer") return;
      const active = document.activeElement;
      const isTypingTarget = Boolean(
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)
      );
      const isTextarea = Boolean(active && active.tagName === "TEXTAREA");
      const isTagInput = Boolean(active && active.classList && active.classList.contains("tag-input"));
      const isButtonControl = Boolean(active && (active.tagName === "BUTTON" || active.tagName === "SELECT"));
      if (event.key === "Enter" && editingDirty.value && !event.isComposing && !isTextarea && !isTagInput) {
        event.preventDefault();
        confirmEdit();
        return;
      }
      if (isTypingTarget) return;
      if (isButtonControl && (event.key === " " || event.key === "Enter")) return;
      if (isSelectedVideo.value) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          const action = resolveHorizontalArrowAction({
            isVideo: true,
            hasPlaybackStarted: hasVideoPlaybackStarted.value,
            shiftKey: event.shiftKey,
          });
          if (action === "seek") seekVideo(direction * 5);
          else switchPhoto(direction);
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          toggleVideoPlayback();
          return;
        }
        if (event.key === ".") {
          event.preventDefault();
          stepVideoFrame(1);
          return;
        }
        if (event.key === ",") {
          event.preventDefault();
          stepVideoFrame(-1);
          return;
        }
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        switchPhoto(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        switchPhoto(1);
      }
      if (event.key === "Escape") closeTransientPanels();
    }

    /**

     * Forward custom titlebar actions (minimize/maximize/restore/close) to main process.

     */

    async function doWindowAction(action) { await API.windowAction(action); }

    /**

     * Toggle between maximize and restore based on current window state flag.

     */

    async function toggleWindowMaximizeRestore() {
      await doWindowAction(isWindowMaximized.value ? WINDOW_ACTIONS.restore : WINDOW_ACTIONS.maximize);
      await refreshWindowState();
    }

    watch(
      () => [locationManager.visible, locationManager.search, managerLocationRows.value.length],
      () => scheduleLocationManagerContextUpdate()
    );

    function markThumbnailReady(payload) {
      const filePath = String(payload?.filePath || "");
      if (!filePath) return;
      const readyAt = Date.now();
      const update = (item) => {
        if (!item || item.FilePath !== filePath) return;
        item.__thumbnailPath = payload.thumbnailPath || item.__thumbnailPath;
        item.__thumbnailAvailable = true;
        item.__thumbnailReadyAt = readyAt;
      };
      update(selectedItem.value);
      for (const item of orderedItems.value) update(item);
      for (const group of galleryGroups.value) {
        for (const item of group.items) update(item);
      }
    }

    // Dirty-check editable fields to show/hide confirm/cancel controls.
    watch(
      () => [
        editDraft.Title,
        editDraft.Rating,
        editDraft.Album,
        editDraft.LocationPlace,
        editDraft.LocationDetail,
        editDraft.Tags.join("\u0001"),
        editDraft.People.join("\u0001"),
        editDraft.Description,
        editDraft.HiddenDescription,
      ],
      () => {
        if (view.value !== "viewer") return;
        const compareTags = (selectedItem.value?.Customization?.Tags || []).join("\u0001");
        const comparePeople = (selectedItem.value?.Customization?.People || []).join("\u0001");
        editingDirty.value =
          editDraft.Title !== (selectedItem.value?.Customization?.Title || "") ||
          Number(editDraft.Rating || 1) !== Number(selectedItem.value?.Customization?.Rating || 1) ||
          editDraft.Album !== (selectedItem.value?.Customization?.Album || "") ||
          editDraft.LocationPlace !== (selectedItem.value?.Location?.Place || selectedItem.value?.Location?.Site || "") ||
          editDraft.LocationDetail !== (selectedItem.value?.Location?.Detail || "") ||
          editDraft.Tags.join("\u0001") !== compareTags ||
          editDraft.People.join("\u0001") !== comparePeople ||
          editDraft.Description !== (selectedItem.value?.Customization?.Description || "") ||
          editDraft.HiddenDescription !== (selectedItem.value?.Customization?.HiddenDescription || "");
      }
    );

    onMounted(async () => {
      // Initial render flow: config -> first gallery query -> global listeners.
      await loadConfig();
      await loadTags();
      await loadAlbums();
      await loadPeople();
      await loadLocations();
      await queryGallery(true);
      await refreshWindowState();
      await nextTick();
      autoGrowAllFieldTextareas();
      if (typeof API.onWindowStateChanged === "function") {
        removeWindowStateListener = API.onWindowStateChanged((state) => {
          isWindowMaximized.value = Boolean(state?.isMaximized);
        });
      }
      if (typeof API.onThumbnailReady === "function") {
        removeThumbnailReadyListener = API.onThumbnailReady(markThumbnailReady);
      }
      if (typeof API.startThumbnailWarmup === "function") {
        API.startThumbnailWarmup().catch((error) => console.error("Thumbnail warmup failed", error));
      }
      window.addEventListener("keydown", onGlobalKeydown);
      window.addEventListener("mousemove", onDrag);
      window.addEventListener("mouseup", endDrag);
      window.addEventListener("resize", onTooltipViewportChange);
      window.addEventListener("scroll", onTooltipViewportChange, true);
      document.addEventListener("mouseover", onTooltipMouseOver);
      document.addEventListener("mouseout", onTooltipMouseOut);
      document.addEventListener("mousedown", onTooltipGlobalHide);
      document.addEventListener("click", closeTransientPanels);
    });

    onBeforeUnmount(() => {
      // Cleanup global listeners when app unmounts.
      releaseCurrentMedia();
      window.removeEventListener("keydown", onGlobalKeydown);
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("resize", onTooltipViewportChange);
      window.removeEventListener("scroll", onTooltipViewportChange, true);
      document.removeEventListener("mouseover", onTooltipMouseOver);
      document.removeEventListener("mouseout", onTooltipMouseOut);
      document.removeEventListener("mousedown", onTooltipGlobalHide);
      document.removeEventListener("click", closeTransientPanels);
      if (typeof removeWindowStateListener === "function") removeWindowStateListener();
      if (typeof removeThumbnailReadyListener === "function") removeThumbnailReadyListener();
      if (toastTimer) clearTimeout(toastTimer);
      if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
      if (tooltipTimer) clearTimeout(tooltipTimer);
    });

    const exposed = {
      ICONS,
      WINDOW_ACTIONS,
      view,
      query,
      galleryGroups,
      total,
      mediaCounts,
      hasMore,
      loading,
      filterOptions,
      tagRegistry,
      albumRegistry,
      personRegistry,
      locationRegistry,
      tagSearch,
      albumSearch,
      personSearch,
      locationSearch,
      tagDropdown,
      albumDropdown,
      personDropdown,
      locationDropdown,
      tagCreate,
      albumCreate,
      personCreate,
      locationCreate,
      tagManager,
      albumManager,
      personManager,
      locationManager,
      locationManagerListRef,
      locationManagerContext,
      managerFilteredTags,
      managerFilteredAlbums,
      managerFilteredPeople,
      managerFilteredLocations,
      managerLocationRows,
      UNASSIGNED_ALBUM_FILTER,
      isSelectionMode,
      batchStatus,
      selectedGalleryCount,
      batchHasChanges,
      canApplyBatchEdit,
      selectedItem,
      zoomPercent,
      rotateDeg,
      mirror,
      pan,
      showContextMenu,
      contextPosition,
      showPrivateNote,
      showLeftPanel,
      showRightPanel,
      imageStageRef,
      videoElementRef,
      audioElementRef,
      videoPlaybackMode,
      videoPlaybackMessage,
      canStepVideoBackward,
      canStepVideoForward,
      videoVolume,
      videoMuted,
      isSelectedVideo,
      isWindowMaximized,
      toast,
      saveNotice,
      dynamicTooltip,
      dynamicTooltipRef,
      editDraft,
      batchEdit,
      editingDirty,
      activeEditField,
      STAR_LEVELS,
      ratioStyle,
      viewerHeaderTime,
      windowToggleTip,
      windowToggleIcon,
      viewerImageStyle,
      minZoom,
      maxZoom,
      formatFileSize,
      formatDuration,
      formatBitRate,
      buildImageUrl,
      enterSelectionMode,
      exitSelectionMode,
      onGalleryCardClick,
      isGallerySelected,
      toggleGallerySelection,
      clearGallerySelection,
      selectAllGalleryPhotos,
      addBatchTag,
      removeBatchTagAt,
      removeBatchPersonAt,
      onBatchTagInputKeydown,
      getTagOptions,
      getRecentTagOptions,
      getTagDescription,
      getAlbumOptions,
      getAlbumDescription,
      getPersonOptions,
      getRecentPersonOptions,
      getPersonDescription,
      getLocationOptions,
      getRecentLocationOptions,
      getLocationMenuRows,
      getLocationFilterRows,
      setLocationFilter,
      getLocationParentOptions,
      getLocationParentRows,
      getLocationTooltip,
      getLocationTreeLabel,
      getLocationSummary,
      getLocationManagerRowContext,
      updateLocationManagerContext,
      openTagDropdown,
      closeTagDropdown,
      addTagToTarget,
      onTagSearchKeydown,
      openAlbumDropdown,
      closeAlbumDropdown,
      setAlbumForTarget,
      clearAlbumForTarget,
      onAlbumSearchKeydown,
      openPersonDropdown,
      closePersonDropdown,
      addPersonToTarget,
      onPersonSearchKeydown,
      openLocationDropdown,
      closeLocationDropdown,
      setLocationForTarget,
      clearLocationForTarget,
      onLocationSearchKeydown,
      openCreateTagMenu,
      closeCreateTagMenu,
      createTagAndSelect,
      openCreateAlbumMenu,
      closeCreateAlbumMenu,
      createAlbumAndSelect,
      openCreatePersonMenu,
      closeCreatePersonMenu,
      createPersonAndSelect,
      openCreateLocationMenu,
      closeCreateLocationMenu,
      createLocationAndSelect,
      setCreateLocationParent,
      clearCreateLocationParent,
      openTagManager,
      closeTagManager,
      startTagDescriptionEdit,
      cancelTagDescriptionEdit,
      saveTagDescription,
      deleteTagGlobally,
      openAlbumManager,
      closeAlbumManager,
      startAlbumDescriptionEdit,
      cancelAlbumDescriptionEdit,
      saveAlbumDescription,
      deleteAlbumGlobally,
      openPersonManager,
      closePersonManager,
      startPersonDescriptionEdit,
      cancelPersonDescriptionEdit,
      savePersonDescription,
      deletePersonGlobally,
      openLocationManager,
      closeLocationManager,
      startLocationEdit,
      cancelLocationEdit,
      saveLocationEdit,
      deleteLocationGlobally,
      clearBatchEditInputs,
      applyBatchEdit,
      loadMore,
      applySearch,
      applyFilterSort,
      setMediaTypeFilter,
      resetAll,
      openViewer,
      closeViewer,
      switchPhoto,
      onImageWheel,
      startDrag,
      onDrag,
      endDrag,
      restoreImageState,
      zoomIn,
      zoomOut,
      rotateClockwise,
      rotateCounterclockwise,
      toggleMirror,
      openContextMenu,
      closeTransientPanels,
      toggleLeftPanel,
      toggleRightPanel,
      contextCopyImage,
      contextCopyPath,
      contextCopyJson,
      openCurrentWithSystem,
      showCurrentInFolder,
      onVideoLoadedMetadata,
      onVideoPlaybackError,
      onAudioLoadedMetadata,
      onAudioPlaybackError,
      onVideoVolumeChange,
      onVideoRateChange,
      onMediaPlaybackStarted,
      onMediaTimeUpdate,
      toggleVideoPlayback,
      stepVideoFrame,
      onTagInputKeydown,
      addTag,
      removeTagAt,
      removePersonAt,
      setRating,
      onFieldTextareaInput,
      requestEdit,
      cancelEdit,
      confirmEdit,
      toggleFullscreen,
      toggleWindowMaximizeRestore,
      doWindowAction,
    };
    provide("appContext", exposed);
    return exposed;
  },
};
</script>
