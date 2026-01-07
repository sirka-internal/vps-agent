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

      // Log what was extracted
      try {
        const extractedFiles = await fs.readdir(extractPath);
        logger.info(`Extracted files/folders: ${extractedFiles.slice(0, 20).join(', ')}${extractedFiles.length > 20 ? '...' : ''}`);
      } catch (e) {
        logger.warn(`Could not list extracted files: ${e.message}`);
      }

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
      logger.info(`Moved extracted files to: ${currentPath}`);

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
          logger.info(`Optimized subfolder not found, using currentPath: ${nginxRootPath}`);
        }
      } catch (e) {
        // optimized folder doesn't exist, use currentPath
        nginxRootPath = currentPath;
        logger.info(`Optimized subfolder check failed (${e.message}), using currentPath: ${nginxRootPath}`);
      }
      
      // Log final nginxRootPath
      logger.info(`Final Nginx root path will be: ${nginxRootPath}`);

      // Set proper permissions for Nginx to read files
      // Nginx typically runs as www-data user (or nginx on some systems)
      logger.info(`Setting permissions for: ${sitePath}`);
      try {
        // First, ensure parent directories are accessible (chmod +x for traversal)
        // All parent directories need execute permission for Nginx to traverse
        const setParentPerms = async (dirPath) => {
          try {
            try {
              execSync(`sudo chmod 755 ${dirPath}`, { stdio: 'pipe' });
            } catch (e) {
              execSync(`chmod 755 ${dirPath}`, { stdio: 'pipe' });
            }
          } catch (e) {
            // Ignore if can't set permissions
          }
        };
        
        // Set permissions for /var, /var/www, /var/www/sites, and sitePath
        await setParentPerms('/var');
        await setParentPerms('/var/www');
        await setParentPerms(DEPLOY_PATH);
        
        // Set directory permissions first: 755 (owner: read/write/execute, group/others: read/execute)
        try {
          execSync(`sudo find ${sitePath} -type d -exec chmod 755 {} \\;`, { stdio: 'pipe' });
        } catch (e) {
          execSync(`find ${sitePath} -type d -exec chmod 755 {} \\;`, { stdio: 'pipe' });
        }
        
        // Set file permissions: 644 (owner: read/write, group/others: read)
        try {
          execSync(`sudo find ${sitePath} -type f -exec chmod 644 {} \\;`, { stdio: 'pipe' });
        } catch (e) {
          execSync(`find ${sitePath} -type f -exec chmod 644 {} \\;`, { stdio: 'pipe' });
        }
        
        // Try to set owner to www-data (Nginx user on Ubuntu/Debian)
        // If www-data doesn't exist, try nginx user (used on some systems)
        let ownerSet = false;
        try {
          execSync(`sudo chown -R www-data:www-data ${sitePath}`, { stdio: 'pipe' });
          logger.info('Set owner to www-data:www-data (with sudo)');
          ownerSet = true;
        } catch (chownError) {
          try {
            execSync(`chown -R www-data:www-data ${sitePath}`, { stdio: 'pipe' });
            logger.info('Set owner to www-data:www-data (without sudo)');
            ownerSet = true;
          } catch (chownError2) {
            try {
              execSync(`sudo chown -R nginx:nginx ${sitePath}`, { stdio: 'pipe' });
              logger.info('Set owner to nginx:nginx (with sudo)');
              ownerSet = true;
            } catch (nginxError) {
              try {
                execSync(`chown -R nginx:nginx ${sitePath}`, { stdio: 'pipe' });
                logger.info('Set owner to nginx:nginx (without sudo)');
                ownerSet = true;
              } catch (nginxError2) {
                logger.warn('Could not change owner - permissions may need manual adjustment');
              }
            }
          }
        }
        
        if (!ownerSet) {
          logger.warn('Owner not set - you may need to manually run: sudo chown -R www-data:www-data ' + sitePath);
        }
        
        logger.info('File permissions set successfully');
      } catch (permError) {
        logger.error(`Failed to set permissions: ${permError.message}`);
        logger.warn('You may need to manually set permissions:');
        logger.warn(`  sudo chmod -R 755 ${sitePath}`);
        logger.warn(`  sudo find ${sitePath} -type f -exec chmod 644 {} \\;`);
        logger.warn(`  sudo chown -R www-data:www-data ${sitePath}`);
        // Don't fail deployment if permissions fail, but log warning
      }

      // Verify that files exist in nginxRootPath before creating config
      // Also detect HTML files to use as index files in Nginx config
      let htmlIndexFiles = ['index.html', 'index.htm']; // Default fallback
      try {
        const files = await fs.readdir(nginxRootPath);
        logger.info(`Files in nginx root (${nginxRootPath}): ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
        logger.info(`Total files/folders in nginx root: ${files.length}`);
        // Filter HTML files (only files, not directories)
        const htmlFiles = [];
        for (const file of files) {
          if (file.toLowerCase().endsWith('.html')) {
            try {
              const filePath = path.join(nginxRootPath, file);
              const stats = await fs.stat(filePath);
              if (stats.isFile()) {
                htmlFiles.push(file);
              }
            } catch (e) {
              // Ignore files we can't stat
            }
          }
        }
        
        if (htmlFiles.length === 0) {
          logger.warn(`No HTML files found in ${nginxRootPath}`);
          // Check if there are subdirectories that might contain HTML files
          const subdirs = [];
          for (const file of files.slice(0, 10)) {
            try {
              const filePath = path.join(nginxRootPath, file);
              const stats = await fs.stat(filePath);
              if (stats.isDirectory()) {
                subdirs.push(file);
              }
            } catch (e) {
              // Ignore
            }
          }
          if (subdirs.length > 0) {
            logger.info(`Found subdirectories: ${subdirs.join(', ')}`);
          }
        } else {
          logger.info(`Found HTML files: ${htmlFiles.join(', ')}`);
          // Build index file list: prioritize index.html, then index_modified.html, then other HTML files
          htmlIndexFiles = [];
          const indexHtml = htmlFiles.find(f => f.toLowerCase() === 'index.html');
          const indexModified = htmlFiles.find(f => f.toLowerCase() === 'index_modified.html');
          const otherHtml = htmlFiles.filter(f => 
            f.toLowerCase() !== 'index.html' && f.toLowerCase() !== 'index_modified.html'
          );
          
          if (indexHtml) htmlIndexFiles.push(indexHtml);
          if (indexModified) htmlIndexFiles.push(indexModified);
          // Add other HTML files
          htmlIndexFiles.push(...otherHtml);
          // Always add index.htm as fallback
          if (!htmlIndexFiles.includes('index.htm')) {
            htmlIndexFiles.push('index.htm');
          }
          
          logger.info(`Nginx index files will be: ${htmlIndexFiles.join(' ')}`);
        }
      } catch (dirError) {
        logger.error(`Cannot read directory ${nginxRootPath}: ${dirError.message}`);
        logger.error(`Directory path: ${nginxRootPath}`);
        logger.error(`Site path: ${sitePath}`);
        logger.error(`Current path: ${currentPath}`);
        throw new Error(`Cannot access deployment directory: ${dirError.message}`);
      }

      // Create Nginx config
      if (domain) {
        // If domain is provided, create separate config
        const nginxConfig = this.generateNginxConfig(siteId, siteName, domain, nginxRootPath, htmlIndexFiles);
        const nginxConfigFile = path.join(NGINX_CONFIG_PATH, `sirka-${siteId}`);
        await fs.writeFile(nginxConfigFile, nginxConfig);
        logger.info(`Created Nginx config: ${nginxConfigFile}`);

        // Create symlink in sites-enabled
        const symlinkPath = path.join(NGINX_SITES_ENABLED, `sirka-${siteId}`);
        try {
          await fs.unlink(symlinkPath);
        } catch (e) {}
        await fs.symlink(nginxConfigFile, symlinkPath);
        logger.info(`Created symlink: ${symlinkPath} -> ${nginxConfigFile}`);
      } else {
        // If no domain, update default config to serve this site
        // First, remove ALL conflicting default configs from sites-enabled
        try {
          const enabledFiles = await fs.readdir(NGINX_SITES_ENABLED);
          for (const file of enabledFiles) {
            if (file === 'default' || file.startsWith('sirka-')) {
              const filePath = path.join(NGINX_SITES_ENABLED, file);
              try {
                await fs.unlink(filePath);
                logger.info(`Removed conflicting config: ${filePath}`);
              } catch (e) {
                // Ignore if can't remove
              }
            }
          }
        } catch (e) {
          logger.warn(`Could not clean sites-enabled: ${e.message}`);
        }
        
        const nginxConfig = this.generateNginxConfig(siteId, siteName, null, nginxRootPath, htmlIndexFiles);
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
        logger.info(`Nginx root path: ${nginxRootPath}`);
        
        // Ensure default is enabled (create symlink in sites-enabled)
        const defaultSymlink = path.join(NGINX_SITES_ENABLED, 'default');
        try {
          // Always remove old symlink/file first
          try {
            await fs.unlink(defaultSymlink);
          } catch (e) {
            // Doesn't exist, that's ok
          }
          // Create new symlink
          await fs.symlink(defaultConfigFile, defaultSymlink);
          logger.info(`Created symlink: ${defaultSymlink} -> ${defaultConfigFile}`);
        } catch (symErr) {
          logger.error(`Failed to create symlink: ${symErr.message}`);
          throw new Error(`Failed to create default symlink: ${symErr.message}`);
        }
      }

      // Test Nginx config
      logger.info('Testing Nginx configuration...');
      try {
        try {
          execSync('nginx -t', { stdio: 'pipe' });
          logger.info('Nginx configuration test passed');
        } catch (e) {
          // Try with sudo if first attempt failed
          execSync('sudo nginx -t', { stdio: 'inherit' });
          logger.info('Nginx configuration test passed (with sudo)');
        }
      } catch (error) {
        logger.error('Nginx configuration test failed');
        throw new Error(`Nginx config test failed: ${error.message}`);
      }

      // Reload Nginx to apply changes
      logger.info('Reloading Nginx...');
      try {
        try {
          execSync('systemctl reload nginx', { stdio: 'pipe' });
          logger.info('Nginx reloaded successfully');
        } catch (e) {
          // Try with sudo if first attempt failed
          execSync('sudo systemctl reload nginx', { stdio: 'inherit' });
          logger.info('Nginx reloaded successfully (with sudo)');
        }
      } catch (error) {
        logger.error(`Failed to reload Nginx: ${error.message}`);
        // Try restart instead of reload if reload fails
        logger.info('Attempting Nginx restart instead...');
        try {
          try {
            execSync('systemctl restart nginx', { stdio: 'pipe' });
            logger.info('Nginx restarted successfully');
          } catch (e) {
            execSync('sudo systemctl restart nginx', { stdio: 'inherit' });
            logger.info('Nginx restarted successfully (with sudo)');
          }
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
      try {
        execSync('systemctl reload nginx', { stdio: 'pipe' });
        return { success: true };
      } catch (e) {
        // Try with sudo if first attempt failed
        execSync('sudo systemctl reload nginx', { stdio: 'inherit' });
        return { success: true };
      }
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

  generateNginxConfig(siteId, siteName, domain, sitePath, indexFiles = ['index.html', 'index.htm']) {
    // If domain is provided, use it; otherwise use default_server for catch-all
    const listenDirective = domain ? 'listen 80;' : 'listen 80 default_server;';
    const serverName = domain || '_';
    
    // Build index directive with detected HTML files
    const indexDirective = indexFiles.join(' ');
    // Use first index file for try_files fallback
    const tryFilesFallback = indexFiles[0] || 'index.html';
    
    return `
server {
    ${listenDirective}
    server_name ${serverName};

    root ${sitePath};
    index ${indexDirective};

    location / {
        try_files $uri $uri/ /${tryFilesFallback};
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

