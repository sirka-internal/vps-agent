const { execSync } = require('child_process');
const logger = require('./logger');

/**
 * Detect available runtime (Docker or System)
 */
async function detectRuntime() {
  const forcedRuntime = process.env.RUNTIME;

  if (forcedRuntime && ['docker', 'system'].includes(forcedRuntime)) {
    logger.info(`Using forced runtime: ${forcedRuntime}`);
    return forcedRuntime;
  }

  if (forcedRuntime === 'auto' || !forcedRuntime) {
    // Try to detect Docker first
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      logger.info('Docker detected, using docker runtime');
      return 'docker';
    } catch (error) {
      // Docker not available, check for Nginx
      try {
        execSync('nginx -v', { stdio: 'ignore' });
        logger.info('Nginx detected, using system runtime');
        return 'system';
      } catch (error) {
        logger.error('Neither Docker nor Nginx found. Please install one of them.');
        throw new Error('No suitable runtime detected');
      }
    }
  }

  throw new Error(`Invalid RUNTIME value: ${forcedRuntime}`);
}

/**
 * Get current runtime
 */
function getRuntime() {
  return process.env.DETECTED_RUNTIME || process.env.RUNTIME || 'auto';
}

module.exports = {
  detectRuntime,
  getRuntime
};

