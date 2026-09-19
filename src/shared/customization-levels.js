const PRIVACY_MIN = 1;
const PRIVACY_MAX = 5;
const RATING_MIN = 1;
const RATING_MAX = 5;
const RATING_LEVELS = Object.freeze(Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, index) => RATING_MIN + index));
const PRIVACY_LEVELS = Object.freeze(Array.from({ length: PRIVACY_MAX - PRIVACY_MIN + 1 }, (_, index) => PRIVACY_MIN + index));

module.exports = { PRIVACY_MIN, PRIVACY_MAX, RATING_MIN, RATING_MAX, RATING_LEVELS, PRIVACY_LEVELS };
