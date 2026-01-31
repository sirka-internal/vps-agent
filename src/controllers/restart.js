const logger = require('../utils/logger');
const { getRuntime } = require('../utils/runtime-detector');
const dockerDeployer = require('../deployers/docker');
const systemDeployer = require('../deployers/system');
const auditLog = require('../utils/audit-log');

/**
 * Restart deployed site
 */
async function restart(req, res) {
  const { siteId } = req.body;

  if (!siteId) {
    return res.status(400).json({ error: 'siteId is required' });
  }

  try {
    logger.info(`Restarting site: ${siteId}`);

    const runtime = getRuntime();
    let result;

    if (runtime === 'docker') {
      result = await dockerDeployer.restart(siteId);
    } else if (runtime === 'system') {
      result = await systemDeployer.restart(siteId);
    } else {
      throw new Error(`Unsupported runtime: ${runtime}`);
    }

    // Log to audit
    await auditLog.log({
      action: 'restart',
      siteId,
      status: 'success',
      runtime
    });

    res.json({
      success: true,
      message: 'Site restarted successfully',
      siteId
    });
  } catch (error) {
    logger.error('Restart failed:', error);

    // Log to audit
    await auditLog.log({
      action: 'restart',
      siteId,
      status: 'failed',
      error: error.message
    });

    res.status(500).json({
      error: 'Restart failed',
      message: error.message
    });
  }
}

module.exports = { restart };

