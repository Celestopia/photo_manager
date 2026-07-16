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

test("CSV exports normalized picture fields and preserves nullable flash semantics", () => {
  const columns = Object.fromEntries(COLUMNS.map((column) => [column.header, column]));
  const image = { Picture: { Dpi: 72, BitDepth: 8 }, Camera: { FlashUsed: false } };
  assert.equal(columns["Picture.Dpi"].get(image), 72);
  assert.equal(columns["Picture.BitDepth"].get(image), 8);
  assert.equal(columns["Camera.FlashUsed"].get(image), false);
  assert.equal(columns["Camera.FlashUsed"].get({ Camera: { FlashUsed: null } }), "");
});

test("CSV places Privacy immediately after Rating", () => {
  const headers = COLUMNS.map((column) => column.header);
  assert.equal(headers[headers.indexOf("Rating") + 1], "Privacy");
  const privacyColumn = COLUMNS.find((column) => column.header === "Privacy");
  assert.equal(privacyColumn.get({ Customization: { Privacy: 4 } }), 4);
});

test("CSV exports stable IDs alongside resolved registry display names", () => {
  const ids = {
    media: "00000000-0000-4000-8000-000000000001",
    album: "00000000-0000-4000-8000-000000000002",
    tag: "00000000-0000-4000-8000-000000000003",
    person: "00000000-0000-4000-8000-000000000004",
    location: "00000000-0000-4000-8000-000000000005",
  };
  const item = {
    MediaId: ids.media,
    Customization: { AlbumId: ids.album, TagIds: [ids.tag], PersonIds: [ids.person] },
    Location: { LocationId: ids.location, Detail: "" },
  };
  const context = {
    albums: new Map([[ids.album, { Title: "Camera" }]]),
    tags: new Map([[ids.tag, { Text: "美食" }]]),
    people: new Map([[ids.person, { Name: "我" }]]),
    locations: new Map([[ids.location, { Name: "清华大学" }]]),
  };
  const values = Object.fromEntries(COLUMNS.map((column) => [column.header, column.get(item, context)]));
  assert.equal(values.MediaId, ids.media);
  assert.equal(values.AlbumId, ids.album);
  assert.equal(values.Album, "Camera");
  assert.equal(values.TagIds, ids.tag);
  assert.equal(values.Tags, "美食");
  assert.equal(values.PersonIds, ids.person);
  assert.equal(values.People, "我");
  assert.equal(values.LocationId, ids.location);
  assert.equal(values["Location.Name"], "清华大学");
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
