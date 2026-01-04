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

# Create directory
INSTALL_DIR="/opt/sirka-agent"
echo "📁 Creating installation directory: $INSTALL_DIR"
sudo mkdir -p $INSTALL_DIR
sudo chown $USER:$USER $INSTALL_DIR

# Copy files
echo "📦 Copying files..."
cp -r * $INSTALL_DIR/
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
echo "1. Edit $INSTALL_DIR/.env and set AGENT_TOKEN and PLATFORM_URL"
echo "2. Start the service: sudo systemctl start sirka-agent"
echo "3. Enable auto-start: sudo systemctl enable sirka-agent"
echo "4. Check status: sudo systemctl status sirka-agent"

