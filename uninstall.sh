#!/bin/bash

# Sirka VPS Agent Uninstallation Script

set -e

echo "🗑️  Uninstalling Sirka VPS Agent..."

INSTALL_DIR="/opt/sirka-agent"
SERVICE_NAME="sirka-agent"

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
    echo "🗑️  Removing installation directory: $INSTALL_DIR"
    read -p "Are you sure you want to delete $INSTALL_DIR? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo rm -rf "$INSTALL_DIR"
        echo "✅ Installation directory removed"
    else
        echo "⚠️  Installation directory kept: $INSTALL_DIR"
    fi
else
    echo "ℹ️  Installation directory not found: $INSTALL_DIR"
fi

# Check for deployed sites (optional cleanup)
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/sites}"
if [ -d "$DEPLOY_PATH" ]; then
    echo ""
    echo "ℹ️  Deployed sites may still exist in: $DEPLOY_PATH"
    read -p "Do you want to remove deployed sites? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  Removing deployed sites..."
        sudo rm -rf "$DEPLOY_PATH"/* 2>/dev/null || true
        echo "✅ Deployed sites removed"
    else
        echo "ℹ️  Deployed sites kept in: $DEPLOY_PATH"
    fi
fi

# Check for Docker containers (if docker runtime was used)
if command -v docker &> /dev/null; then
    echo ""
    echo "ℹ️  Docker is installed. Checking for agent-related containers..."
    CONTAINERS=$(docker ps -a --filter "name=sirka-" --format "{{.Names}}" 2>/dev/null || true)
    if [ -n "$CONTAINERS" ]; then
        echo "Found containers: $CONTAINERS"
        read -p "Do you want to remove these containers? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "$CONTAINERS" | xargs -r docker rm -f 2>/dev/null || true
            echo "✅ Docker containers removed"
        fi
    fi
fi

echo ""
echo "✅ Uninstallation complete!"
echo ""
echo "📝 Note:"
echo "   - Agent service has been stopped and removed"
echo "   - Installation directory: $INSTALL_DIR"
echo "   - If you want to remove deployed sites, check: $DEPLOY_PATH"
echo "   - Agent entry in platform database should be removed manually from User Cabinet"

