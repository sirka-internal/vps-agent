#!/bin/bash

# Sirka VPS Agent Installation Script

set -e

# Get token from first argument
AGENT_TOKEN="${1:-}"

echo "🚀 Installing Sirka VPS Agent..."

if [ -z "$AGENT_TOKEN" ]; then
    echo "⚠️  Warning: No token provided. You'll need to set AGENT_TOKEN in .env manually."
    echo "   Usage: curl ... | bash -s YOUR_TOKEN"
    echo ""
fi

# Function to install Node.js
install_nodejs() {
    echo "📦 Node.js not found. Installing Node.js 20+..."
    
    # Detect OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VER=$VERSION_ID
    else
        echo "❌ Cannot detect OS. Please install Node.js 20+ manually."
        exit 1
    fi
    
    # Install Node.js based on OS
    case $OS in
        ubuntu|debian)
            echo "📥 Installing Node.js 20.x on Ubuntu/Debian..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        centos|rhel|fedora|rocky|almalinux)
            echo "📥 Installing Node.js 20.x on CentOS/RHEL/Fedora..."
            if command -v dnf &> /dev/null; then
                curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                sudo dnf install -y nodejs
            elif command -v yum &> /dev/null; then
                curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                sudo yum install -y nodejs
            fi
            ;;
        *)
            echo "❌ Unsupported OS: $OS"
            echo "Please install Node.js 20+ manually from https://nodejs.org/"
            exit 1
            ;;
    esac
    
    # Verify installation
    if ! command -v node &> /dev/null; then
        echo "❌ Failed to install Node.js. Please install manually."
        exit 1
    fi
    
    echo "✅ Node.js installed successfully"
    node --version
}

# Check Node.js
if ! command -v node &> /dev/null; then
    install_nodejs
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "⚠️  Node.js version is less than 20. Current version: $(node -v)"
    echo "📦 Upgrading Node.js to version 20+..."
    install_nodejs
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. This should not happen after Node.js installation."
    exit 1
fi

echo "✅ Node.js $(node -v) and npm $(npm -v) are installed"

# Function to install Nginx
install_nginx() {
    echo "📦 Neither Docker nor Nginx found. Installing Nginx..."
    
    # Detect OS (reuse the same detection logic)
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        echo "❌ Cannot detect OS. Please install Nginx manually."
        return 1
    fi
    
    # Install Nginx based on OS
    case $OS in
        ubuntu|debian)
            echo "📥 Installing Nginx on Ubuntu/Debian..."
            sudo apt-get update
            sudo apt-get install -y nginx
            ;;
        centos|rhel|fedora|rocky|almalinux)
            echo "📥 Installing Nginx on CentOS/RHEL/Fedora..."
            if command -v dnf &> /dev/null; then
                sudo dnf install -y nginx
            elif command -v yum &> /dev/null; then
                sudo yum install -y nginx
            fi
            ;;
        *)
            echo "❌ Unsupported OS: $OS"
            echo "Please install Nginx manually from https://nginx.org/"
            return 1
            ;;
    esac
    
    # Verify installation
    if ! command -v nginx &> /dev/null; then
        echo "❌ Failed to install Nginx. Please install manually."
        return 1
    fi
    
    # Start and enable Nginx service
    echo "🚀 Starting Nginx service..."
    sudo systemctl start nginx || true
    sudo systemctl enable nginx || true
    
    echo "✅ Nginx installed and started successfully"
    nginx -v
}

# Check git (needed if cloning repo)
if ! command -v git &> /dev/null; then
    echo "📦 Git not found. Installing git..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y git
    elif command -v yum &> /dev/null; then
        sudo yum install -y git
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y git
    else
        echo "⚠️  Git is not installed. Please install git manually."
        exit 1
    fi
fi

# Check for Docker or Nginx (runtime requirements)
echo "🔍 Checking runtime requirements (Docker or Nginx)..."
HAS_DOCKER=false
HAS_NGINX=false

if command -v docker &> /dev/null; then
    if docker ps &> /dev/null 2>&1; then
        HAS_DOCKER=true
        echo "✅ Docker found"
    fi
fi

if command -v nginx &> /dev/null; then
    HAS_NGINX=true
    echo "✅ Nginx found"
fi

if [ "$HAS_DOCKER" = false ] && [ "$HAS_NGINX" = false ]; then
    echo "⚠️  Neither Docker nor Nginx found."
    echo "   Installing Nginx automatically..."
    install_nginx
    if [ $? -eq 0 ]; then
        echo "✅ Nginx installed successfully - agent will use system runtime"
    else
        echo "⚠️  Nginx installation failed. Agent can still run, but deployment will require Docker or Nginx."
    fi
