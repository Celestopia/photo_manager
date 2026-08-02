const { find: findTimeZones } = require("geo-tz");

const formatterCache = new Map();
const UTC_TIME_CONTEXT = Object.freeze({ kind: "offset", offsetMinutes: 0 });

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function formatComponents(components) {
  return `${pad(components.year, 4)}-${pad(components.month)}-${pad(components.day)} ${pad(components.hour)}:${pad(components.minute)}:${pad(components.second)}`;
}

function validComponents(components) {
  const values = [
    components.year,
    components.month,
    components.day,
    components.hour,
    components.minute,
    components.second,
  ];
  if (values.some((value) => !Number.isInteger(value))) return false;
  if (components.month < 1 || components.month > 12) return false;
  if (components.day < 1 || components.day > 31) return false;
  if (components.hour < 0 || components.hour > 23) return false;
  if (components.minute < 0 || components.minute > 59) return false;
  if (components.second < 0 || components.second > 59) return false;
  const check = new Date(Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second,
  ));
  return check.getUTCFullYear() === components.year
    && check.getUTCMonth() + 1 === components.month
    && check.getUTCDate() === components.day;
}

function parseOffsetMinutes(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^z$/i.test(raw)) return 0;
  const match = raw.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * Parse an ISO/QuickTime or EXIF timestamp without using the host timezone.
 * A floating timestamp keeps its wall-clock text and intentionally has no epoch.
 */
function parseMediaTimestamp(value, offsetValue = null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return null;
  const components = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
  if (!validComponents(components)) return null;

  const sourceZone = match[8] || offsetValue;
  const offsetMinutes = parseOffsetMinutes(sourceZone);
  const hasExplicitZone = sourceZone !== null && sourceZone !== undefined && String(sourceZone).trim() !== "";
  if (hasExplicitZone && offsetMinutes === null) return null;
  if (!hasExplicitZone) {
    return {
      text: formatComponents(components),
      zone: null,
      stamp: null,
      components,
      hasExplicitZone: false,
      isUtcDesignator: false,
    };
  }

  const fractionMilliseconds = Number(`0.${match[7] || "0"}`) * 1000;
  const instantMilliseconds = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second,
    Math.floor(fractionMilliseconds),
  ) - offsetMinutes * 60 * 1000;
  return {
    text: formatComponents(components),
    zone: offsetMinutes / 60,
    stamp: Math.floor(instantMilliseconds / 1000),
    components,
    hasExplicitZone: true,
    isUtcDesignator: /^z$/i.test(String(sourceZone).trim()),
  };
}

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }));
  }
  return formatterCache.get(timeZone);
}

function formatInstantInZone(stamp, timeZone) {
  const numericStamp = Number(stamp);
  if (!Number.isFinite(numericStamp)) return null;
  let parts;
  try {
    parts = getFormatter(timeZone).formatToParts(new Date(Math.trunc(numericStamp) * 1000));
  } catch {
    return null;
  }
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const components = {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
  };
  if (!validComponents(components)) return null;
  const localAsUtc = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second,
  );
  const wholeSecondStamp = Math.trunc(numericStamp);
  const offsetMinutes = Math.round((localAsUtc - wholeSecondStamp * 1000) / 60000);
  return {
    text: formatComponents(components),
    zone: offsetMinutes / 60,
    stamp: wholeSecondStamp,
  };
}

function formatInstantAtOffset(stamp, offsetMinutes) {
  const numericStamp = Number(stamp);
  const numericOffset = Number(offsetMinutes);
  if (!Number.isFinite(numericStamp) || !Number.isFinite(numericOffset)) return null;
  const wholeSecondStamp = Math.trunc(numericStamp);
  const shifted = new Date((wholeSecondStamp + numericOffset * 60) * 1000);
  const components = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
  return {
    text: formatComponents(components),
    zone: numericOffset / 60,
    stamp: wholeSecondStamp,
  };
}

function validGps(gps) {
  if (gps?.latitude === null || gps?.latitude === undefined || gps?.latitude === "") return null;
  if (gps?.longitude === null || gps?.longitude === undefined || gps?.longitude === "") return null;
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function zonesForGps(gps, lookup = findTimeZones) {
  const coordinates = validGps(gps);
  if (!coordinates) return [];
  try {
    return [...new Set(lookup(coordinates.latitude, coordinates.longitude))]
      .filter((zone) => typeof zone === "string" && zone.trim());
  } catch {
    return [];
  }
}

function uniqueResolution(resolutions) {
  const unique = new Map();
  for (const resolution of resolutions.filter(Boolean)) {
    unique.set(`${resolution.stamp}|${resolution.zone}|${resolution.text}`, resolution);
  }
  return unique.size === 1 ? unique.values().next().value : null;
}

function gpsTimeContext(gps, lookup = findTimeZones) {
  const zones = zonesForGps(gps, lookup);
  return zones.length ? { kind: "iana", timeZones: zones } : null;
}

function formatInstantWithContext(stamp, context = UTC_TIME_CONTEXT) {
  if (context?.kind === "iana") {
    const resolved = uniqueResolution(
      (context.timeZones || []).map((zone) => formatInstantInZone(stamp, zone)),
    );
    return resolved || formatInstantAtOffset(stamp, 0);
  }
  return formatInstantAtOffset(stamp, context?.offsetMinutes ?? 0);
}

function resolveInstantAtGps(stamp, gps, lookup = findTimeZones) {
  const context = gpsTimeContext(gps, lookup);
  if (!context) return null;
  const time = uniqueResolution(context.timeZones.map((zone) => formatInstantInZone(stamp, zone)));
  return time ? { time, context } : null;
}

function possibleInstantsForWallTime(parsed, timeZone) {
  const naiveMilliseconds = Date.UTC(
    parsed.components.year,
    parsed.components.month - 1,
    parsed.components.day,
    parsed.components.hour,
    parsed.components.minute,
    parsed.components.second,
  );
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sampleStamp = Math.floor((naiveMilliseconds + hours * 60 * 60 * 1000) / 1000);
    const sample = formatInstantInZone(sampleStamp, timeZone);
    if (sample) offsets.add(sample.zone * 60);
  }
  const matches = [];
  for (const offsetMinutes of offsets) {
    const stamp = Math.floor((naiveMilliseconds - offsetMinutes * 60 * 1000) / 1000);
    const formatted = formatInstantInZone(stamp, timeZone);
    if (formatted?.text === parsed.text) matches.push(formatted);
  }
  return matches;
}

