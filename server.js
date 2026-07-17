const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { setupSocket } = require('./src/SocketHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Socket.IO event handlers
setupSocket(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`[Draw Mafia] Server running on http://localhost:${PORT}`);
});
