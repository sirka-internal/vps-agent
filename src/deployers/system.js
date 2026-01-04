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

      // Determine the actual root path for Nginx
      // Check if optimized subfolder exists, if yes use it, otherwise use currentPath
      const optimizedSubPath = path.join(currentPath, 'optimized');
      let nginxRootPath;
      try {
        const stats = await fs.stat(optimizedSubPath);
        if (stats.isDirectory()) {
          nginxRootPath = optimizedSubPath;
          logger.info(`Using optimized subfolder: ${nginxRootPath}`);
        } else {
          nginxRootPath = currentPath;
        }
      } catch (e) {
        // optimized folder doesn't exist, use currentPath
        nginxRootPath = currentPath;
      }

      // Set proper permissions for Nginx to read files
      // Nginx typically runs as www-data user (or nginx on some systems)
      logger.info(`Setting permissions for: ${sitePath}`);
      try {
        // First, ensure parent directories are accessible (chmod +x for traversal)
        execSync(`chmod 755 ${DEPLOY_PATH}`, { stdio: 'pipe' });
        
        // Set file permissions: 644 (owner: read/write, group/others: read)
        execSync(`find ${sitePath} -type f -exec chmod 644 {} \\;`, { stdio: 'pipe' });
        // Set directory permissions: 755 (owner: read/write/execute, group/others: read/execute)
        execSync(`find ${sitePath} -type d -exec chmod 755 {} \\;`, { stdio: 'pipe' });
        
        // Try to set owner to www-data (Nginx user on Ubuntu/Debian)
        // If www-data doesn't exist, try nginx user (used on some systems)
        try {
          execSync(`chown -R www-data:www-data ${sitePath}`, { stdio: 'pipe' });
          logger.info('Set owner to www-data:www-data');
        } catch (chownError) {
          try {
            execSync(`chown -R nginx:nginx ${sitePath}`, { stdio: 'pipe' });
            logger.info('Set owner to nginx:nginx');
          } catch (nginxError) {
            logger.warn('Could not change owner (might need sudo), but permissions should still work');
          }
        }
        
        logger.info('File permissions set successfully');
      } catch (permError) {
        logger.warn(`Failed to set permissions: ${permError.message}`);
        // Don't fail deployment if permissions fail, but log warning
      }

      // Create Nginx config
      if (domain) {
        // If domain is provided, create separate config
        const nginxConfig = this.generateNginxConfig(siteId, siteName, domain, nginxRootPath);
        const nginxConfigFile = path.join(NGINX_CONFIG_PATH, `sirka-${siteId}`);
        await fs.writeFile(nginxConfigFile, nginxConfig);

        // Create symlink in sites-enabled
        const symlinkPath = path.join(NGINX_SITES_ENABLED, `sirka-${siteId}`);
        try {
          await fs.unlink(symlinkPath);
        } catch (e) {}
        await fs.symlink(nginxConfigFile, symlinkPath);
      } else {
        // If no domain, update default config to serve this site
        const nginxConfig = this.generateNginxConfig(siteId, siteName, null, nginxRootPath);
        const defaultConfigFile = path.join(NGINX_CONFIG_PATH, 'default');
        
        // Remove old default config file if it exists
        try {
          await fs.unlink(defaultConfigFile);
        } catch (e) {
          // File doesn't exist, that's ok
        }
        
        // Write new default config
        await fs.writeFile(defaultConfigFile, nginxConfig);
        logger.info(`Updated default Nginx config: ${defaultConfigFile}`);
        
        // Ensure default is enabled (create symlink in sites-enabled)
        const defaultSymlink = path.join(NGINX_SITES_ENABLED, 'default');
        try {
          const stats = await fs.lstat(defaultSymlink);
          if (!stats.isSymbolicLink()) {
            // Remove if it's not a symlink (it might be a regular file)
            await fs.unlink(defaultSymlink);
            await fs.symlink(defaultConfigFile, defaultSymlink);
            logger.info(`Created symlink: ${defaultSymlink} -> ${defaultConfigFile}`);
          } else {
            // Check if symlink points to correct file
            const realPath = await fs.readlink(defaultSymlink);
            const realPathResolved = path.resolve(path.dirname(defaultSymlink), realPath);
            const configPathResolved = path.resolve(defaultConfigFile);
            if (realPathResolved !== configPathResolved) {
              // Symlink points to wrong file, recreate it
              await fs.unlink(defaultSymlink);
              await fs.symlink(defaultConfigFile, defaultSymlink);
              logger.info(`Recreated symlink: ${defaultSymlink} -> ${defaultConfigFile}`);
            }
          }
        } catch (e) {
          // Symlink doesn't exist, create it
          try {
            await fs.symlink(defaultConfigFile, defaultSymlink);
            logger.info(`Created new symlink: ${defaultSymlink} -> ${defaultConfigFile}`);
          } catch (symErr) {
            logger.warn(`Failed to create symlink: ${symErr.message}`);
            throw new Error(`Failed to create default symlink: ${symErr.message}`);
          }
        }
      }

      // Test Nginx config
      logger.info('Testing Nginx configuration...');
      try {
        execSync('nginx -t', { stdio: 'inherit' });
        logger.info('Nginx configuration test passed');
      } catch (error) {
        logger.error('Nginx configuration test failed');
        throw new Error(`Nginx config test failed: ${error.message}`);
      }

      // Reload Nginx to apply changes
      logger.info('Reloading Nginx...');
      try {
        execSync('systemctl reload nginx', { stdio: 'inherit' });
        logger.info('Nginx reloaded successfully');
      } catch (error) {
        logger.error(`Failed to reload Nginx: ${error.message}`);
        // Try restart instead of reload if reload fails
        logger.info('Attempting Nginx restart instead...');
        try {
          execSync('systemctl restart nginx', { stdio: 'inherit' });
          logger.info('Nginx restarted successfully');
        } catch (restartError) {
          throw new Error(`Failed to reload/restart Nginx: ${restartError.message}`);
        }
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
    // If domain is provided, use it; otherwise use default_server for catch-all
    const listenDirective = domain ? 'listen 80;' : 'listen 80 default_server;';
    const serverName = domain || '_';
    
    return `
server {
    ${listenDirective}
    server_name ${serverName};

    root ${sitePath};
    index index.html index.htm;

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