fi

# Create directory
INSTALL_DIR="/opt/sirka-agent"
echo "📁 Creating installation directory: $INSTALL_DIR"
sudo mkdir -p $INSTALL_DIR
sudo chown $USER:$USER $INSTALL_DIR

# Determine if we're running from a cloned repo or via curl
if [ -f "package.json" ] && [ -d "src" ]; then
    # Running from cloned repository
    echo "📦 Copying files from current directory..."
    cp -r * $INSTALL_DIR/ 2>/dev/null || {
        # If cp fails, try with explicit files
        cp package.json $INSTALL_DIR/
        cp -r src $INSTALL_DIR/
        cp env.example $INSTALL_DIR/ 2>/dev/null || true
        cp README.md $INSTALL_DIR/ 2>/dev/null || true
    }
else
    # Running via curl | bash - need to clone repo
    echo "📦 Cloning repository..."
    TEMP_DIR=$(mktemp -d)
    cd $TEMP_DIR
    git clone https://github.com/sirka-internal/vps-agent.git . || {
        echo "❌ Failed to clone repository. Please ensure git is installed and repository is accessible."
        exit 1
    }
    echo "📦 Copying files..."
    cp -r * $INSTALL_DIR/ 2>/dev/null || {
        cp package.json $INSTALL_DIR/
        cp -r src $INSTALL_DIR/
        cp env.example $INSTALL_DIR/ 2>/dev/null || true
        cp README.md $INSTALL_DIR/ 2>/dev/null || true
    }
    cd -
    rm -rf $TEMP_DIR
fi

cd $INSTALL_DIR

# Install dependencies
echo "📥 Installing dependencies..."
npm install --production

# Create logs directory
mkdir -p logs

# Create .env file
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Creating .env file..."
    # Copy from env.example if exists
    if [ -f "$INSTALL_DIR/env.example" ]; then
        cp "$INSTALL_DIR/env.example" "$ENV_FILE"
    else
        # Create basic .env file
        cat > "$ENV_FILE" <<EOF
# Agent Token from platform (required)
AGENT_TOKEN=

# Agent HTTP port
AGENT_PORT=3001

# Runtime mode: auto, docker, or system
RUNTIME=auto

# Base path for deployments
DEPLOY_PATH=/var/www/sites

# Log level: error, warn, info, debug
LOG_LEVEL=info
EOF
    fi
fi

# Set AGENT_TOKEN if provided
if [ -n "$AGENT_TOKEN" ]; then
    echo "🔑 Setting AGENT_TOKEN in .env file..."
    # Update or add AGENT_TOKEN in .env
    if grep -q "^AGENT_TOKEN=" "$ENV_FILE"; then
        # Update existing line
        sed -i.bak "s|^AGENT_TOKEN=.*|AGENT_TOKEN=$AGENT_TOKEN|" "$ENV_FILE"
        rm -f "$ENV_FILE.bak" 2>/dev/null || true
    else
        # Add at the beginning
        sed -i.bak "1s|^|AGENT_TOKEN=$AGENT_TOKEN\n|" "$ENV_FILE"
        rm -f "$ENV_FILE.bak" 2>/dev/null || true
    fi
    echo "✅ AGENT_TOKEN set successfully"
fi

# Create systemd service
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/sirka-agent.service > /dev/null <<EOF
[Unit]
Description=Sirka VPS Agent
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Installation complete!"
echo ""

if [ -z "$AGENT_TOKEN" ]; then
    echo "⚠️  Token was not provided. Please edit $INSTALL_DIR/.env and set AGENT_TOKEN:"
    echo "   sudo nano $INSTALL_DIR/.env"
    echo ""
    echo "📝 Next steps:"
    echo "1. Edit $INSTALL_DIR/.env and set AGENT_TOKEN"
    echo "2. Start the service: sudo systemctl start sirka-agent"
    echo "3. Enable auto-start: sudo systemctl enable sirka-agent"
    echo "4. Check status: sudo systemctl status sirka-agent"
else
    echo "✅ AGENT_TOKEN has been automatically configured!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Start the service: sudo systemctl start sirka-agent"
    echo "2. Enable auto-start: sudo systemctl enable sirka-agent"
    echo "3. Check status: sudo systemctl status sirka-agent"
fi

echo ""
echo "ℹ️  Note: The agent listens on port 3001 and doesn't need PLATFORM_URL."
echo "   The platform will connect to this agent using the IP/hostname you provided."

