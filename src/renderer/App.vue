<template>
  <div class="app-shell">
    <LibraryEntryView v-if="view === 'library-entry'" />
    <GalleryView v-else-if="view === 'gallery'" />
    <ViewerView v-else-if="view === 'viewer'" />
    <LibraryDialogs />
    <TagManagerDialog />
    <AlbumManagerDialog />
    <PersonManagerDialog />
    <LocationManagerDialog />
    <UiFeedbackOverlay />
    <MediaDeletionDialog />
    <ProviderSettings v-if="providerSettingsOpen" />
  </div>
</template>

<script>
import ProviderSettings from "./components/ProviderSettings.vue";
import GalleryView from "./components/GalleryView.vue";
import ViewerView from "./components/ViewerView.vue";
import LibraryEntryView from "./components/LibraryEntryView.vue";
import LibraryDialogs from "./components/dialogs/LibraryDialogs.vue";
import TagManagerDialog from "./components/dialogs/TagManagerDialog.vue";
import AlbumManagerDialog from "./components/dialogs/AlbumManagerDialog.vue";
import PersonManagerDialog from "./components/dialogs/PersonManagerDialog.vue";
import LocationManagerDialog from "./components/dialogs/LocationManagerDialog.vue";
import UiFeedbackOverlay from "./components/dialogs/UiFeedbackOverlay.vue";
import MediaDeletionDialog from "./components/dialogs/MediaDeletionDialog.vue";
import { useRendererApplication } from "./application/use-renderer-application.js";

export default {
  name: "PhotoManagerApp",
  components: {
    ProviderSettings,
    GalleryView,
    ViewerView,
    LibraryEntryView,
    LibraryDialogs,
    TagManagerDialog,
    AlbumManagerDialog,
    PersonManagerDialog,
    LocationManagerDialog,
    UiFeedbackOverlay,
    MediaDeletionDialog,
  },
  setup: useRendererApplication,
};
</script>
