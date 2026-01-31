const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const axios = require('axios');
const logger = require('../utils/logger');

const DEPLOY_PATH = process.env.DEPLOY_PATH || '/var/www/sites';
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || 'sirka-network';

/**
 * Docker-based deployment
 * Creates Nginx container for each site
 */
class DockerDeployer {
  async deploy({ siteId, siteName, artifactUrl, zipData, domain }) {
    const sitePath = path.join(DEPLOY_PATH, siteId);
    const tempZipPath = path.join('/tmp', `${siteId}-${Date.now()}.zip`);

    try {
      // Download or use provided ZIP
      let zipBuffer;
      if (zipData) {
        zipBuffer = Buffer.from(zipData, 'base64');
      } else if (artifactUrl) {
        logger.info(`Downloading artifact from: ${artifactUrl}`);
        const response = await axios.get(artifactUrl, {
          responseType: 'arraybuffer',
          timeout: 300000 // 5 minutes
        });
        zipBuffer = Buffer.from(response.data);
      } else {
        throw new Error('No artifact source provided');
      }

      // Save ZIP temporarily
      await fs.writeFile(tempZipPath, zipBuffer);

      // Full replace: remove entire site directory so no old files/styles remain
      try {
        await fs.rm(sitePath, { recursive: true, force: true });
        logger.info(`Removed existing site directory: ${sitePath}`);
      } catch (e) {}

      await fs.mkdir(sitePath, { recursive: true });
      const extractPath = path.join(sitePath, 'new');
      await fs.mkdir(extractPath, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(extractPath, true);
      logger.info(`Extracted files to: ${extractPath}`);

      const currentPath = path.join(sitePath, 'current');
      await fs.rename(extractPath, currentPath);

      // Cleanup temp ZIP
      await fs.unlink(tempZipPath);

      // Ensure Docker network exists
      try {
        execSync(`docker network inspect ${DOCKER_NETWORK}`, { stdio: 'ignore' });
      } catch (e) {
        execSync(`docker network create ${DOCKER_NETWORK}`, { stdio: 'inherit' });
      }

      // Create or update Nginx container
      const containerName = `sirka-${siteId}`;
      const nginxConfig = this.generateNginxConfig(siteId, siteName, domain, currentPath);

      // Save Nginx config
      const nginxConfigPath = path.join(sitePath, 'nginx.conf');
      await fs.writeFile(nginxConfigPath, nginxConfig);

      // Check if container exists
      try {
        execSync(`docker inspect ${containerName}`, { stdio: 'ignore' });
        // Container exists, restart it
        execSync(`docker restart ${containerName}`, { stdio: 'inherit' });
      } catch (e) {
        // Container doesn't exist, create it
        const dockerCmd = [
          'docker run -d',
          `--name ${containerName}`,
          `--network ${DOCKER_NETWORK}`,
          '-p 80',
          `-v ${currentPath}:/usr/share/nginx/html:ro`,
          `-v ${nginxConfigPath}:/etc/nginx/conf.d/default.conf:ro`,
          'nginx:alpine'
        ].join(' ');

        execSync(dockerCmd, { stdio: 'inherit' });
      }

      // Only return domain if explicitly provided, otherwise return null
      // The site will be accessible via server IP at the deployed path
      const finalDomain = domain || null;

      if (finalDomain) {
        logger.info(`Site deployed: ${siteName} at ${finalDomain}`);
      } else {
        logger.info(`Site deployed: ${siteName} (accessible via server IP)`);
      }

      return {
        domain: finalDomain,
        path: currentPath,
        containerName
      };
    } catch (error) {
      // Cleanup on error
      try {
        await fs.unlink(tempZipPath);
      } catch (e) {}
      throw error;
    }
  }

  async restart(siteId) {
    const containerName = `sirka-${siteId}`;
    try {
      execSync(`docker restart ${containerName}`, { stdio: 'inherit' });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  }

  async listSites() {
    try {
      const output = execSync('docker ps --filter "name=sirka-" --format "{{.Names}}"', {
        encoding: 'utf-8'
      });
      return output.trim().split('\n').filter(Boolean).map(name => ({
        siteId: name.replace('sirka-', ''),
        containerName: name
      }));
    } catch (error) {
      logger.error('Failed to list Docker sites:', error);
      return [];
    }
  }

  generateNginxConfig(siteId, siteName, domain, sitePath) {
    // Use domain if provided, otherwise use _ (catch-all) to serve via IP
    const serverName = domain || '_';
    
    return `
server {
    listen 80;
    server_name ${serverName};

    root /usr/share/nginx/html;
    index index.html;

    # Multi-page: /checkout-page -> checkout-page.html
    location / {
        try_files $uri $uri/ $uri.html /index.html;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
}
`;
  }
}

module.exports = new DockerDeployer();

