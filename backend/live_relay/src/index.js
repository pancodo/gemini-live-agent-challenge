import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { RelaySession } from './relay-session.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

const SESSION_PATH_RE = /^\/session\/([a-zA-Z0-9-]+)$/;

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function handleRequest(req, res) {
  if ((req.url === '/' || req.url === '/health') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'live-relay' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

const server = createServer(handleRequest);

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(SESSION_PATH_RE);

  if (!match) {
    socket.destroy();
    return;
  }

  const sessionId = match[1];
  const token = url.searchParams.get('token') || undefined;

  wss.handleUpgrade(req, socket, head, (ws) => {
    log.info(`WebSocket connected — session=${sessionId}`);
    const session = new RelaySession(ws, sessionId, { resumptionToken: token });
    session.start();
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  log.info(`live-relay listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log.info(`${signal} received — shutting down`);

  wss.close(() => {
    log.info('WebSocket server closed');
    server.close(() => {
      log.info('HTTP server closed');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
