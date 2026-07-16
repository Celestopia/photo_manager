export const WINDOW_ACTIONS = Object.freeze({
  minimize: "minimize",
  maximize: "maximize",
  restore: "restore",
  close: "close",
});

export const UNASSIGNED_ALBUM_FILTER = "__UNASSIGNED__";
export const STAR_LEVELS = Object.freeze([1, 2, 3, 4, 5]);
export const PRIVACY_LEVELS = Object.freeze([1, 2, 3, 4, 5]);

export const ICONS = Object.freeze({
  gallery: new URL("../assets/gallery.svg", import.meta.url).href,
  windowMinimize: new URL("../assets/window_minimize.svg", import.meta.url).href,
  windowMaximize: new URL("../assets/window_maximize.svg", import.meta.url).href,
  windowRestore: new URL("../assets/window_restore.svg", import.meta.url).href,
  windowClose: new URL("../assets/window_close.svg", import.meta.url).href,
  settings: new URL("../assets/settings.svg", import.meta.url).href,
  metadataInfo: new URL("../assets/metadata_info.svg", import.meta.url).href,
  zoomIn: new URL("../assets/image_zoom_in.svg", import.meta.url).href,
  zoomOut: new URL("../assets/image_zoom_out.svg", import.meta.url).href,
  rotateClockwise: new URL("../assets/image_rotate_clockwise.svg", import.meta.url).href,
  rotateCounterclockwise: new URL("../assets/image_rotate_counterclockwise.svg", import.meta.url).href,
  mirror: new URL("../assets/image_mirror.svg", import.meta.url).href,
  restoreView: new URL("../assets/image_restore_view.svg", import.meta.url).href,
  fullscreen: new URL("../assets/image_fullscreen.svg", import.meta.url).href,
  chevronDown: new URL("../assets/chevron_down.svg", import.meta.url).href,
  previousFrame: new URL("../assets/video_previous_frame.svg", import.meta.url).href,
  nextFrame: new URL("../assets/video_next_frame.svg", import.meta.url).href,
  videoPlay: new URL("../assets/video_play.svg", import.meta.url).href,
  videoPause: new URL("../assets/video_pause.svg", import.meta.url).href,
  videoVolume: new URL("../assets/video_volume.svg", import.meta.url).href,
  videoMuted: new URL("../assets/video_muted.svg", import.meta.url).href,
  openSystem: new URL("../assets/open_system.svg", import.meta.url).href,
  customization: new URL("../assets/customization.svg", import.meta.url).href,
  videoPlaceholder: new URL("../assets/video_placeholder.svg", import.meta.url).href,
  imagePlaceholder: new URL("../assets/image_placeholder.svg", import.meta.url).href,
  privacyPattern: new URL("../assets/privacy_pattern.svg", import.meta.url).href,
});
