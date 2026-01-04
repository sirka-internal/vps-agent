# Sirka VPS Agent

Universal VPS deployment agent for static sites. Installs on any VPS with a single command and enables secure deployment without SSH access.

## Features

- 🔐 Token-based authentication (no SSH keys)
- 🐳 Docker runtime support (Docker + Nginx container)
- 💻 System runtime support (Nginx + filesystem)
- 🚀 Atomic deployments
- 📋 Audit logging
- ✅ Whitelisted actions only (deploy, restart, status)

## Quick Install

**One-command install** (recommended):
```bash
curl -fsSL https://raw.githubusercontent.com/sirka-internal/vps-agent/main/install.sh | bash
# Then edit /opt/sirka-agent/.env with your AGENT_TOKEN
# sudo systemctl start sirka-agent
# sudo systemctl enable sirka-agent
```

**Manual install**:
```bash
git clone <repo>
cd vps-agent
npm install
cp env.example .env
# Edit .env with your AGENT_TOKEN
npm start
```

**Or use the installation script manually**:
```bash
./install.sh
# Edit /opt/sirka-agent/.env with your token
sudo systemctl start sirka-agent
sudo systemctl enable sirka-agent
```

**Uninstall**:
```bash
curl -fsSL https://raw.githubusercontent.com/sirka-internal/vps-agent/main/uninstall.sh | bash
# Or run locally: ./uninstall.sh
```

## Configuration

**Important**: Each agent has its own unique token. When you create an agent in your User Cabinet, you'll receive a token that you must use for that specific agent.

Create `.env` file:

```env
# Your unique agent token (required - received when creating agent in User Cabinet)
AGENT_TOKEN=your_agent_token_from_platform

# Agent HTTP port (the port the agent listens on)
# Platform will connect to this agent on this port
AGENT_PORT=3001

# Runtime mode: auto, docker, or system
RUNTIME=auto

# Base path for deployments
DEPLOY_PATH=/var/www/sites

# Log level: error, warn, info, debug
LOG_LEVEL=info
```

**Note**: If you have multiple VPS servers, each one needs its own agent with its own unique token.

## Runtime Modes

- `auto` - Automatically detects Docker or System runtime
- `docker` - Force Docker runtime (requires Docker)
- `system` - Force System runtime (requires Nginx)

## API Endpoints

The agent exposes these endpoints (protected by token):

- `POST /deploy` - Deploy static site
- `POST /restart` - Restart service
- `GET /status` - Get agent status

## Security

- All requests require valid `X-Agent-Token` header
- Only whitelisted actions are allowed
- No shell command execution
- Audit log for all operations

