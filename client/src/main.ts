import { Application, Graphics, Container, Rectangle } from 'pixi.js';
import { io, Socket } from 'socket.io-client';

// Types
interface TokenData {
    id: string;
    x: number;
    y: number;
    color: number;
}

// Global State
let socket: Socket;
let currentRoom: string | null = null;
let app: Application;
let gridContainer: Container;
let tokensContainer: Container;
const tokenGraphicsMap = new Map<string, Graphics>();
let isDragging = false;
let draggedToken: Graphics | null = null;
let dragOffset = { x: 0, y: 0 };

const GRID_SIZE = 50;
const ROWS = 15;
const COLS = 20;

// UI Elements
const lobbyMenu = document.getElementById('lobby-menu')!;
const gameUi = document.getElementById('game-ui')!;
const roomInput = document.getElementById('room-id-input') as HTMLInputElement;
const createRoomBtn = document.getElementById('create-room-btn')!;
const joinRoomBtn = document.getElementById('join-room-btn')!;
const leaveRoomBtn = document.getElementById('leave-room-btn')!;
const currentRoomDisplay = document.getElementById('current-room-display')!;
const errorMsg = document.getElementById('lobby-error')!;
const spawnBtns = document.querySelectorAll('.spawn-btn');

// --- Initialization ---

async function init() {
    // 1. Initialize PixiJS
    app = new Application();
    await app.init({
        resizeTo: window,
        backgroundColor: 0xe0e0e0,
    });
    document.getElementById('game-container')!.appendChild(app.canvas);

    gridContainer = new Container();
    tokensContainer = new Container();
    app.stage.addChild(gridContainer);
    app.stage.addChild(tokensContainer);

    drawGrid();

    // 2. Initialize Socket.IO
    socket = io('http://localhost:3000'); // Assuming backend on 3000

    setupSocketListeners();
    setupUIListeners();

    // Add interaction to stage to handle dropping outside tokens
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-10000, -10000, 20000, 20000);
    app.stage.on('pointerup', onDragEnd);
    app.stage.on('pointerupoutside', onDragEnd);
}

// --- Grid Logic ---

function drawGrid() {
    const grid = new Graphics();
    grid.setStrokeStyle({ width: 1, color: 0xcccccc, alpha: 1 });

    const width = COLS * GRID_SIZE;
    const height = ROWS * GRID_SIZE;

    // Center the grid roughly
    const offsetX = Math.max(0, (window.innerWidth - width) / 2);
    const offsetY = Math.max(0, (window.innerHeight - height) / 2);

    gridContainer.position.set(offsetX, offsetY);
    tokensContainer.position.set(offsetX, offsetY);

    for (let i = 0; i <= COLS; i++) {
        grid.moveTo(i * GRID_SIZE, 0);
        grid.lineTo(i * GRID_SIZE, height);
    }

    for (let i = 0; i <= ROWS; i++) {
        grid.moveTo(0, i * GRID_SIZE);
        grid.lineTo(width, i * GRID_SIZE);
    }
    grid.stroke();

    gridContainer.addChild(grid);
}

init();

// --- Token Logic ---
function createOrUpdateToken(data: TokenData) {
    let token = tokenGraphicsMap.get(data.id);

    if (!token) {
        token = new Graphics();
        token.eventMode = 'static';
        token.cursor = 'pointer';

        token.on('pointerdown', onDragStart);
        token.on('pointermove', onDragMove);
        // pointerup handled by stage to catch releases outside

        // Custom property to store ID
        (token as any).tokenId = data.id;

        tokensContainer.addChild(token);
        tokenGraphicsMap.set(data.id, token);
    }

    // Draw/Redraw
    token.clear();
    token.beginFill(data.color);
    // Draw a circle slightly smaller than the grid size
    const radius = (GRID_SIZE / 2) - 4;
    token.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    token.endFill();

    // Add a stroke for better visibility
    token.lineStyle(2, 0x000000, 0.5);
    token.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);

    token.position.set(data.x, data.y);
}

// --- Drag and Drop Logic ---

function snapToGrid(val: number): number {
    return Math.floor(val / GRID_SIZE) * GRID_SIZE;
}

function onDragStart(event: any) {
    if (!currentRoom) return;

    draggedToken = event.currentTarget as Graphics;
    isDragging = true;

    // Calculate offset so we don't snap the top-left corner to the mouse, but drag from where we clicked
    const newPosition = tokensContainer.toLocal(event.global);
    dragOffset.x = draggedToken.x - newPosition.x;
    dragOffset.y = draggedToken.y - newPosition.y;

    // Bring to front
    tokensContainer.addChild(draggedToken);
}

