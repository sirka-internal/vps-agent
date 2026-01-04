const { execSync } = require('child_process');
const logger = require('./logger');

/**
 * Detect available runtime (Docker or System)
 * Returns null if no runtime is available (lazy detection for deployment time)
 */
async function detectRuntime() {
  const forcedRuntime = process.env.RUNTIME;

  if (forcedRuntime && ['docker', 'system'].includes(forcedRuntime)) {
    logger.info(`Using forced runtime: ${forcedRuntime}`);
    // Verify the forced runtime is actually available
    if (forcedRuntime === 'docker') {
      try {
        execSync('docker --version', { stdio: 'ignore' });
        execSync('docker ps', { stdio: 'ignore' });
        return forcedRuntime;
      } catch (error) {
        logger.warn('Forced docker runtime specified but Docker is not available');
        return null;
      }
    } else if (forcedRuntime === 'system') {
      try {
        execSync('nginx -v', { stdio: 'ignore' });
        return forcedRuntime;
      } catch (error) {
        logger.warn('Forced system runtime specified but Nginx is not available');
        return null;
      }
    }
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
        // No runtime available - return null instead of throwing
        // Runtime will be detected at deployment time
        logger.warn('Neither Docker nor Nginx found. Runtime will be detected at deployment time.');
        return null;
      }
    }
  }

  throw new Error(`Invalid RUNTIME value: ${forcedRuntime}`);
}

/**
 * Get current runtime
 * If runtime is not set, tries to detect it (for deployment time)
 */
function getRuntime() {
  const runtime = process.env.DETECTED_RUNTIME || process.env.RUNTIME;
  
  if (runtime && ['docker', 'system'].includes(runtime)) {
    return runtime;
  }
  
  // Try to detect runtime on-the-fly if not already detected
  if (!runtime || runtime === 'auto') {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      execSync('docker ps', { stdio: 'ignore' });
      process.env.DETECTED_RUNTIME = 'docker';
      return 'docker';
    } catch (error) {
      try {
        execSync('nginx -v', { stdio: 'ignore' });
        process.env.DETECTED_RUNTIME = 'system';
        return 'system';
      } catch (error) {
        throw new Error('No suitable runtime detected. Please install Docker or Nginx.');
      }
    }
  }
  
  throw new Error(`Invalid or unavailable runtime: ${runtime}`);
}

module.exports = {
  detectRuntime,
  getRuntime
};

