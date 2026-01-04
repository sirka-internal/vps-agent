const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const axios = require('axios');
const logger = require('../utils/logger');

const DEPLOY_PATH = process.env.DEPLOY_PATH || '/var/www/sites';
const NGINX_CONFIG_PATH = process.env.NGINX_CONFIG_PATH || '/etc/nginx/sites-available';
const NGINX_SITES_ENABLED = process.env.NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled';

/**
 * System-based deployment (Nginx + filesystem)
 * Uses system Nginx with symlinks
 */
class SystemDeployer {
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

      // Extract ZIP
      const zip = new AdmZip(zipBuffer);
      const extractPath = path.join(sitePath, 'new');
      
      // Ensure directories exist
      await fs.mkdir(extractPath, { recursive: true });

      // Extract files
      zip.extractAllTo(extractPath, true);
      logger.info(`Extracted files to: ${extractPath}`);

      // Atomic swap: move new to current
      const currentPath = path.join(sitePath, 'current');
      const oldPath = path.join(sitePath, 'old');

      // Remove old backup if exists
      try {
        await fs.rm(oldPath, { recursive: true, force: true });
      } catch (e) {}

      // Move current to old (if exists)
      try {
        await fs.rename(currentPath, oldPath);
      } catch (e) {
        // Current doesn't exist yet, that's ok
      }

      // Move new to current (atomic)
      await fs.rename(extractPath, currentPath);

      // Remove old backup
      try {
        await fs.rm(oldPath, { recursive: true, force: true });
      } catch (e) {}

      // Cleanup temp ZIP
      await fs.unlink(tempZipPath);

      // Create Nginx config
      const nginxConfig = this.generateNginxConfig(siteId, siteName, domain, currentPath);
      const nginxConfigFile = path.join(NGINX_CONFIG_PATH, `sirka-${siteId}`);
      await fs.writeFile(nginxConfigFile, nginxConfig);

      // Create symlink in sites-enabled
      const symlinkPath = path.join(NGINX_SITES_ENABLED, `sirka-${siteId}`);
      try {
        await fs.unlink(symlinkPath);
      } catch (e) {}
      await fs.symlink(nginxConfigFile, symlinkPath);

      // Test Nginx config
      try {
        execSync('nginx -t', { stdio: 'inherit' });
      } catch (error) {
        throw new Error(`Nginx config test failed: ${error.message}`);
      }

      // Reload Nginx
      execSync('systemctl reload nginx', { stdio: 'inherit' });

      const finalDomain = domain || `${siteId}.your-domain.com`;

      logger.info(`Site deployed: ${siteName} at ${finalDomain}`);

      return {
        domain: finalDomain,
        path: currentPath
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
    try {
      // Reload Nginx to apply changes
      execSync('systemctl reload nginx', { stdio: 'inherit' });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to restart Nginx: ${error.message}`);
    }
  }

  async listSites() {
    try {
      const files = await fs.readdir(NGINX_SITES_ENABLED);
      return files
        .filter(f => f.startsWith('sirka-'))
        .map(f => ({
          siteId: f.replace('sirka-', ''),
          configFile: f
        }));
    } catch (error) {
      logger.error('Failed to list system sites:', error);
      return [];
    }
  }

  generateNginxConfig(siteId, siteName, domain, sitePath) {
    const serverName = domain || `${siteId}.your-domain.com`;
    
    return `
server {
    listen 80;
    server_name ${serverName};

    root ${sitePath};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
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

module.exports = new SystemDeployer();

