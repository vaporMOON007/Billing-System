// Shared validation regexes — single source of truth for the backend
// Import these wherever GSTIN/PAN validation is needed

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX   = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

module.exports = { GSTIN_REGEX, PAN_REGEX };
