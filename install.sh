#!/bin/bash

# Sirka VPS Agent Installation Script

set -e

echo "🚀 Installing Sirka VPS Agent..."

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
echo "📝 Next steps:"
echo "1. Edit $INSTALL_DIR/.env and set AGENT_TOKEN (get it from your User Cabinet)"
echo "2. Start the service: sudo systemctl start sirka-agent"
echo "3. Enable auto-start: sudo systemctl enable sirka-agent"
echo "4. Check status: sudo systemctl status sirka-agent"
echo ""
echo "ℹ️  Note: The agent listens on port 3001 and doesn't need PLATFORM_URL."
echo "   The platform will connect to this agent using the IP/hostname you provided."