function resolveWallTimeAtGps(parsed, gps, lookup = findTimeZones) {
  const context = gpsTimeContext(gps, lookup);
  if (!context) return null;
  const time = uniqueResolution(
    context.timeZones.flatMap((zone) => possibleInstantsForWallTime(parsed, zone)),
  );
  return time ? { time, context } : null;
}

function withTimeContext(time, context) {
  return time ? { ...time, context } : null;
}

/**
 * Resolve a shooting time according to source reliability. Explicit non-UTC
 * offsets are authoritative. UTC instants are localized through GPS when
 * possible; floating wall times are converted only when the instant is unique.
 */
function resolveMediaShootingTime({ candidates = [], gps = null, fallback = null, lookup = findTimeZones } = {}) {
  const parsedCandidates = candidates
    .map((candidate) => {
      const entry = typeof candidate === "object" && candidate !== null ? candidate : { value: candidate };
      const parsed = parseMediaTimestamp(entry.value, entry.offset);
      return parsed ? { ...entry, parsed } : null;
    })
    .filter(Boolean);

  const offsetCandidate = parsedCandidates.find(({ parsed }) => parsed.hasExplicitZone && parsed.zone !== 0);
  if (offsetCandidate) {
    return withTimeContext(offsetCandidate.parsed, {
      kind: "offset",
      offsetMinutes: offsetCandidate.parsed.zone * 60,
    });
  }

  const absoluteCandidate = parsedCandidates.find(({ parsed }) => parsed.hasExplicitZone);
  if (absoluteCandidate) {
    const gpsResolution = resolveInstantAtGps(absoluteCandidate.parsed.stamp, gps, lookup);
    return gpsResolution
      ? withTimeContext(gpsResolution.time, gpsResolution.context)
      : withTimeContext(absoluteCandidate.parsed, UTC_TIME_CONTEXT);
  }

  for (const { parsed } of parsedCandidates) {
    const resolved = resolveWallTimeAtGps(parsed, gps, lookup);
    if (resolved) return withTimeContext(resolved.time, resolved.context);
  }
  if (parsedCandidates[0]?.parsed) {
    return withTimeContext(
      parsedCandidates[0].parsed,
      gpsTimeContext(gps, lookup) || UTC_TIME_CONTEXT,
    );
  }
  if (fallback) {
    const gpsResolution = resolveInstantAtGps(fallback.stamp, gps, lookup);
    return gpsResolution
      ? withTimeContext(gpsResolution.time, gpsResolution.context)
      : withTimeContext(fallback, UTC_TIME_CONTEXT);
  }
  return null;
}

function dmsToDecimal(value, reference) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const degrees = Number(value[0]);
  const minutes = Number(value[1]);
  const seconds = Number(value[2]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  const sign = /^(S|W)$/i.test(String(reference || "")) ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

function gpsFromExif(exif) {
  const latitude = dmsToDecimal(exif?.GPSLatitude, exif?.GPSLatitudeRef);
  const longitude = dmsToDecimal(exif?.GPSLongitude, exif?.GPSLongitudeRef);
  return validGps({ latitude, longitude });
}

function gpsFromStoredMetadata(gps) {
  const latitude = dmsToDecimal(gps?.Latitude, gps?.LatitudeRef);
  const longitude = dmsToDecimal(gps?.Longitude, gps?.LongitudeRef);
  return validGps({ latitude, longitude });
}

function resolveStoredMediaTimeContext(item, lookup = findTimeZones) {
  const fileSystem = item?.FileSystem || {};
  const gpsContext = gpsTimeContext(gpsFromStoredMetadata(item?.GPS), lookup);
  const hasStamp = fileSystem.ShootingTimeStamp !== null
    && fileSystem.ShootingTimeStamp !== undefined
    && fileSystem.ShootingTimeStamp !== ""
    && Number.isFinite(Number(fileSystem.ShootingTimeStamp));
  const hasZone = fileSystem.ShootingTimeZone !== null
    && fileSystem.ShootingTimeZone !== undefined
    && fileSystem.ShootingTimeZone !== ""
    && Number.isFinite(Number(fileSystem.ShootingTimeZone));
  const stamp = hasStamp ? Number(fileSystem.ShootingTimeStamp) : null;
  const zone = hasZone ? Number(fileSystem.ShootingTimeZone) : null;
  if (gpsContext) {
    if (!hasStamp || !hasZone) return gpsContext;
    const gpsTime = formatInstantWithContext(stamp, gpsContext);
    if (gpsTime.text === fileSystem.ShootingTimeString && gpsTime.zone === zone) return gpsContext;
  }
  if (hasZone) return { kind: "offset", offsetMinutes: zone * 60 };
  return UTC_TIME_CONTEXT;
}

module.exports = {
  UTC_TIME_CONTEXT,
  parseMediaTimestamp,
  formatInstantInZone,
  formatInstantWithContext,
  resolveMediaShootingTime,
  resolveStoredMediaTimeContext,
  gpsFromExif,
};
