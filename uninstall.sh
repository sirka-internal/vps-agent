#!/bin/bash

# Sirka VPS Agent Uninstallation Script

set -e

echo "🗑️  Uninstalling Sirka VPS Agent..."
echo ""
echo "⚠️  WARNING: This will remove the agent service and installation files."
echo "   Deployed sites will NOT be removed."
echo ""

INSTALL_DIR="/opt/sirka-agent"
SERVICE_NAME="sirka-agent"

# Check if stdin is a TTY (interactive mode)
if [ -t 0 ]; then
    INTERACTIVE=true
else
    INTERACTIVE=false
    echo "ℹ️  Running in non-interactive mode (via pipe)"
fi

# Check if service exists
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    echo "🛑 Stopping and disabling service..."
    sudo systemctl stop ${SERVICE_NAME} || true
    sudo systemctl disable ${SERVICE_NAME} || true
    echo "✅ Service stopped and disabled"
else
    echo "ℹ️  Service not found (may already be removed)"
fi

# Remove systemd service file
if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    echo "🗑️  Removing systemd service file..."
    sudo rm -f /etc/systemd/system/${SERVICE_NAME}.service
    sudo systemctl daemon-reload
    echo "✅ Service file removed"
else
    echo "ℹ️  Service file not found"
fi

# Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    echo ""
    echo "🗑️  Removing installation directory: $INSTALL_DIR"
    
    if [ "$INTERACTIVE" = true ]; then
        read -p "Delete installation directory? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            CONFIRM_DELETE=true
        else
            CONFIRM_DELETE=false
        fi
    else
        # Non-interactive: automatically delete (user explicitly ran uninstall script)
        CONFIRM_DELETE=true
        echo "   Auto-confirming deletion (non-interactive mode)"
    fi
    
    if [ "$CONFIRM_DELETE" = true ]; then
        sudo rm -rf "$INSTALL_DIR"
        echo "✅ Installation directory removed"
    else
        echo "⚠️  Installation directory kept: $INSTALL_DIR"
    fi
else
    echo "ℹ️  Installation directory not found: $INSTALL_DIR"
fi

# Check for Docker containers (if docker runtime was used)
if command -v docker &> /dev/null; then
    echo ""
    echo "ℹ️  Checking for Docker containers created by the agent..."
    CONTAINERS=$(docker ps -a --filter "name=sirka-" --format "{{.Names}}" 2>/dev/null || true)
    if [ -n "$CONTAINERS" ]; then
        echo "Found containers: $CONTAINERS"
        
        if [ "$INTERACTIVE" = true ]; then
            read -p "Do you want to remove these containers? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                REMOVE_CONTAINERS=true
            else
                REMOVE_CONTAINERS=false
            fi
        else
            # Non-interactive: keep containers (safer)
            REMOVE_CONTAINERS=false
            echo "   Containers kept in non-interactive mode (remove manually if needed)"
        fi
        
        if [ "$REMOVE_CONTAINERS" = true ]; then
            echo "$CONTAINERS" | xargs -r docker rm -f 2>/dev/null || true
            echo "✅ Docker containers removed"
        else
            echo "ℹ️  Docker containers kept"
        fi
    fi
fi

# Inform about deployed sites (but don't remove them)
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/sites}"
if [ -d "$DEPLOY_PATH" ] && [ "$(ls -A $DEPLOY_PATH 2>/dev/null)" ]; then
    echo ""
    echo "ℹ️  Deployed sites are located in: $DEPLOY_PATH"
    echo "   These sites are NOT removed by this script."
    echo "   If you want to remove them, do it manually:"
    echo "   sudo rm -rf $DEPLOY_PATH/*"
    echo "   (Be careful - make sure you have backups!)"
fi

echo ""
echo "✅ Uninstallation complete!"
echo ""
echo "📝 Summary:"
echo "   ✓ Agent service stopped and removed"
if [ -d "$INSTALL_DIR" ]; then
    echo "   ⚠️  Installation directory: $INSTALL_DIR (still exists)"
else
    echo "   ✓ Installation directory removed"
fi
echo "   ✓ Deployed sites preserved in: ${DEPLOY_PATH:-/var/www/sites}"
echo ""
echo "⚠️  Important:"
echo "   - Deployed sites were NOT removed (they may still be served)"
echo "   - If you want to remove deployed sites, do it manually"
echo "   - Remove the agent entry from your User Cabinet on the platform"
echo "   - If you used Nginx, you may need to remove Nginx configs manually"
