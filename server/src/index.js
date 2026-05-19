const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Game State
const rooms = {};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('create_room', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [socket.id],
        tokens: []
      };
      socket.join(roomId);
      socket.emit('room_created', roomId);
      console.log(`Room ${roomId} created by ${socket.id}`);
    } else {
      socket.emit('error', 'Room already exists');
    }
  });

  socket.on('join_room', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].players.push(socket.id);
      socket.join(roomId);
      socket.emit('room_joined', roomId, rooms[roomId]);
      socket.to(roomId).emit('player_joined', socket.id);
      console.log(`User ${socket.id} joined room ${roomId}`);
    } else {
      socket.emit('error', 'Room does not exist');
    }
  });

  socket.on('spawn_token', (roomId, tokenData) => {
    if (rooms[roomId]) {
      rooms[roomId].tokens.push(tokenData);
      io.to(roomId).emit('token_spawned', tokenData);
      console.log(`Token spawned in room ${roomId}:`, tokenData);
    }
  });

  socket.on('move_token', (roomId, tokenData) => {
    if (rooms[roomId]) {
      const index = rooms[roomId].tokens.findIndex(t => t.id === tokenData.id);
      if (index !== -1) {
        rooms[roomId].tokens[index].x = tokenData.x;
        rooms[roomId].tokens[index].y = tokenData.y;
        socket.to(roomId).emit('token_moved', tokenData);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Cleanup logic could be added here (e.g., removing from rooms)
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
