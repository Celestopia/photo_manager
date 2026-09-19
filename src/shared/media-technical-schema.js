const { assertExactObjectKeys } = require("./object-schema");

function object(value, fields, context) {
  assertExactObjectKeys(value, fields, context);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${context}.${field} is required`);
  }
}
function number(value, context, { nullable = false, minimum = -Infinity, integer = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    throw new Error(`${context} must be a finite${integer ? " integer" : " number"}${nullable ? " or null" : ""}`);
  }
}
function text(value, context, nullable = false) {
  if (typeof value !== "string" && !(nullable && value === null)) throw new Error(`${context} must be a string${nullable ? " or null" : ""}`);
}
function assertSha256Hash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("SHA256Hash must be a lowercase SHA-256 fingerprint");
  return value;
}

/** Technical structures are checked at disk boundaries; EXIF parser values are preserved. */
function assertMediaTechnicalFields(item) {
  const context = `Metadata ${item?.FilePath || "record"}`;
  const type = item?.FileSystem?.FileType;
  if (!["image", "video"].includes(type)) throw new Error(`${context}.FileSystem.FileType must be image or video`);
  object(item, ["MediaId", "FilePath", "SHA256Hash", "FileSystem", "GPS", "Location", "Camera", "Customization", type === "image" ? "Picture" : "Video"], context);
  assertSha256Hash(item.SHA256Hash);
  const file = item.FileSystem;
  const timeFields = ["ShootingTime", "CreationTime", "ModificationTime"];
  object(file, ["FileType", "FileExtension", "FileSize", ...timeFields.flatMap(key => [key + "String", key + "Zone", key + "Stamp"]), "ModificationTimeMs"], `${context}.FileSystem`);
  if (typeof file.FileExtension !== "string" || !/^[a-z0-9]+$/.test(file.FileExtension)) throw new Error(`${context}.FileExtension must be a lowercase extension without a dot`);
  number(file.FileSize, `${context}.FileSize`, { minimum: 0, integer: true });
  number(file.ModificationTimeMs, `${context}.ModificationTimeMs`);
  for (const key of timeFields) {
    text(file[key + "String"], `${context}.${key}String`, true);
    number(file[key + "Zone"], `${context}.${key}Zone`, { nullable: true });
    number(file[key + "Stamp"], `${context}.${key}Stamp`, { nullable: true });
  }
  object(item.GPS, ["LatitudeRef", "Latitude", "LongitudeRef", "Longitude", "AltitudeRef", "Altitude"], `${context}.GPS`);
  // AltitudeRef and camera EXIF values deliberately retain their parser-provided shapes.
  object(item.Camera, ["Make", "Model", "FocalLength", "Aperture", "ISO", "ExposureTime", "FlashUsed"], `${context}.Camera`);
  if (![null, true, false].includes(item.Camera.FlashUsed)) throw new Error(`${context}.Camera.FlashUsed must be boolean or null`);
  if (type === "image") {
    const picture = item.Picture;
    object(picture, ["ProbeStatus", "ProbeError", "Width", "Height", "Dpi", "BitDepth"], `${context}.Picture`);
    if (!["ok", "failed"].includes(picture.ProbeStatus)) throw new Error(`${context}.Picture.ProbeStatus is invalid`);
    text(picture.ProbeError, `${context}.Picture.ProbeError`, true);
    for (const key of ["Width", "Height", "BitDepth"]) number(picture[key], `${context}.Picture.${key}`, { nullable: true, minimum: 1, integer: true });
    number(picture.Dpi, `${context}.Picture.Dpi`, { nullable: true, minimum: Number.MIN_VALUE });
  } else {
    const video = item.Video;
    const numeric = ["DurationSeconds", "Width", "Height", "DisplayWidth", "DisplayHeight", "RotationDegrees", "FrameRate", "BitDepth", "BitRate", "AudioChannels", "AudioSampleRate", "AudioBitRate"];
    const strings = ["ProbeError", "SampleAspectRatio", "FrameRateRatio", "VideoCodec", "VideoProfile", "PixelFormat", "ContainerFormat", "AudioCodec", "ColorSpace", "ColorTransfer", "ColorPrimaries"];
    object(video, ["ProbeStatus", ...numeric, ...strings, "VideoStreamCount", "AudioStreamCount", "HasAudio"], `${context}.Video`);
    if (!["ok", "failed", "audio-only"].includes(video.ProbeStatus)) throw new Error(`${context}.Video.ProbeStatus is invalid`);
    for (const key of numeric) number(video[key], `${context}.Video.${key}`, { nullable: true });
    for (const key of strings) text(video[key], `${context}.Video.${key}`, true);
    for (const key of ["VideoStreamCount", "AudioStreamCount"]) number(video[key], `${context}.Video.${key}`, { minimum: 0, integer: true });
    if (typeof video.HasAudio !== "boolean") throw new Error(`${context}.Video.HasAudio must be boolean`);
  }
  return item;
}

module.exports = { assertMediaTechnicalFields, assertSha256Hash };
