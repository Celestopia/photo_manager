export function calculateFrameStepTarget(currentTime, duration, frameRate, direction) {
  const current = Number(currentTime);
  const total = Number(duration);
  const fps = Number(frameRate);
  const stepDirection = Number(direction);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(stepDirection) || stepDirection === 0) return null;
  const delta = (stepDirection < 0 ? -1 : 1) / fps;
  return Math.min(total, Math.max(0, current + delta));
}

export function clampVideoTime(value, duration) {
  const total = Number(duration);
  const time = Number(value);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(time)) return 0;
  return Math.min(total, Math.max(0, time));
}

export function calculateBufferedPercent(bufferedEnd, duration) {
  const total = Number(duration);
  const end = Number(bufferedEnd);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(end)) return 0;
  return Math.min(100, Math.max(0, (end / total) * 100));
}

export function resolveHorizontalArrowAction({ isVideo, hasPlaybackStarted, shiftKey }) {
  if (!isVideo || shiftKey || !hasPlaybackStarted) return "navigate";
  return "seek";
}
