const {
  assertOptionalUuidV4,
  assertUuidArray,
} = require("./identity-schema.js");
const { assertExactObjectKeys } = require("./object-schema.js");

const PRIVACY_MIN = 1;
const PRIVACY_MAX = 5;
const RATING_MIN = 1;
const RATING_MAX = 5;
const CUSTOMIZATION_FIELDS = Object.freeze([
  "Title",
  "AlbumId",
  "TagIds",
  "PersonIds",
  "Description",
  "HiddenDescription",
  "Rating",
  "Privacy",
  "MetadataUpdateDate",
]);
const EDITABLE_CUSTOMIZATION_FIELDS = Object.freeze(CUSTOMIZATION_FIELDS.filter((field) => field !== "MetadataUpdateDate"));

function isValidPrivacy(value) {
  return Number.isInteger(value) && value >= PRIVACY_MIN && value <= PRIVACY_MAX;
}

function assertPrivacy(value, context = "Privacy") {
  if (!isValidPrivacy(value)) {
    throw new Error(`${context} must be an integer from ${PRIVACY_MIN} to ${PRIVACY_MAX}`);
  }
  return value;
}

function assertRating(value, context = "Rating") {
  if (!Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) {
    throw new Error(`${context} must be an integer from ${RATING_MIN} to ${RATING_MAX}`);
  }
  return value;
}

function assertCustomizationField(field, value, context) {
  if (["Title", "Description", "HiddenDescription"].includes(field)) {
    if (typeof value !== "string") throw new Error(`${context}.${field} must be a string`);
    return value;
  }
  if (field === "Rating") return assertRating(value, `${context}.Rating`);
  if (field === "Privacy") return assertPrivacy(value, `${context}.Privacy`);
  if (field === "AlbumId") {
    const albumId = assertOptionalUuidV4(value, `${context}.AlbumId`);
    if (value !== albumId) throw new Error(`${context}.AlbumId must be null or a lowercase UUID v4`);
    return albumId;
  }
  if (field === "TagIds" || field === "PersonIds") return assertUuidArray(value, `${context}.${field}`);
  if (field === "MetadataUpdateDate") {
    if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value)) {
      throw new Error(`${context}.MetadataUpdateDate must be null or an ISO timestamp`);
    }
    return value;
  }
  throw new Error(`${context} contains unsupported field: ${field}`);
}

function assertCustomization(customization, filePath = "metadata record") {
  const context = `Customization for ${filePath}`;
  assertExactObjectKeys(customization, CUSTOMIZATION_FIELDS, context);
  for (const field of CUSTOMIZATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(customization, field)) {
      throw new Error(`Customization.${field} is required for ${filePath}`);
    }
    assertCustomizationField(field, customization[field], context);
  }
  return customization;
}

function assertCustomizationPatch(customization, allowedFields = EDITABLE_CUSTOMIZATION_FIELDS, context = "Customization patch") {
  assertExactObjectKeys(customization, allowedFields, context);
  for (const [field, value] of Object.entries(customization)) assertCustomizationField(field, value, context);
  return customization;
}

module.exports = {
  PRIVACY_MIN,
  PRIVACY_MAX,
  RATING_MIN,
  RATING_MAX,
  CUSTOMIZATION_FIELDS,
  EDITABLE_CUSTOMIZATION_FIELDS,
  isValidPrivacy,
  assertPrivacy,
  assertRating,
  assertCustomization,
  assertCustomizationPatch,
};
