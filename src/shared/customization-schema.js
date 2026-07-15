const {
  assertOptionalUuidV4,
  assertUuidArray,
} = require("./identity-schema.js");

const PRIVACY_MIN = 1;
const PRIVACY_MAX = 5;

function isValidPrivacy(value) {
  return Number.isInteger(value) && value >= PRIVACY_MIN && value <= PRIVACY_MAX;
}

function assertPrivacy(value, context = "Privacy") {
  if (!isValidPrivacy(value)) {
    throw new Error(`${context} must be an integer from ${PRIVACY_MIN} to ${PRIVACY_MAX}`);
  }
  return value;
}

function assertCustomization(customization, filePath = "metadata record") {
  if (!customization || typeof customization !== "object" || Array.isArray(customization)) {
    throw new Error(`Customization must be an object for ${filePath}`);
  }
  for (const field of ["AlbumId", "TagIds", "PersonIds"]) {
    if (!Object.prototype.hasOwnProperty.call(customization, field)) {
      throw new Error(`Customization.${field} is required for ${filePath}`);
    }
  }
  assertPrivacy(customization.Privacy, `Privacy for ${filePath}`);
  const albumId = assertOptionalUuidV4(customization.AlbumId, `AlbumId for ${filePath}`);
  if (customization.AlbumId !== albumId) throw new Error(`AlbumId for ${filePath} must be null or a lowercase UUID v4`);
  assertUuidArray(customization.TagIds, `TagIds for ${filePath}`);
  assertUuidArray(customization.PersonIds, `PersonIds for ${filePath}`);
  return customization;
}

module.exports = {
  PRIVACY_MIN,
  PRIVACY_MAX,
  isValidPrivacy,
  assertPrivacy,
  assertCustomization,
};
