const logger = require('../utils/logger');
const { verifyToken } = require('../utils/token-verifier');

/**
 * Authentication middleware
 * Validates X-Agent-Token header against platform
 */
async function authMiddleware(req, res, next) {
  const token = req.headers['x-agent-token'];

  if (!token) {
    logger.warn('Unauthorized request: missing token', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Missing X-Agent-Token header' });
  }

  try {
    const isValid = await verifyToken(token);
    
    if (!isValid) {
      logger.warn('Unauthorized request: invalid token', { ip: req.ip, path: req.path });
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Token is valid, proceed
    next();
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
}

module.exports = authMiddleware;

