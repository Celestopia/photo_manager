import { computed, ref, watch } from "vue";
import {
  reconcileViewerPanelWidths,
  resolveViewerPanelDrag,
  VIEWER_PANEL_LIMITS,
} from "../domain/viewer-panel-layout.mjs";

/** Owns one window's resizable viewer side-panel layout and pointer lifecycle. */
export function useViewerPanelLayout({ config, onResizeStart }) {
  const viewerLayoutRef = ref(null);
  const showLeftPanel = ref(true);
  const showRightPanel = ref(true);
  const leftPanelWidth = ref(0);
  const rightPanelWidth = ref(0);
  const panelResizeSide = ref("");
  let availableWidth = 0;
  let widthsInitialized = false;
  let resizeObserver = null;
  let activePointer = null;

  const panelRatio = () => config.value?.ui?.viewer?.panelRatio || { left: 1, center: 3, right: 1 };

  const ratioStyle = computed(() => ({
    gridTemplateColumns: [
      showLeftPanel.value ? `${leftPanelWidth.value}px` : "0px",
      showLeftPanel.value ? `${VIEWER_PANEL_LIMITS.handleWidth}px` : "0px",
      "minmax(0, 1fr)",
      showRightPanel.value ? `${VIEWER_PANEL_LIMITS.handleWidth}px` : "0px",
      showRightPanel.value ? `${rightPanelWidth.value}px` : "0px",
    ].join(" "),
  }));

  function measureAvailableWidth(element = viewerLayoutRef.value) {
    if (!element) return 0;
    const style = window.getComputedStyle(element);
    const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    return Math.max(0, element.clientWidth - horizontalPadding);
  }

  function applyWidths(widths) {
    leftPanelWidth.value = widths.left;
    rightPanelWidth.value = widths.right;
  }

  function reconcileWidths({ useDefaults = false } = {}) {
    availableWidth = measureAvailableWidth();
    if (!availableWidth) return;
    applyWidths(reconcileViewerPanelWidths({
      availableWidth,
      leftWidth: useDefaults || !widthsInitialized ? undefined : leftPanelWidth.value,
      rightWidth: useDefaults || !widthsInitialized ? undefined : rightPanelWidth.value,
      showLeft: showLeftPanel.value,
      showRight: showRightPanel.value,
      panelRatio: panelRatio(),
    }));
    widthsInitialized = true;
  }

  function observeLayout(element) {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!element) return;
    reconcileWidths();
    if (typeof ResizeObserver !== "function") return;
    resizeObserver = new ResizeObserver(() => reconcileWidths());
    resizeObserver.observe(element);
  }

  function finishPanelResize() {
    if (activePointer?.target?.hasPointerCapture?.(activePointer.pointerId)) {
      try { activePointer.target.releasePointerCapture(activePointer.pointerId); } catch {}
    }
    activePointer = null;
    panelResizeSide.value = "";
    document.documentElement.classList.remove("viewer-panel-resizing");
    window.removeEventListener("pointermove", onPanelPointerMove, true);
    window.removeEventListener("pointerup", finishPanelResize, true);
    window.removeEventListener("pointercancel", finishPanelResize, true);
  }

  function collapseViewerPanel(side) {
    if (side === "left") {
      showLeftPanel.value = false;
      leftPanelWidth.value = 0;
    } else if (side === "right") {
      showRightPanel.value = false;
      rightPanelWidth.value = 0;
    }
    finishPanelResize();
  }

  function restoreViewerPanel(side) {
    if (side !== "left" && side !== "right") return;
    if (side === "left") showLeftPanel.value = true;
    else showRightPanel.value = true;
    availableWidth = measureAvailableWidth();
    const defaults = reconcileViewerPanelWidths({
      availableWidth,
      showLeft: showLeftPanel.value,
      showRight: showRightPanel.value,
      panelRatio: panelRatio(),
    });
    applyWidths(reconcileViewerPanelWidths({
      availableWidth,
      leftWidth: side === "left" ? defaults.left : leftPanelWidth.value,
      rightWidth: side === "right" ? defaults.right : rightPanelWidth.value,
      showLeft: showLeftPanel.value,
      showRight: showRightPanel.value,
      panelRatio: panelRatio(),
    }));
    widthsInitialized = true;
  }

  function resetViewerPanelLayout() {
    finishPanelResize();
    showLeftPanel.value = config.value?.ui?.viewer?.panels?.showLeft ?? true;
    showRightPanel.value = config.value?.ui?.viewer?.panels?.showRight ?? true;
    leftPanelWidth.value = 0;
    rightPanelWidth.value = 0;
    widthsInitialized = false;
    reconcileWidths({ useDefaults: true });
  }

  function onPanelPointerMove(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    const element = viewerLayoutRef.value;
    if (!element) return finishPanelResize();
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const contentLeft = rect.left + (Number.parseFloat(style.paddingLeft) || 0);
    const contentRight = rect.right - (Number.parseFloat(style.paddingRight) || 0);
    availableWidth = Math.max(0, contentRight - contentLeft);
    const halfHandle = VIEWER_PANEL_LIMITS.handleWidth / 2;
    const rawWidth = activePointer.side === "left"
      ? event.clientX - contentLeft - halfHandle
      : contentRight - event.clientX - halfHandle;
    const result = resolveViewerPanelDrag({
      side: activePointer.side,
      rawWidth,
      availableWidth,
      leftWidth: leftPanelWidth.value,
      rightWidth: rightPanelWidth.value,
      showLeft: showLeftPanel.value,
      showRight: showRightPanel.value,
      panelRatio: panelRatio(),
    });
    if (result.collapsed) {
      collapseViewerPanel(activePointer.side);
      return;
    }
    if (activePointer.side === "left") leftPanelWidth.value = result.width;
    else rightPanelWidth.value = result.width;
  }

  function beginPanelResize(side, event) {
    if ((side !== "left" && side !== "right") || event.button !== 0) return;
    if ((side === "left" && !showLeftPanel.value) || (side === "right" && !showRightPanel.value)) return;
    finishPanelResize();
    event.preventDefault();
    event.stopPropagation();
    onResizeStart?.();
    activePointer = { side, pointerId: event.pointerId, target: event.currentTarget };
    panelResizeSide.value = side;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add("viewer-panel-resizing");
    window.addEventListener("pointermove", onPanelPointerMove, true);
    window.addEventListener("pointerup", finishPanelResize, true);
    window.addEventListener("pointercancel", finishPanelResize, true);
  }

  const stopLayoutWatch = watch(viewerLayoutRef, observeLayout, { flush: "post" });

  function disposeViewerPanelLayout() {
    finishPanelResize();
    resizeObserver?.disconnect();
    resizeObserver = null;
    stopLayoutWatch();
  }

  return {
    viewerLayoutRef,
    showLeftPanel,
    showRightPanel,
    panelResizeSide,
    ratioStyle,
    beginPanelResize,
    restoreViewerPanel,
    resetViewerPanelLayout,
    disposeViewerPanelLayout,
  };
}
