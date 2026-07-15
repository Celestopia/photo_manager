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
  assertPrivacy(customization.Privacy, `Privacy for ${filePath}`);
  return customization;
}

module.exports = {
  PRIVACY_MIN,
  PRIVACY_MAX,
  isValidPrivacy,
  assertPrivacy,
  assertCustomization,
};
