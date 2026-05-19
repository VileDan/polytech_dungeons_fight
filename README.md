# Casual Board Game UI

This is a web-based casual game prototype featuring a lobby system and an interactive grid board. It uses PixiJS for rendering the game board and Socket.IO for real-time multiplayer synchronization.

## Features

- **Lobby System:** Create or join game rooms using a unique Room ID.
- **Interactive Grid:** A top-down 20x15 grid rendered with PixiJS.
- **Token Spawning:** A menu to spawn tokens (characters) of different colors.
- **Real-time Synchronization:** Move tokens across the board and see updates in real-time across all connected clients.
- **Casual UI:** A clean, responsive UI built with vanilla HTML/CSS.

## Project Structure

- `client/`: Contains the frontend application built with Vite, TypeScript, and PixiJS.
- `server/`: Contains the backend Node.js application built with Express and Socket.IO.

## Prerequisites

- Node.js (v14 or higher)
- npm

## How to Run

### 1. Start the Server (Backend)

Open a terminal and navigate to the `server` directory:

```sh
cd server
npm install
node src/index.js
```

The server will start listening on port 3000.

### 2. Start the Client (Frontend)

Open a new terminal and navigate to the `client` directory:

```sh
cd client
npm install
npm run dev &
```

The Vite development server will start and provide a local URL (e.g., `http://localhost:5173`). Open this URL in your web browser.

## How to Play

1. **Open the app** in multiple browser tabs or devices.
2. **Create a Room:** Enter a Room ID and click "Create Room" in one tab.
3. **Join a Room:** Enter the *same* Room ID and click "Join Room" in the other tab(s).
4. **Spawn Tokens:** Click the colored buttons at the bottom of the screen to spawn tokens.
5. **Move Tokens:** Click and drag a token to move it. It will snap to the grid, and the movement will be synchronized across all clients in the room.
