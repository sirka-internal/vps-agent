const logger = require('../utils/logger');
const { verifyToken } = require('../utils/token-verifier');

/**
 * Authentication middleware
 * Validates X-Agent-Token header locally (no platform connection needed)
 */
function authMiddleware(req, res, next) {
  const token = req.headers['x-agent-token'];

  if (!token) {
    logger.warn('Unauthorized request: missing token', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Missing X-Agent-Token header' });
  }

  const isValid = verifyToken(token);
  
  if (!isValid) {
    logger.warn('Unauthorized request: invalid token', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'Invalid token' });
  }

  // Token is valid, proceed
  next();
}

module.exports = authMiddleware;

