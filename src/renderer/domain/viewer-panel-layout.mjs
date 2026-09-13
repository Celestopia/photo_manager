export const VIEWER_PANEL_LIMITS = Object.freeze({
  leftMin: 220,
  rightMin: 300,
  centerMin: 420,
  maxFraction: 0.45,
  collapseThreshold: 96,
  handleWidth: 10,
});

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeRatios(value) {
  const left = finiteNonNegative(value?.left, 1) || 1;
  const center = finiteNonNegative(value?.center, 3) || 3;
  const right = finiteNonNegative(value?.right, 1) || 1;
  return { left, center, right };
}

function panelFloors(availableWidth, showLeft, showRight, limits) {
  const handles = (showLeft ? limits.handleWidth : 0) + (showRight ? limits.handleWidth : 0);
  const panelBudget = Math.max(0, availableWidth - handles - limits.centerMin);
  const requestedLeft = showLeft ? limits.leftMin : 0;
  const requestedRight = showRight ? limits.rightMin : 0;
  const requestedTotal = requestedLeft + requestedRight;
  const scale = requestedTotal > 0 ? Math.min(1, panelBudget / requestedTotal) : 0;
  return {
    handles,
    panelBudget,
    left: requestedLeft * scale,
    right: requestedRight * scale,
  };
}

export function reconcileViewerPanelWidths({
  availableWidth,
  leftWidth,
  rightWidth,
  showLeft = true,
  showRight = true,
  panelRatio,
  limits = VIEWER_PANEL_LIMITS,
}) {
  const width = finiteNonNegative(availableWidth);
  const ratios = normalizeRatios(panelRatio);
  const floors = panelFloors(width, showLeft, showRight, limits);
  const ratioTotal = ratios.center + (showLeft ? ratios.left : 0) + (showRight ? ratios.right : 0);
  const ratioSpace = Math.max(0, width - floors.handles);
  const defaultLeft = showLeft ? ratioSpace * ratios.left / ratioTotal : 0;
  const defaultRight = showRight ? ratioSpace * ratios.right / ratioTotal : 0;
  const maximum = width * limits.maxFraction;

  let left = showLeft
    ? Math.max(floors.left, Math.min(finiteNonNegative(leftWidth, defaultLeft), Math.max(floors.left, maximum)))
    : 0;
  let right = showRight
    ? Math.max(floors.right, Math.min(finiteNonNegative(rightWidth, defaultRight), Math.max(floors.right, maximum)))
    : 0;

  const excess = Math.max(0, left + right - floors.panelBudget);
  if (excess > 0) {
    const leftRoom = Math.max(0, left - floors.left);
    const rightRoom = Math.max(0, right - floors.right);
    const room = leftRoom + rightRoom;
    if (room > 0) {
      left -= Math.min(leftRoom, excess * leftRoom / room);
      right -= Math.min(rightRoom, excess * rightRoom / room);
      const remainder = Math.max(0, left + right - floors.panelBudget);
      if (remainder > 0) {
        const extraLeft = Math.max(0, left - floors.left);
        const leftReduction = Math.min(extraLeft, remainder);
        left -= leftReduction;
        right -= Math.min(Math.max(0, right - floors.right), remainder - leftReduction);
      }
    }
  }

  return { left, right };
}

export function resolveViewerPanelDrag({
  side,
  rawWidth,
  availableWidth,
  leftWidth,
  rightWidth,
  showLeft = true,
  showRight = true,
  panelRatio,
  limits = VIEWER_PANEL_LIMITS,
}) {
  if (side !== "left" && side !== "right") throw new Error("Unknown viewer panel side");
  const desiredWidth = finiteNonNegative(rawWidth);
  if (desiredWidth < limits.collapseThreshold) return { collapsed: true, width: 0 };

  const current = reconcileViewerPanelWidths({
    availableWidth,
    leftWidth,
    rightWidth,
    showLeft,
    showRight,
    panelRatio,
    limits,
  });
  const width = finiteNonNegative(availableWidth);
  const floors = panelFloors(width, showLeft, showRight, limits);
  const otherWidth = side === "left" ? current.right : current.left;
  const ownFloor = side === "left" ? floors.left : floors.right;
  const centerMaximum = Math.max(0, floors.panelBudget - otherWidth);
  const maximum = Math.max(ownFloor, Math.min(width * limits.maxFraction, centerMaximum));

  return {
    collapsed: false,
    width: Math.max(ownFloor, Math.min(desiredWidth, maximum)),
  };
}
