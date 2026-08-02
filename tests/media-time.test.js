const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMediaTimestamp,
  formatInstantInZone,
  resolveMediaShootingTime,
} = require("../scripts/media-time");

test("parses explicit offsets and floating wall times without using the host timezone", () => {
  const zoned = parseMediaTimestamp("2025-08-02T11:43:25.250-0700");
  assert.equal(zoned.text, "2025-08-02 11:43:25");
  assert.equal(zoned.zone, -7);
  assert.equal(zoned.stamp, Math.floor(Date.UTC(2025, 7, 2, 18, 43, 25, 250) / 1000));

  const exif = parseMediaTimestamp("2025:08:03 02:43:25", "+08:00");
  assert.equal(exif.zone, 8);
  assert.equal(exif.stamp, Date.UTC(2025, 7, 2, 18, 43, 25) / 1000);

  const floating = parseMediaTimestamp("2025:08:02 11:43:25");
  assert.equal(floating.text, "2025-08-02 11:43:25");
  assert.equal(floating.zone, null);
  assert.equal(floating.stamp, null);
});

test("formats the same absolute instant with date-specific daylight-saving offsets", () => {
  const summerStamp = Date.UTC(2025, 7, 2, 18, 43, 25) / 1000;
  assert.deepEqual(formatInstantInZone(summerStamp, "America/Los_Angeles"), {
    text: "2025-08-02 11:43:25",
    zone: -7,
    stamp: summerStamp,
  });

  const winterStamp = Date.UTC(2025, 0, 2, 19, 43, 25) / 1000;
  assert.deepEqual(formatInstantInZone(winterStamp, "America/Los_Angeles"), {
    text: "2025-01-02 11:43:25",
    zone: -8,
    stamp: winterStamp,
  });
});

test("localizes UTC video creation times through the offline GPS timezone lookup", () => {
  const shooting = resolveMediaShootingTime({
    candidates: [{ source: "format", value: "2025-08-02T18:43:25Z" }],
    gps: { latitude: 36.9585, longitude: -122.0175 },
  });
  assert.deepEqual(
    { text: shooting.text, zone: shooting.zone, stamp: shooting.stamp },
    {
      text: "2025-08-02 11:43:25",
      zone: -7,
      stamp: Date.UTC(2025, 7, 2, 18, 43, 25) / 1000,
    },
  );
});

test("keeps an explicit non-UTC source offset authoritative over GPS", () => {
  const shooting = resolveMediaShootingTime({
    candidates: [
      { source: "format", value: "2025-08-02T18:43:25Z" },
      { source: "quicktime", value: "2025-08-03T03:43:25+09:00" },
    ],
    gps: { latitude: 36.9585, longitude: -122.0175 },
    lookup: () => ["America/Los_Angeles"],
  });
  assert.equal(shooting.text, "2025-08-03 03:43:25");
  assert.equal(shooting.zone, 9);
  assert.equal(shooting.stamp, Date.UTC(2025, 7, 2, 18, 43, 25) / 1000);
});

test("resolves floating wall times only when GPS identifies one instant", () => {
  const regular = resolveMediaShootingTime({
    candidates: ["2025-08-02 11:43:25"],
    gps: { latitude: 36.9585, longitude: -122.0175 },
    lookup: () => ["America/Los_Angeles"],
  });
  assert.equal(regular.zone, -7);
  assert.equal(regular.stamp, Date.UTC(2025, 7, 2, 18, 43, 25) / 1000);

  const repeatedHour = resolveMediaShootingTime({
    candidates: ["2025-11-02 01:30:00"],
    gps: { latitude: 36.9585, longitude: -122.0175 },
    lookup: () => ["America/Los_Angeles"],
  });
  assert.equal(repeatedHour.text, "2025-11-02 01:30:00");
  assert.equal(repeatedHour.zone, null);
  assert.equal(repeatedHour.stamp, null);
});

test("does not guess when a coordinate boundary yields different local times", () => {
  const shooting = resolveMediaShootingTime({
    candidates: ["2025-01-02T19:43:25Z"],
    gps: { latitude: 0, longitude: 0 },
    lookup: () => ["America/Los_Angeles", "America/Phoenix"],
  });
  assert.equal(shooting.text, "2025-01-02 19:43:25");
  assert.equal(shooting.zone, 0);
});

test("keeps UTC when GPS coordinates are absent", () => {
  const shooting = resolveMediaShootingTime({
    candidates: ["2025-08-02T18:43:25Z"],
    gps: { latitude: null, longitude: null },
    lookup: () => { throw new Error("missing GPS must not be looked up"); },
  });
  assert.equal(shooting.text, "2025-08-02 18:43:25");
  assert.equal(shooting.zone, 0);
  assert.equal(shooting.stamp, Date.UTC(2025, 7, 2, 18, 43, 25) / 1000);
});
