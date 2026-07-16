import { ref, onMounted, onBeforeUnmount, nextTick, provide } from "vue";
import { ICONS, STAR_LEVELS, UNASSIGNED_ALBUM_FILTER, WINDOW_ACTIONS } from "../constants/ui-constants.mjs";
import { buildImageUrl, formatBitRate, formatDuration, formatFileSize } from "../domain/media-formatters.mjs";
import { useUiFeedback } from "../composables/use-ui-feedback.js";
import { useWindowControls } from "../composables/use-window-controls.js";
import { useImageTransform } from "../composables/use-image-transform.js";
import { useVideoPlayback } from "../composables/use-video-playback.js";
import { useLibrarySession } from "../composables/use-library-session.js";
import { useGalleryQuery } from "../composables/use-gallery-query.js";
import { useGallerySelection } from "../composables/use-gallery-selection.js";
import { useRecentRegistryHistory } from "../composables/use-recent-registry-history.js";
import { useTagRegistry } from "../composables/use-tag-registry.js";
import { usePersonRegistry } from "../composables/use-person-registry.js";
import { useAlbumRegistry } from "../composables/use-album-registry.js";
import { useLocationRegistry } from "../composables/use-location-registry.js";
import { useMediaEditor } from "../composables/use-media-editor.js";
import { useMediaViewer } from "../composables/use-media-viewer.js";
import {
  ALBUM_CONTEXT,
  GALLERY_CONTEXT,
  GALLERY_FILTER_CONTEXT,
  LIBRARY_CONTEXT,
  LOCATION_CONTEXT,
  PERSON_CONTEXT,
  SETTINGS_CONTEXT,
  TAG_CONTEXT,
  UI_FEEDBACK_CONTEXT,
  VIEWER_CONTEXT,
} from "../context/renderer-contexts.js";

const API = window.photoManagerApi;
if (!API) {
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML =
      "<div style=\"padding:24px;font-family:Microsoft YaHei, sans-serif;color:#173756;\">初始化失败：未检测到 photoManagerApi。请通过 Electron 启动应用。</div>";
  }
  throw new Error("photoManagerApi is not available");
}

/**
 * Application composition root. It wires domain composables together and publishes
 * narrow contexts; feature state and behavior remain owned by the composables.
 */
