const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const AUDIT_LOG_PATH = path.join(__dirname, '../../logs/audit.log');

/**
 * Log audit events
 */
async function log(event) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...event
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    // Ensure logs directory exists
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    
    // Append to audit log
    await fs.appendFile(AUDIT_LOG_PATH, logLine);

    // Also log to main logger
    logger.info('Audit log:', logEntry);
  } catch (error) {
    logger.error('Failed to write audit log:', error);
  }
}

/**
 * Read audit log entries
 */
async function read(limit = 100) {
  try {
    const content = await fs.readFile(AUDIT_LOG_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines
      .slice(-limit)
      .map(line => JSON.parse(line));
    return entries.reverse(); // Most recent first
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

module.exports = {
  log,
  read
};

