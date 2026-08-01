function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function normalizeQuarterTurn(rotationDegrees) {
  const normalized = ((Number(rotationDegrees) || 0) % 360 + 360) % 360;
  return Math.round(normalized / 90) % 4;
}

export function calculateFittedMediaSize({
  stageWidth,
  stageHeight,
  mediaWidth,
  mediaHeight,
  maxFraction = 1,
}) {
  const availableWidth = positiveNumber(stageWidth) * Math.min(1, Math.max(0, Number(maxFraction) || 0));
  const availableHeight = positiveNumber(stageHeight) * Math.min(1, Math.max(0, Number(maxFraction) || 0));
  const sourceWidth = positiveNumber(mediaWidth);
  const sourceHeight = positiveNumber(mediaHeight);
  if (!availableWidth || !availableHeight || !sourceWidth || !sourceHeight) return { width: 0, height: 0 };
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}

export function calculateRotationFitScale({
  stageWidth,
  stageHeight,
  fittedWidth,
  fittedHeight,
  rotationDegrees,
}) {
  const width = positiveNumber(fittedWidth);
  const height = positiveNumber(fittedHeight);
  const availableWidth = positiveNumber(stageWidth);
  const availableHeight = positiveNumber(stageHeight);
  if (!width || !height || !availableWidth || !availableHeight) return 1;
  const swapsAxes = normalizeQuarterTurn(rotationDegrees) % 2 === 1;
  const rotatedWidth = swapsAxes ? height : width;
  const rotatedHeight = swapsAxes ? width : height;
  return Math.min(1, availableWidth / rotatedWidth, availableHeight / rotatedHeight);
}

export function calculatePointerAnchoredPan({
  panX,
  panY,
  pointerX,
  pointerY,
  previousScale,
  nextScale,
}) {
  const currentX = Number.isFinite(Number(panX)) ? Number(panX) : 0;
  const currentY = Number.isFinite(Number(panY)) ? Number(panY) : 0;
  const anchorX = Number.isFinite(Number(pointerX)) ? Number(pointerX) : 0;
  const anchorY = Number.isFinite(Number(pointerY)) ? Number(pointerY) : 0;
  const fromScale = positiveNumber(previousScale);
  const toScale = positiveNumber(nextScale);
  if (!fromScale || !toScale) return { x: currentX, y: currentY };
  const ratio = toScale / fromScale;
  return {
    x: anchorX - ratio * (anchorX - currentX),
    y: anchorY - ratio * (anchorY - currentY),
  };
}

export function resolveWheelZoomStep(zoomPercent, baseStep) {
  const zoom = Number(zoomPercent) || 0;
  if (zoom > 500) return 50;
  if (zoom >= 200) return 20;
  return positiveNumber(baseStep);
}

export function exceedsDragThreshold(deltaX, deltaY, threshold = 4) {
  const limit = Math.max(0, Number(threshold) || 0);
  return Math.hypot(Number(deltaX) || 0, Number(deltaY) || 0) >= limit;
}
