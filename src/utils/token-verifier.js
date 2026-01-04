const axios = require('axios');
const logger = require('./logger');

const PLATFORM_URL = process.env.PLATFORM_URL;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const tokenCache = new Map();

/**
 * Verify agent token with platform
 * Uses caching to reduce API calls
 */
async function verifyToken(token) {
  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.valid;
  }

  try {
    const response = await axios.post(
      `${PLATFORM_URL}/api/vps/verify-token`,
      { token },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const isValid = response.data.valid === true;

    // Cache result
    tokenCache.set(token, {
      valid: isValid,
      timestamp: Date.now()
    });

    return isValid;
  } catch (error) {
    logger.error('Token verification request failed:', error.message);
    
    // On network error, check if we have a cached valid result
    const cached = tokenCache.get(token);
    if (cached && cached.valid) {
      logger.warn('Using cached token validation due to network error');
      return true;
    }

    return false;
  }
}

/**
 * Clear token cache (useful for testing or token rotation)
 */
function clearCache() {
  tokenCache.clear();
}

module.exports = {
  verifyToken,
  clearCache
};

