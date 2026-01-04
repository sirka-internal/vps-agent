const logger = require('../utils/logger');
const { getRuntime } = require('../utils/runtime-detector');
const dockerDeployer = require('../deployers/docker');
const systemDeployer = require('../deployers/system');
const auditLog = require('../utils/audit-log');

/**
 * Deploy static site
 * Supports ZIP file or artifact URL
 */
async function deploy(req, res) {
  const { siteId, siteName, artifactUrl, zipData, domain } = req.body;

  if (!siteId || !siteName) {
    return res.status(400).json({ error: 'siteId and siteName are required' });
  }

  if (!artifactUrl && !zipData) {
    return res.status(400).json({ error: 'Either artifactUrl or zipData is required' });
  }

  try {
    logger.info(`Deploying site: ${siteName} (${siteId})`);

    const runtime = getRuntime();
    let result;

    if (runtime === 'docker') {
      result = await dockerDeployer.deploy({
        siteId,
        siteName,
        artifactUrl,
        zipData,
        domain
      });
    } else if (runtime === 'system') {
      result = await systemDeployer.deploy({
        siteId,
        siteName,
        artifactUrl,
        zipData,
        domain
      });
    } else {
      throw new Error(`Unsupported runtime: ${runtime}`);
    }

    // Log to audit
    await auditLog.log({
      action: 'deploy',
      siteId,
      siteName,
      status: 'success',
      runtime,
      domain: result.domain || domain
    });

    res.json({
      success: true,
      message: 'Deployment successful',
      domain: result.domain,
      path: result.path,
      runtime
    });
  } catch (error) {
    logger.error('Deployment failed:', error);

    // Log to audit
    await auditLog.log({
      action: 'deploy',
      siteId,
      siteName,
      status: 'failed',
      error: error.message
    });

    res.status(500).json({
      error: 'Deployment failed',
      message: error.message
    });
  }
}

module.exports = { deploy };

