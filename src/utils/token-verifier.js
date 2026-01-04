const logger = require('./logger');

/**
 * Verify agent token locally
 * Compares the provided token with AGENT_TOKEN from environment
 * No platform connection needed - agent listens and platform connects to it
 */
function verifyToken(token) {
  const agentToken = process.env.AGENT_TOKEN;
  
  if (!agentToken) {
    logger.error('AGENT_TOKEN not set in environment');
    return false;
  }
  
  if (!token) {
    logger.warn('Token not provided');
    return false;
  }
  
  // Simple string comparison
  // For production, consider using constant-time comparison (crypto.timingSafeEqual)
  const isValid = token === agentToken;
  
  if (!isValid) {
    logger.warn('Token mismatch - invalid token provided');
  } else {
    logger.debug('Token verified successfully');
  }
  
  return isValid;
}

module.exports = { verifyToken };