export function useRendererApplication() {
    // --- Core view / query state ---
    const config = ref(null);
    const {
      toast,
      saveNotice,
      dynamicTooltip,
      dynamicTooltipRef,
      showToastMessage,
      showSaveNotice,
      install: installUiFeedback,
      dispose: disposeUiFeedback,
    } = useUiFeedback();
    const {
      windowToggleTip,
      windowToggleIcon,
      initialize: initializeWindowControls,
      dispose: disposeWindowControls,
      doWindowAction,
      toggleWindowMaximizeRestore,
    } = useWindowControls({ api: API, icons: ICONS, actions: WINDOW_ACTIONS });
    const {
      view,
      libraryState,
      entry,
      initializationConfirm,
      gallerySettingsOpen,
      libraryInfo,
      maintenanceDialog,
      maintenanceDialogTitle,
      maintenanceDialogDescription,
      applyLibraryState,
      openLibraryPath,
      retryLastLibrary,
      chooseLibrary,
      closeInitializationConfirm,
      confirmInitializeLibrary,
      cancelLibraryOperation,
      recheckMediaTools,
      toggleGallerySettings,
      closeGallerySettings,
      openLibraryInfo,
      closeLibraryInfo,
      saveLibraryInfo,
      openLibraryRoot,
      openLibraryManagerDir,
      openLibraryLogDir,
      openMaintenanceDialog,
      closeMaintenanceDialog,
      startMaintenanceOperation,
      copyMaintenanceReport,
      showMaintenanceOutput,
      returnToLibraryEntry,
      initialize: initializeLibrarySession,
      dispose: disposeLibrarySession,
    } = useLibrarySession({
      api: API,
      showToastMessage,
      hasUnsavedChanges: () => editingDirty.value,
      onLibraryOpened: async () => {
        resetLibraryUiState();
        loadLibraryRecentValues();
        await loadTags();
        await loadAlbums();
        await loadPeople();
        await loadLocations();
        await queryGallery();
      },
      onLibraryClosed: () => resetLibraryUiState(),
      onMaintenanceRefresh: async (operation) => {
        if (operation === "update") {
          await loadTags();
          await loadAlbums();
          await loadPeople();
          await loadLocations();
          await queryGallery();
        }
        if (operation === "thumbnails") await queryGallery();
      },
    });
    const {
      recentTags,
      recentPeople,
      recentLocations,
      loadLibraryRecentValues,
      resetRecentValues,
      rememberRecentTag,
      rememberRecentPerson,
      rememberRecentLocation,
      pruneRecentTags,
      pruneRecentPeople,
      pruneRecentLocations,
    } = useRecentRegistryHistory({ libraryState });

    const selectedItem = ref(null);
    const {
      query,
      galleryGroups,
      orderedItems,
      total,
      mediaCounts,
      loading,
      filterOptions,
      galleryItemIndex,
      queryGallery,
      applySearch,
      applyFilterSort,
      setMediaTypeFilter,
      resetAll,
      resetGalleryState,
      rebuildGalleryItemIndex,
      initialize: initializeGalleryQuery,
      dispose: disposeGalleryQuery,
    } = useGalleryQuery({
      api: API,
      selectedItem,
      showToastMessage,
      onLocationsLoaded: (locations) => applyLocationRegistry(locations),
      onSelectionResultChanged: () => syncGallerySelectionWithLoadedItems(),
      onResetSelection: () => exitSelectionMode(),
    });

    // --- Selection state ---
    const {
      isSelectionMode,
      gallerySelection,
      batchEdit,
      batchStatus,
      selectedGalleryCount,
      batchHasChanges,
      canApplyBatchEdit,
      enterSelectionMode,
      exitSelectionMode,
      onGalleryCardClick,
      isGallerySelected,
      toggleGallerySelection,
      clearGallerySelection,
      selectAllGalleryPhotos,
      syncGallerySelectionWithLoadedItems,
      addBatchTag,
      setBatchStatus,
      clearBatchEditInputs,
      resetSelectionState,
      syncUpdatedItemsIntoGallery,
      removeBatchTagAt,
      removeBatchPersonAt,
      onBatchTagInputKeydown,
      applyBatchEdit,
    } = useGallerySelection({
      api: API,
      orderedItems,
      galleryGroups,
      rebuildGalleryItemIndex,
      showToastMessage,
      openViewer: (item) => openViewer(item),
      getBatchTagOptions: () => getTagOptions("batch"),
      addBatchTagOption: (tagId) => addTagToTarget("batch", tagId),
      handleBatchTagKeydown: (event) => onTagSearchKeydown(event, "batch"),
      resetBatchPickers: () => {
        tagSearch.batch = "";
        tagDropdown.batch = false;
        personSearch.batch = "";
        personDropdown.batch = false;
        albumSearch.batch = "";
        albumDropdown.batch = false;
        locationSearch.batch = "";
        locationDropdown.batch = false;
      },
      refreshRegistries: async () => {
        await loadTags();
        await loadAlbums();
        await loadPeople();
        await loadLocations();
      },
    });
    const {
      zoomPercent,
      imageStageRef,
      minZoom,
      maxZoom,
      zoomStep,
      viewerImageStyle,
      resetPanZoom,
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
      initialize: initializeImageTransform,
      dispose: disposeImageTransform,
    } = useImageTransform({ config });
    const {
      videoElementRef,
      audioElementRef,
      videoPlaybackMode,
      videoPlaybackMessage,
      hasVideoPlaybackStarted,
      isSelectedVideo,
      canStepVideoBackward,
      canStepVideoForward,
      releaseCurrentMedia,
      resetVideoPlaybackState,
      onVideoLoadedMetadata,
      onVideoPlaybackError,
      onAudioLoadedMetadata,
      onAudioPlaybackError,
      onVideoVolumeChange,
      onVideoRateChange,
      onMediaPlaybackStarted,
      onMediaTimeUpdate,
      toggleVideoPlayback,
      seekVideo,
      stepVideoFrame,
      openCurrentWithSystem,
      showCurrentInFolder,
    } = useVideoPlayback({
      api: API,
      selectedItem,
      showToastMessage,
      onExternalAction: () => closeTransientPanels(),
    });
    const {
      editDraft,
      editingDirty,
      activeEditField,
      setDraftFromItem,
      requestEdit,
      removeTagAt,
      removePersonAt,
      setRating,
      setPrivacy,
      autoGrowFieldTextarea,
      autoGrowAllFieldTextareas,
      onFieldTextareaInput,
      cancelEdit,
      confirmEdit,
      resetEditorState,
    } = useMediaEditor({
      api: API,
      view,
      selectedItem,
      saveNotice,
      showSaveNotice,
      showToastMessage,
      resetViewerPickers: () => {
        tagSearch.viewer = "";
        tagDropdown.viewer = false;
        personSearch.viewer = "";
        personDropdown.viewer = false;
        locationSearch.viewer = "";
        locationDropdown.viewer = false;
      },
      syncUpdatedItems: (items) => syncUpdatedItemsIntoGallery(items),
      refreshRegistries: async () => {
        await loadTags();
        await loadAlbums();
        await loadPeople();
        await loadLocations();
      },
    });
    const {
      tagSearch,
      tagDropdown,
      tagCreate,
      tagManager,
      managerFilteredTags,
      loadTags,
      getTagOptions,
      getRecentTagOptions,
      getTagDescription,
      getTagText,
      openTagDropdown,
      closeTagDropdown,
      closeAllTagDropdowns,
      addTagToTarget,
      onTagSearchKeydown,
      openCreateTagMenu,
      closeCreateTagMenu,
      createTagAndSelect,
      openTagManager,
      closeTagManager,
      startTagEdit,
      cancelTagEdit,
      saveTagEdit,
      deleteTagGlobally,
      resetTagState,
    } = useTagRegistry({
      api: API,
      filterOptions,
      query,
      editDraft,
      batchEdit,
      selectedItem,
      orderedItems,
      galleryGroups,
      gallerySettingsOpen,
      recentTags,
      rememberRecentTag,
      pruneRecentTags,
      showToastMessage,
      closeOtherRegistryDropdowns: () => closeAllRegistryDropdowns(),
      requestEdit: (field) => requestEdit(field),
      removeViewerTagAt: (index) => removeTagAt(index),
      removeBatchTagAt,
      rebuildGalleryItemIndex,
      galleryItemIndex,
      queryGallery,
    });
    const {
      personSearch,
      personDropdown,
      personCreate,
      personManager,
      managerFilteredPeople,
      loadPeople,
      getPersonOptions,
      getRecentPersonOptions,
      getPersonDescription,
      getPersonName,
      openPersonDropdown,
      closePersonDropdown,
      closeAllPersonDropdowns,
      addPersonToTarget,
      onPersonSearchKeydown,
      openCreatePersonMenu,
      closeCreatePersonMenu,
      createPersonAndSelect,
      openPersonManager,
      closePersonManager,
      startPersonEdit,
      cancelPersonEdit,
      savePersonEdit,
      deletePersonGlobally,
      resetPersonState,
    } = usePersonRegistry({
      api: API,
      filterOptions,
      query,
      editDraft,
      batchEdit,
      selectedItem,
      orderedItems,
      galleryGroups,
      gallerySettingsOpen,
      recentPeople,
      rememberRecentPerson,
      pruneRecentPeople,
      showToastMessage,
      closeOtherRegistryDropdowns: () => closeAllRegistryDropdowns(),
      requestEdit: (field) => requestEdit(field),
      removeViewerPersonAt: (index) => removePersonAt(index),
      removeBatchPersonAt,
      rebuildGalleryItemIndex,
      galleryItemIndex,
      queryGallery,
    });
    const {
      albumSearch,
      albumDropdown,
      albumCreate,
      albumManager,
      managerFilteredAlbums,
      loadAlbums,
      getAlbumOptions,
      getAlbumDescription,
      getAlbumTitle,
      openAlbumDropdown,
      closeAlbumDropdown,
      closeAllAlbumDropdowns,
      setAlbumForTarget,
      clearAlbumForTarget,
      onAlbumSearchKeydown,
      openCreateAlbumMenu,
      closeCreateAlbumMenu,
      createAlbumAndSelect,
      openAlbumManager,
      closeAlbumManager,
      startAlbumEdit,
      cancelAlbumEdit,
      saveAlbumEdit,
      deleteAlbumGlobally,
      resetAlbumState,
    } = useAlbumRegistry({
      api: API,
      unassignedAlbumFilter: UNASSIGNED_ALBUM_FILTER,
      filterOptions,
      query,
      editDraft,
      batchEdit,
      selectedItem,
      orderedItems,
      galleryGroups,
      gallerySettingsOpen,
      showToastMessage,
      closeOtherRegistryDropdowns: () => closeAllRegistryDropdowns(),
      requestEdit: (field) => requestEdit(field),
      rebuildGalleryItemIndex,
      galleryItemIndex,
      queryGallery,
    });
    const {
      locationSearch,
      locationDropdown,
      locationCreate,
      locationManager,
      locationManagerListRef,
      locationManagerContext,
      managerLocationRows,
      applyLocationRegistry,
      loadLocations,
      getLocationTreeLabel,
      getLocationName,
      getLocationTooltip,
      getLocationManagerRowContext,
      updateLocationManagerContext,
      getLocationMenuRows,
      getLocationFilterRows,
      setLocationFilter,
      setLocationRegionFilter,
      getLocationParentOptions,
      getLocationParentRows,
      openLocationDropdown,
      closeLocationDropdown,
      closeAllLocationDropdowns,
      setLocationForTarget,
      clearLocationForTarget,
      onLocationSearchKeydown,
      openCreateLocationMenu,
      closeCreateLocationMenu,
      setCreateLocationParent,
      clearCreateLocationParent,
      createLocationAndSelect,
      openLocationManager,
      closeLocationManager,
      startLocationEdit,
      cancelLocationEdit,
      saveLocationEdit,
      deleteLocationGlobally,
      resetLocationState,
    } = useLocationRegistry({
      api: API,
      filterOptions,
      query,
      editDraft,
      batchEdit,
      selectedItem,
      orderedItems,
      galleryGroups,
      gallerySettingsOpen,
      recentLocations,
      rememberRecentLocation,
      pruneRecentLocations,
      showToastMessage,
      closeOtherRegistryDropdowns: () => closeAllRegistryDropdowns(),
      requestEdit: (field) => requestEdit(field),
      rebuildGalleryItemIndex,
      galleryItemIndex,
      queryGallery,
      applyFilterSort,
    });
    const {
      showContextMenu,
      contextPosition,
      showLeftPanel,
      showRightPanel,
      ratioStyle,
      viewerHeaderTime,
      openViewer,
      closeViewer,
      switchPhoto,
      openContextMenu,
      closeTransientPanels,
      toggleLeftPanel,
      toggleRightPanel,
      contextCopyImage,
      contextCopyPath,
      contextCopyJson,
      toggleFullscreen,
      resetViewerState,
      initialize: initializeMediaViewer,
      dispose: disposeMediaViewer,
    } = useMediaViewer({
      api: API,
      config,
      view,
      selectedItem,
      orderedItems,
      gallerySettingsOpen,
      editingDirty,
      showToastMessage,
      setDraftFromItem,
      confirmEdit,
      closeRegistryDropdowns: () => closeAllRegistryDropdowns(),
      resetPanZoom,
      releaseCurrentMedia,
      resetVideoPlaybackState,
      imageStageRef,
      isSelectedVideo,
      hasVideoPlaybackStarted,
      seekVideo,
      toggleVideoPlayback,
      stepVideoFrame,
    });

    // Application-level viewer defaults are loaded before a library can enter the gallery.
    async function loadConfig() {
      config.value = await API.getConfig();
      showLeftPanel.value = config.value?.ui?.viewer?.panels?.showLeft ?? true;
      showRightPanel.value = config.value?.ui?.viewer?.panels?.showRight ?? true;
    }

    function resetLibraryUiState() {
      resetViewerState();
      resetGalleryState();
      resetTagState();
      resetAlbumState();
      resetPersonState();
      resetLocationState();
      resetRecentValues();
      resetSelectionState();
      resetEditorState();
      closeTransientPanels();
      gallerySettingsOpen.value = false;
    }

    // A document click closes every registry picker through this shared composition callback.
    function closeAllRegistryDropdowns() {
      closeAllTagDropdowns();
      closeAllAlbumDropdowns();
      closeAllPersonDropdowns();
      closeAllLocationDropdowns();
    }

    onMounted(async () => {
      // Initial render flow: application config -> library state -> optional last-library open.
      await loadConfig();
      await initializeWindowControls();
      initializeGalleryQuery();
      await initializeLibrarySession();
      await nextTick();
      autoGrowAllFieldTextareas();
      initializeMediaViewer();
      initializeImageTransform();
      installUiFeedback();
    });

    onBeforeUnmount(() => {
      // Cleanup global listeners when app unmounts.
      releaseCurrentMedia();
      disposeMediaViewer();
      disposeImageTransform();
      disposeUiFeedback();
      disposeWindowControls();
      disposeLibrarySession();
      disposeGalleryQuery();
    });

    const libraryContext = {
      ICONS, WINDOW_ACTIONS, libraryState, entry, initializationConfirm, libraryInfo,
      maintenanceDialog, maintenanceDialogTitle, maintenanceDialogDescription,
      chooseLibrary, retryLastLibrary, recheckMediaTools, cancelLibraryOperation,
      closeInitializationConfirm, confirmInitializeLibrary, closeLibraryInfo, saveLibraryInfo,
      openLibraryRoot, openLibraryManagerDir, openLibraryLogDir, closeMaintenanceDialog,
      startMaintenanceOperation, copyMaintenanceReport, showMaintenanceOutput,
      doWindowAction, toggleWindowMaximizeRestore, windowToggleTip, windowToggleIcon,
    };
    const galleryContext = {
      ICONS, WINDOW_ACTIONS, query, filterOptions, isSelectionMode, selectedGalleryCount,
      batchEdit, batchStatus, total, galleryGroups, loading, batchHasChanges, canApplyBatchEdit,
      windowToggleTip, windowToggleIcon, UNASSIGNED_ALBUM_FILTER,
      getAlbumDescription, getTagDescription, getPersonDescription,
      resetAll, applySearch, applyFilterSort, setMediaTypeFilter, enterSelectionMode,
      exitSelectionMode, onGalleryCardClick, isGallerySelected, toggleGallerySelection,
      clearGallerySelection, selectAllGalleryPhotos, clearBatchEditInputs, applyBatchEdit,
      buildImageUrl, doWindowAction, toggleWindowMaximizeRestore,
    };
    const galleryFilterContext = {
      ICONS, query, filterOptions, UNASSIGNED_ALBUM_FILTER,
      getAlbumDescription, getTagDescription, getPersonDescription, applyFilterSort,
    };
    const tagContext = {
      ICONS, editDraft, batchEdit, tagSearch, tagDropdown, tagCreate, tagManager,
      managerFilteredTags, getTagOptions, getRecentTagOptions, getTagDescription,
      getTagText,
      openTagDropdown, closeTagDropdown, addTagToTarget, onTagSearchKeydown,
      openCreateTagMenu, closeCreateTagMenu, createTagAndSelect, openTagManager,
      closeTagManager, removeTagAt, removeBatchTagAt, startTagEdit,
      cancelTagEdit, saveTagEdit, deleteTagGlobally,
    };
    const albumContext = {
      ICONS, editDraft, batchEdit, albumSearch, albumDropdown, albumCreate, albumManager,
      managerFilteredAlbums, getAlbumOptions, getAlbumDescription, openAlbumDropdown,
      getAlbumTitle,
      closeAlbumDropdown, setAlbumForTarget, clearAlbumForTarget, onAlbumSearchKeydown,
      openCreateAlbumMenu, closeCreateAlbumMenu, createAlbumAndSelect, openAlbumManager,
      closeAlbumManager, startAlbumEdit, cancelAlbumEdit,
      saveAlbumEdit, deleteAlbumGlobally,
    };
    const personContext = {
      ICONS, editDraft, batchEdit, personSearch, personDropdown, personCreate, personManager,
      managerFilteredPeople, getPersonOptions, getRecentPersonOptions, getPersonDescription,
      getPersonName,
      openPersonDropdown, closePersonDropdown, addPersonToTarget, onPersonSearchKeydown,
      openCreatePersonMenu, closeCreatePersonMenu, createPersonAndSelect, openPersonManager,
      closePersonManager, removePersonAt, removeBatchPersonAt, startPersonEdit,
      cancelPersonEdit, savePersonEdit, deletePersonGlobally,
    };
    const locationContext = {
      ICONS, query, editDraft, batchEdit, locationSearch, locationDropdown, locationCreate,
      locationManager, locationManagerListRef, locationManagerContext, managerLocationRows,
      getLocationMenuRows, getLocationFilterRows,
      getLocationName,
      setLocationFilter, setLocationRegionFilter, getLocationParentOptions, getLocationParentRows, getLocationTooltip,
      getLocationTreeLabel, getLocationManagerRowContext,
      updateLocationManagerContext, openLocationDropdown, closeLocationDropdown,
      setLocationForTarget, clearLocationForTarget, onLocationSearchKeydown,
      openCreateLocationMenu, closeCreateLocationMenu, createLocationAndSelect,
      setCreateLocationParent, clearCreateLocationParent, openLocationManager,
      closeLocationManager, startLocationEdit, cancelLocationEdit, saveLocationEdit,
      deleteLocationGlobally,
    };
    const settingsContext = {
      ICONS, isSelectionMode, gallerySettingsOpen, toggleGallerySettings, closeGallerySettings, openLibraryInfo,
      openMaintenanceDialog, openAlbumManager, openLocationManager, openPersonManager,
      openTagManager, returnToLibraryEntry,
    };
    const viewerContext = {
      ICONS, WINDOW_ACTIONS, selectedItem, viewerHeaderTime, windowToggleTip, windowToggleIcon,
      ratioStyle, showLeftPanel, showRightPanel, imageStageRef, videoElementRef, audioElementRef,
      videoPlaybackMode, videoPlaybackMessage, canStepVideoBackward, canStepVideoForward,
      isSelectedVideo, showContextMenu, contextPosition, editDraft, editingDirty, activeEditField,
      saveNotice, STAR_LEVELS, viewerImageStyle, minZoom, maxZoom, zoomPercent, zoomStep,
      closeViewer, doWindowAction, toggleWindowMaximizeRestore, formatFileSize, formatDuration,
      formatBitRate, onImageWheel, onDrag, endDrag, openContextMenu, switchPhoto, startDrag,
      toggleFullscreen, buildImageUrl, contextCopyImage, contextCopyPath, contextCopyJson,
      openCurrentWithSystem, showCurrentInFolder, onVideoLoadedMetadata, onVideoPlaybackError,
      onAudioLoadedMetadata, onAudioPlaybackError, onVideoVolumeChange, onVideoRateChange,
      onMediaPlaybackStarted, onMediaTimeUpdate, stepVideoFrame, onFieldTextareaInput,
      confirmEdit, cancelEdit, setRating, setPrivacy, requestEdit, toggleLeftPanel, zoomIn, zoomOut,
      rotateClockwise, rotateCounterclockwise, toggleMirror, restoreImageState, toggleRightPanel,
    };
    const uiFeedbackContext = { toast, dynamicTooltip, dynamicTooltipRef };

    provide(LIBRARY_CONTEXT, libraryContext);
    provide(GALLERY_CONTEXT, galleryContext);
    provide(GALLERY_FILTER_CONTEXT, galleryFilterContext);
    provide(TAG_CONTEXT, tagContext);
    provide(ALBUM_CONTEXT, albumContext);
    provide(PERSON_CONTEXT, personContext);
    provide(LOCATION_CONTEXT, locationContext);
    provide(SETTINGS_CONTEXT, settingsContext);
    provide(VIEWER_CONTEXT, viewerContext);
    provide(UI_FEEDBACK_CONTEXT, uiFeedbackContext);

    return { view };
}