function onDragMove(event: any) {
    if (isDragging && draggedToken) {
        const newPosition = tokensContainer.toLocal(event.global);

        // Update visual position continuously (smooth dragging)
        draggedToken.x = newPosition.x + dragOffset.x;
        draggedToken.y = newPosition.y + dragOffset.y;
    }
}

function onDragEnd() {
    if (isDragging && draggedToken) {
        isDragging = false;

        // Snap to grid
        const newX = snapToGrid(draggedToken.x + GRID_SIZE / 2);
        const newY = snapToGrid(draggedToken.y + GRID_SIZE / 2);

        // Constrain to grid bounds
        const maxX = (COLS - 1) * GRID_SIZE;
        const maxY = (ROWS - 1) * GRID_SIZE;

        draggedToken.x = Math.max(0, Math.min(newX, maxX));
        draggedToken.y = Math.max(0, Math.min(newY, maxY));

        // Emit move event
        const tokenId = (draggedToken as any).tokenId;
        socket.emit('move_token', currentRoom, {
            id: tokenId,
            x: draggedToken.x,
            y: draggedToken.y
        });

        draggedToken = null;
    }
}

// --- Socket & UI Listeners ---

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('room_created', (roomId: string) => {
        enterRoom(roomId);
    });

    socket.on('room_joined', (roomId: string, state: any) => {
        enterRoom(roomId);
        // Sync existing tokens
        state.tokens.forEach((tokenData: TokenData) => {
            createOrUpdateToken(tokenData);
        });
    });

    socket.on('player_joined', (playerId: string) => {
        console.log(`Player ${playerId} joined`);
    });

    socket.on('token_spawned', (tokenData: TokenData) => {
        createOrUpdateToken(tokenData);
    });

    socket.on('token_moved', (tokenData: TokenData) => {
        // Only update if we aren't currently dragging this token
        if (draggedToken && (draggedToken as any).tokenId === tokenData.id) {
            return;
        }
        createOrUpdateToken(tokenData);
    });

    socket.on('error', (msg: string) => {
        errorMsg.textContent = msg;
        setTimeout(() => { errorMsg.textContent = ''; }, 3000);
    });
}

function setupUIListeners() {
    createRoomBtn.addEventListener('click', () => {
        const roomId = roomInput.value.trim();
        if (roomId) {
            socket.emit('create_room', roomId);
        } else {
            errorMsg.textContent = "Please enter a Room ID";
        }
    });

    joinRoomBtn.addEventListener('click', () => {
        const roomId = roomInput.value.trim();
        if (roomId) {
            socket.emit('join_room', roomId);
        } else {
            errorMsg.textContent = "Please enter a Room ID";
        }
    });

    leaveRoomBtn.addEventListener('click', () => {
        // Hard reload to leave room and reset state for simplicity
        window.location.reload();
    });

    spawnBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!currentRoom) return;

            const target = e.target as HTMLElement;
            const colorStr = target.getAttribute('data-color');
            const color = colorStr ? parseInt(colorStr, 16) : 0xffffff;

            // Random position snapped to grid
            const randCol = Math.floor(Math.random() * COLS);
            const randRow = Math.floor(Math.random() * ROWS);

            const tokenData: TokenData = {
                id: Math.random().toString(36).substr(2, 9),
                x: randCol * GRID_SIZE,
                y: randRow * GRID_SIZE,
                color: color
            };

            socket.emit('spawn_token', currentRoom, tokenData);
        });
    });

    // Handle window resize to recenter grid
    window.addEventListener('resize', () => {
        if (gridContainer && tokensContainer) {
            const width = COLS * GRID_SIZE;
            const height = ROWS * GRID_SIZE;
            const offsetX = Math.max(0, (window.innerWidth - width) / 2);
            const offsetY = Math.max(0, (window.innerHeight - height) / 2);

            gridContainer.position.set(offsetX, offsetY);
            tokensContainer.position.set(offsetX, offsetY);
        }
    });
}

function enterRoom(roomId: string) {
    currentRoom = roomId;
    lobbyMenu.classList.add('hidden');
    gameUi.classList.remove('hidden');
    currentRoomDisplay.textContent = `Room: ${roomId}`;

    // Clear UI layer pointer events so we can click the game board
    document.getElementById('ui-layer')!.style.pointerEvents = 'none';
}
