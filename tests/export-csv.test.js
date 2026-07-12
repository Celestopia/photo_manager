const test = require("node:test");
const assert = require("node:assert/strict");
const { COLUMNS, toCell } = require("../scripts/export-metadata-csv");

test("CSV schema exports all normalized video fields", () => {
  const headers = new Set(COLUMNS.map((column) => column.header));
  for (const header of [
    "Video.ProbeStatus",
    "Video.DurationSeconds",
    "Video.DisplayWidth",
    "Video.FrameRateRatio",
    "Video.VideoCodec",
    "Video.AudioCodec",
    "Video.ColorPrimaries",
  ]) {
    assert.equal(headers.has(header), true, `${header} should be exported`);
  }
});

test("CSV cells quote commas and double quotes", () => {
  assert.equal(toCell('a,"b"'), '"a,""b"""');
});

test("image rows leave video-specific CSV cells empty", () => {
  const image = { FileSystem: { FileType: "image" }, Picture: { Width: 100, Height: 80 } };
  const videoColumns = COLUMNS.filter((column) => column.header.startsWith("Video."));
  assert.ok(videoColumns.length > 0);
  assert.equal(videoColumns.every((column) => column.get(image) === ""), true);
});
