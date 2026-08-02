const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMediaTimestamp,
  formatInstantInZone,
  formatInstantWithContext,
  resolveMediaShootingTime,
  resolveStoredMediaTimeContext,
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

test("formats filesystem instants in the media reference timezone", () => {
  const shooting = resolveMediaShootingTime({
    candidates: ["2025-08-27T23:14:43Z"],
    gps: { latitude: 38.5454, longitude: -121.7544 },
    lookup: () => ["America/Los_Angeles"],
  });
  const modificationStamp = Date.UTC(2025, 7, 27, 23, 14, 44) / 1000;
  assert.deepEqual(formatInstantWithContext(modificationStamp, shooting.context), {
    text: "2025-08-27 16:14:44",
    zone: -7,
    stamp: modificationStamp,
  });

  const winterStamp = Date.UTC(2025, 0, 2, 19, 14, 44) / 1000;
  assert.equal(formatInstantWithContext(winterStamp, shooting.context).zone, -8);
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
  const later = formatInstantWithContext(Date.UTC(2026, 0, 2, 0, 0, 0) / 1000, shooting.context);
  assert.equal(later.text, "2026-01-02 09:00:00");
  assert.equal(later.zone, 9);
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

test("reconstructs the reference timezone for moved current-contract records", () => {
  const stamp = Date.UTC(2025, 7, 27, 23, 14, 43) / 1000;
  const gps = {
    LatitudeRef: "N",
    Latitude: [38, 32, 43.44],
    LongitudeRef: "W",
    Longitude: [121, 45, 15.84],
  };
  const gpsContext = resolveStoredMediaTimeContext({
    FileSystem: {
      ShootingTimeString: "2025-08-27 16:14:43",
      ShootingTimeZone: -7,
      ShootingTimeStamp: stamp,
    },
    GPS: gps,
  }, () => ["America/Los_Angeles"]);
  assert.equal(formatInstantWithContext(Date.UTC(2025, 0, 2, 20, 0, 0) / 1000, gpsContext).zone, -8);

  const explicitContext = resolveStoredMediaTimeContext({
    FileSystem: {
      ShootingTimeString: "2025-08-28 08:14:43",
      ShootingTimeZone: 9,
      ShootingTimeStamp: stamp,
    },
    GPS: gps,
  }, () => ["America/Los_Angeles"]);
  assert.equal(formatInstantWithContext(stamp, explicitContext).zone, 9);
});
