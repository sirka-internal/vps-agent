require('dotenv').config();
const express = require('express');
const authMiddleware = require('./middleware/auth');
const deployController = require('./controllers/deploy');
const statusController = require('./controllers/status');
const restartController = require('./controllers/restart');
const logger = require('./utils/logger');
const { detectRuntime } = require('./utils/runtime-detector');

const app = express();
const PORT = process.env.AGENT_PORT || 3001;

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', runtime: process.env.RUNTIME || 'auto' });
});

// Protected routes
app.use(authMiddleware);

// API endpoints
app.post('/deploy', deployController.deploy);
app.post('/restart', restartController.restart);
app.get('/status', statusController.getStatus);

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize runtime detection
async function init() {
  try {
    const runtime = await detectRuntime();
    logger.info(`Agent initialized with runtime: ${runtime}`);
    
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`VPS Agent listening on port ${PORT}`);
      logger.info(`Runtime: ${runtime}`);
      logger.info(`Agent is ready to receive commands from platform`);
    });
  } catch (error) {
    logger.error('Failed to initialize agent:', error);
    process.exit(1);
  }
}

init();

