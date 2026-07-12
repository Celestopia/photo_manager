const test = require("node:test");
const assert = require("node:assert/strict");

test("calculates bounded forward and backward frame targets", async () => {
  const { calculateFrameStepTarget } = await import("../src/renderer/video-playback.mjs");
  assert.equal(calculateFrameStepTarget(1, 10, 25, 1), 1.04);
  assert.equal(calculateFrameStepTarget(1, 10, 25, -1), 0.96);
  assert.equal(calculateFrameStepTarget(0, 10, 25, -1), 0);
  assert.equal(calculateFrameStepTarget(9.99, 10, 25, 1), 10);
  assert.equal(calculateFrameStepTarget(1, 10, 0, 1), null);
  assert.equal(calculateFrameStepTarget(1, 10, 25, 0), null);
});

test("resolves horizontal arrow behavior from playback-session state", async () => {
  const { resolveHorizontalArrowAction } = await import("../src/renderer/video-playback.mjs");
  assert.equal(resolveHorizontalArrowAction({ isVideo: false, hasPlaybackStarted: false, shiftKey: false }), "navigate");
  assert.equal(resolveHorizontalArrowAction({ isVideo: true, hasPlaybackStarted: false, shiftKey: false }), "navigate");
  assert.equal(resolveHorizontalArrowAction({ isVideo: true, hasPlaybackStarted: true, shiftKey: false }), "seek");
  assert.equal(resolveHorizontalArrowAction({ isVideo: true, hasPlaybackStarted: true, shiftKey: true }), "navigate");
  assert.equal(resolveHorizontalArrowAction({ isVideo: true, hasPlaybackStarted: false, shiftKey: true }), "navigate");
});
