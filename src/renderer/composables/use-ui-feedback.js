import { nextTick, reactive, ref } from "vue";

/**
 * Owns transient feedback UI and all global listeners used by data-tip tooltips.
 * Installation is explicit so the application composition root controls startup order.
 */
export function useUiFeedback() {
  const toast = reactive({ visible: false, message: "" });
  const saveNotice = reactive({ visible: false, message: "", field: "" });
  const dynamicTooltip = reactive({ visible: false, text: "", x: 0, y: 0 });
  const dynamicTooltipRef = ref(null);

  let toastTimer = null;
  let saveNoticeTimer = null;
  let tooltipTimer = null;
  let tooltipTarget = null;
  let installed = false;

  function showToastMessage(message) {
    toast.message = message;
    toast.visible = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.visible = false;
    }, 1800);
  }

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

  function hideDynamicTooltip() {
    dynamicTooltip.visible = false;
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
  }

  async function positionDynamicTooltip(target) {
    if (!target || !dynamicTooltip.visible || !dynamicTooltipRef.value) return;
    const rect = target.getBoundingClientRect();
    const tipRect = dynamicTooltipRef.value.getBoundingClientRect();
    const margin = 8;
    let x = rect.left + rect.width / 2 - tipRect.width / 2;
    x = Math.max(margin, Math.min(x, window.innerWidth - tipRect.width - margin));

    const preferTop = rect.top - tipRect.height - 10;
    const preferBottom = rect.bottom + 10;
    let y = preferTop < margin ? preferBottom : preferTop;
    if (y + tipRect.height > window.innerHeight - margin) {
      y = Math.max(margin, rect.top - tipRect.height - 10);
    }
    dynamicTooltip.x = x;
    dynamicTooltip.y = y;
  }

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

  function onTooltipMouseOver(event) {
    const target = event.target.closest("[data-tip]");
    if (!target || (target === tooltipTarget && dynamicTooltip.visible)) return;
    scheduleDynamicTooltip(target);
  }

  function onTooltipMouseOut(event) {
    const leaving = event.target.closest?.("[data-tip]");
    if (!leaving || leaving !== tooltipTarget) return;
    const related = event.relatedTarget;
    if (related && leaving.contains(related)) return;
    tooltipTarget = null;
    hideDynamicTooltip();
  }

  function onTooltipGlobalHide() {
    tooltipTarget = null;
    hideDynamicTooltip();
  }

  async function onTooltipViewportChange() {
    if (!dynamicTooltip.visible || !tooltipTarget) return;
    await nextTick();
    await positionDynamicTooltip(tooltipTarget);
  }

  function install() {
    if (installed) return;
    installed = true;
    window.addEventListener("resize", onTooltipViewportChange);
    window.addEventListener("scroll", onTooltipViewportChange, true);
    document.addEventListener("mouseover", onTooltipMouseOver);
    document.addEventListener("mouseout", onTooltipMouseOut);
    document.addEventListener("mousedown", onTooltipGlobalHide);
  }

  function dispose() {
    if (installed) {
      installed = false;
      window.removeEventListener("resize", onTooltipViewportChange);
      window.removeEventListener("scroll", onTooltipViewportChange, true);
      document.removeEventListener("mouseover", onTooltipMouseOver);
      document.removeEventListener("mouseout", onTooltipMouseOut);
      document.removeEventListener("mousedown", onTooltipGlobalHide);
    }
    if (toastTimer) clearTimeout(toastTimer);
    if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
    onTooltipGlobalHide();
  }

  return {
    toast,
    saveNotice,
    dynamicTooltip,
    dynamicTooltipRef,
    showToastMessage,
    showSaveNotice,
    install,
    dispose,
  };
}
