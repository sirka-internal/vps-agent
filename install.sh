#!/bin/bash

# Sirka VPS Agent Installation Script

set -e

echo "🚀 Installing Sirka VPS Agent..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

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

