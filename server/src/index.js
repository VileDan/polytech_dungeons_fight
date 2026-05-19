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


// Track active users
const connectedUsers = {};

io.use((socket, next) => {
  const userId = socket.handshake.auth.userId;
  const userName = socket.handshake.auth.userName;
  if (!userId) {
    return next(new Error("invalid username"));
  }
  socket.userId = userId;
  socket.userName = userName;
  connectedUsers[socket.id] = { userId, userName };
  next();
});

// Game State
const rooms = {};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('create_room', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: socket.userId,
        players: [socket.userId],
        map: { cols: 20, rows: 15 },
        tokens: [],
        characters: [],
        props: [
            { id: 'prop_table', name: 'Table', type: 'prop', color: '#8B4513' },
            { id: 'prop_chair', name: 'Chair', type: 'prop', color: '#A0522D' },
            { id: 'prop_crate', name: 'Crate', type: 'prop', color: '#CD853F' },
            { id: 'prop_lantern', name: 'Lantern', type: 'prop', color: '#FFD700' }
        ]
      };
      socket.join(roomId);
      socket.emit('room_created', roomId, true); // true = isHost
      console.log(`Room ${roomId} created by ${socket.id}`);
    } else {
      socket.emit('error', 'Room already exists');
    }
  });

  socket.on('join_room', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].players.push(socket.id);
      socket.join(roomId);
      // Pass flag if joining player is host
      const state = { ...rooms[roomId], isHost: rooms[roomId].host === socket.userId };
      socket.emit('room_joined', roomId, state);
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
        rooms[roomId].tokens[index].hasMoved = tokenData.hasMoved || rooms[roomId].tokens[index].hasMoved;
        io.to(roomId).emit('token_moved', tokenData);
      }
    }
  });


  socket.on('create_character', (roomId, characterData) => {
    if (rooms[roomId]) {
      rooms[roomId].characters.push(characterData);
      io.to(roomId).emit('character_created', characterData);
    }
  });

  socket.on('delete_character', (roomId, characterId) => {
    if (rooms[roomId]) {
      rooms[roomId].characters = rooms[roomId].characters.filter(c => c.id !== characterId);
      io.to(roomId).emit('character_deleted', characterId);
    }
  });


  socket.on('update_map', (roomId, mapData) => {
    if (rooms[roomId] && rooms[roomId].host === socket.userId) {
      rooms[roomId].map = mapData;
      io.to(roomId).emit('map_updated', mapData);
    }
  });

  socket.on('update_character', (roomId, characterData) => {
    if (rooms[roomId]) {
      const idx = rooms[roomId].characters.findIndex(c => c.id === characterData.id);
      if (idx !== -1) {
        rooms[roomId].characters[idx] = characterData;
        io.to(roomId).emit('character_updated', characterData);
      }
    }
  });

  socket.on('delete_token', (roomId, tokenId) => {
    if (rooms[roomId] && rooms[roomId].host === socket.userId) {
      rooms[roomId].tokens = rooms[roomId].tokens.filter(t => t.id !== tokenId);
      io.to(roomId).emit('token_deleted', tokenId);
    }
  });

  socket.on('update_token', (roomId, tokenData) => {
    if (rooms[roomId] && rooms[roomId].host === socket.userId) {
      const idx = rooms[roomId].tokens.findIndex(t => t.id === tokenData.id);
      if (idx !== -1) {
        rooms[roomId].tokens[idx] = { ...rooms[roomId].tokens[idx], ...tokenData };
        io.to(roomId).emit('token_updated', rooms[roomId].tokens[idx]);
      }
    }
  });

  socket.on('end_turn', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].tokens.forEach(t => t.hasMoved = false);
      io.to(roomId).emit('turn_ended');
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
