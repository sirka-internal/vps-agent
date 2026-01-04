const logger = require('../utils/logger');
const { getRuntime } = require('../utils/runtime-detector');
const dockerDeployer = require('../deployers/docker');
const systemDeployer = require('../deployers/system');

/**
 * Get agent status and deployed sites
 */
async function getStatus(req, res) {
  try {
    const runtime = getRuntime();
    let sites = [];

    if (runtime === 'docker') {
      sites = await dockerDeployer.listSites();
    } else if (runtime === 'system') {
      sites = await systemDeployer.listSites();
    }

    res.json({
      status: 'ok',
      runtime,
      platform: process.env.PLATFORM_URL,
      uptime: process.uptime(),
      sites: sites.length,
      deployedSites: sites
    });
  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({
      error: 'Status check failed',
      message: error.message
    });
  }
}

module.exports = { getStatus };

