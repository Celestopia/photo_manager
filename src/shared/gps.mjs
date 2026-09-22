export function validGps(gps) {
  if (gps?.latitude === null || gps?.latitude === undefined || gps?.latitude === "") return null;
  if (gps?.longitude === null || gps?.longitude === undefined || gps?.longitude === "") return null;
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}


export function dmsToDecimal(value, reference) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const degrees = Number(value[0]);
  const minutes = Number(value[1]);
  const seconds = Number(value[2]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  const sign = /^(S|W)$/i.test(String(reference || "")) ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}


export function gpsFromStoredMetadata(gps) {
  const latitude = dmsToDecimal(gps?.Latitude, gps?.LatitudeRef);
  const longitude = dmsToDecimal(gps?.Longitude, gps?.LongitudeRef);
  return validGps({ latitude, longitude });
}


function gpsNumber(value) {
  if (Array.isArray(value) && value.length === 2) {
    const [numerator, denominator] = value;
    return typeof numerator === "number" && typeof denominator === "number" && denominator !== 0 ? numerator / denominator : NaN;
  }
  if (value && typeof value === "object") return gpsNumber([value.numerator, value.denominator]);
  return typeof value === "number" ? value : NaN;
}

// Map display is stricter than the existing capture-time inference rules.
export function mapCoordinates(gps) {
  if (!/^[NS]$/i.test(gps?.LatitudeRef || "") || !/^[EW]$/i.test(gps?.LongitudeRef || "")) return null;
  const normalized = { ...gps, Latitude: gps.Latitude?.map?.(gpsNumber), Longitude: gps.Longitude?.map?.(gpsNumber) };
  for (const value of [normalized.Latitude, normalized.Longitude]) {
    if (!Array.isArray(value) || value.length !== 3 || value.some(v => v === null || v === "" || !Number.isFinite(Number(v)))) return null;
    if (Number(value[1]) < 0 || Number(value[1]) >= 60 || Number(value[2]) < 0 || Number(value[2]) >= 60) return null;
  }
  return gpsFromStoredMetadata(normalized);
}
export const MAP_LATITUDE_LIMIT = 85.0511287798;
