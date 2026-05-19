import { Application, Graphics, Container, Rectangle, Ticker, Sprite, Assets } from 'pixi.js';
import { io, Socket } from 'socket.io-client';

// Types
interface TokenData {
    id: string; // unique instance id
    templateId: string; // id of character/prop
    x: number;
    y: number;
    color: number;
    speed: number;
    avatarUrl?: string;
    type: 'character' | 'prop';
    hasMoved: boolean;
}

interface CharacterTemplate {
    id: string;
    name: string;
    speed: number;
    color: number;
    avatarUrl?: string;
}

interface PropTemplate {
    id: string;
    name: string;
    color: string; // Using string for easy css
}

// Global State
let socket: Socket;
let currentRoom: string | null = null;
let app: Application;
let worldContainer: Container;
let gridContainer: Container;
let highlightContainer: Container;
let tokensContainer: Container;
const tokenGraphicsMap = new Map<string, Container>();
const tokensDataMap = new Map<string, TokenData>();
const animatingTokens = new Set<string>();

let selectedTokenId: string | null = null;
let reachableCells: {x: number, y: number}[] = [];

// Camera / Pan & Zoom State
let isPanning = false;
let panStart = { x: 0, y: 0 };
let hasMovedDuringPan = false;

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
const endTurnBtn = document.getElementById('end-turn-btn')!;
const toggleSidePanelBtn = document.getElementById('toggle-side-panel-btn')!;
const sidePanel = document.getElementById('side-panel')!;
const currentRoomDisplay = document.getElementById('current-room-display')!;
const errorMsg = document.getElementById('lobby-error')!;

// Tab Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const characterList = document.getElementById('character-list')!;
const propsList = document.getElementById('props-list')!;

// Character Form
const charNameInput = document.getElementById('char-name') as HTMLInputElement;
const charSpeedInput = document.getElementById('char-speed') as HTMLInputElement;
const charUrlInput = document.getElementById('char-url') as HTMLInputElement;
const charColorInput = document.getElementById('char-color') as HTMLInputElement;
const createCharBtn = document.getElementById('create-char-btn')!;

// Local state for UI
let roomCharacters: CharacterTemplate[] = [];
let roomProps: PropTemplate[] = [];

// --- Initialization ---

async function init() {
    // 1. Initialize PixiJS
    app = new Application();
    await app.init({
        resizeTo: window,
        backgroundColor: 0xe0e0e0,
    });
    document.getElementById('game-container')!.appendChild(app.canvas);

    worldContainer = new Container();
    gridContainer = new Container();
    highlightContainer = new Container();
    tokensContainer = new Container();

    worldContainer.addChild(gridContainer);
    worldContainer.addChild(highlightContainer);
    worldContainer.addChild(tokensContainer);
    app.stage.addChild(worldContainer);

    drawGrid();

    // 2. Initialize Socket.IO
    socket = io('http://localhost:3000'); // Assuming backend on 3000

    setupSocketListeners();
    setupUIListeners();
    setupCameraControls();

    // Add interaction to stage to handle dropping outside tokens
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-100000, -100000, 200000, 200000);
}

// --- Camera Logic ---

function setupCameraControls() {
    app.canvas.addEventListener?.('wheel', (e: WheelEvent) => {
        e.preventDefault();

        // Zoom logic
        const zoomFactor = 1.1;
        const direction = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor;

        // Get mouse position relative to canvas
        const rect = (app.canvas as HTMLCanvasElement).getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate world position before zoom
        const worldX = (mouseX - worldContainer.x) / worldContainer.scale.x;
        const worldY = (mouseY - worldContainer.y) / worldContainer.scale.y;

        // Apply new scale
        const newScale = worldContainer.scale.x * direction;
        // Limit zoom
        if (newScale < 0.2 || newScale > 5) return;

        worldContainer.scale.set(newScale);

        // Adjust position so we zoom towards the mouse pointer
        worldContainer.x = mouseX - worldX * newScale;
        worldContainer.y = mouseY - worldY * newScale;
    }, { passive: false });


    let initialPinchDistance = 0;
    let initialScale = 1;

    app.canvas.addEventListener?.('touchstart', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            initialScale = worldContainer.scale.x;
            isPanning = false; // Stop panning if we are zooming
        }
    }, { passive: false });

    app.canvas.addEventListener?.('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const scaleFactor = distance / initialPinchDistance;
            let newScale = initialScale * scaleFactor;

            if (newScale < 0.2) newScale = 0.2;
            if (newScale > 5) newScale = 5;

            // For touch zoom, we zoom to center of screen for simplicity
            const rect = (app.canvas as HTMLCanvasElement).getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const worldX = (centerX - worldContainer.x) / worldContainer.scale.x;
            const worldY = (centerY - worldContainer.y) / worldContainer.scale.y;

            worldContainer.scale.set(newScale);

            worldContainer.x = centerX - worldX * newScale;
            worldContainer.y = centerY - worldY * newScale;
        }
    }, { passive: false });

    app.stage.on('pointerdown', (e) => {
        isPanning = true;
        hasMovedDuringPan = false;
        panStart.x = e.global.x - worldContainer.x;
        panStart.y = e.global.y - worldContainer.y;
        app.canvas.style.cursor = 'grabbing';
    });

    app.stage.on('pointermove', (e) => {
        if (isPanning) {
            const dx = Math.abs((e.global.x - worldContainer.x) - panStart.x);
            const dy = Math.abs((e.global.y - worldContainer.y) - panStart.y);
            if (dx > 5 || dy > 5) {
                hasMovedDuringPan = true;
            }
            worldContainer.x = e.global.x - panStart.x;
            worldContainer.y = e.global.y - panStart.y;
        }
    });

    const stopPanning = (e: any) => {
        if (isPanning) {
            isPanning = false;
            app.canvas.style.cursor = 'default';

            if (!hasMovedDuringPan && e.target === app.stage) {
                // If it was a click on the stage and not a pan, handle movement or deselect
                handleStageClick(e);
            }
        }
    };

    app.stage.on('pointerup', stopPanning);
    app.stage.on('pointerupoutside', stopPanning);
}

// --- Grid Logic ---

function drawGrid() {
    const grid = new Graphics();
    grid.setStrokeStyle({ width: 1, color: 0xcccccc, alpha: 1 });

    const width = COLS * GRID_SIZE;
    const height = ROWS * GRID_SIZE;

    // Center the world container initially
    const offsetX = Math.max(0, (window.innerWidth - width) / 2);
    const offsetY = Math.max(0, (window.innerHeight - height) / 2);

    worldContainer.position.set(offsetX, offsetY);

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

// --- Selection & Pathfinding Logic ---

function handleTokenClick(event: any) {
    if (hasMovedDuringPan) return;

    const tokenId = event.currentTarget.tokenId;
    const tokenData = tokensDataMap.get(tokenId);

    // Prevent selecting tokens that have moved or are props
    if (!tokenData || tokenData.hasMoved || tokenData.type === 'prop') return;

    if (selectedTokenId === tokenId) {
        // Deselect
        deselectToken();
    } else {
        // Select
        selectedTokenId = tokenId;
        calculateReachableCells();
        drawHighlights();
        // Redraw all tokens to show selection
        for (const [, data] of tokensDataMap) {
            createOrUpdateToken(data);
        }
    }
}

function deselectToken() {
    selectedTokenId = null;
    reachableCells = [];
    highlightContainer.removeChildren();
    // Redraw all tokens to remove selection
    for (const [, data] of tokensDataMap) {
        createOrUpdateToken(data);
    }
}

function handleStageClick(event: any) {
    if (!selectedTokenId) return;

    const localPos = highlightContainer.toLocal(event.global);
    const gridX = Math.floor(localPos.x / GRID_SIZE);
    const gridY = Math.floor(localPos.y / GRID_SIZE);

    // Check if clicked cell is reachable
    const isReachable = reachableCells.some(cell => cell.x === gridX && cell.y === gridY);
    if (isReachable) {
        const targetX = gridX * GRID_SIZE;
        const targetY = gridY * GRID_SIZE;

        // Mark as moved locally
        const tokenData = tokensDataMap.get(selectedTokenId);
        if (tokenData) tokenData.hasMoved = true;

        // Emit move event immediately. Visuals updated by animation later.
        socket.emit('move_token', currentRoom, {
            id: selectedTokenId,
            x: targetX,
            y: targetY,
            hasMoved: true
        });
        deselectToken();
    } else {
        deselectToken();
    }
}

function calculateReachableCells() {
    reachableCells = [];
    if (!selectedTokenId) return;

    const tokenData = tokensDataMap.get(selectedTokenId);
    if (!tokenData) return;

    const startX = Math.floor(tokenData.x / GRID_SIZE);
    const startY = Math.floor(tokenData.y / GRID_SIZE);
    const maxDist = tokenData.speed;

    // Simple BFS for grid distance (assuming weight 1 for all cells for now)
    const queue: {x: number, y: number, dist: number}[] = [{x: startX, y: startY, dist: 0}];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
        const current = queue.shift()!;

        if (current.dist <= maxDist && (current.x !== startX || current.y !== startY)) {
            reachableCells.push({x: current.x, y: current.y});
        }

        if (current.dist < maxDist) {
            const neighbors = [
                {x: current.x + 1, y: current.y},
                {x: current.x - 1, y: current.y},
                {x: current.x, y: current.y + 1},
                {x: current.x, y: current.y - 1}
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.x < COLS && n.y >= 0 && n.y < ROWS) {
                    const key = `${n.x},${n.y}`;
                    // Check if occupied
                    let occupied = false;
                    for (const [, otherToken] of tokensDataMap) {
                        if (Math.floor(otherToken.x / GRID_SIZE) === n.x && Math.floor(otherToken.y / GRID_SIZE) === n.y) {
                            occupied = true;
                            break;
                        }
                    }

                    if (!visited.has(key) && !occupied) {
                        visited.add(key);
                        queue.push({x: n.x, y: n.y, dist: current.dist + 1});
                    }
                }
            }
        }
    }
}

function drawHighlights() {
    highlightContainer.removeChildren();
    for (const cell of reachableCells) {
        const h = new Graphics();
        h.beginFill(0x00ff00, 0.3);
        h.drawRect(cell.x * GRID_SIZE, cell.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        h.endFill();
        highlightContainer.addChild(h);
    }
}

// --- Token Logic ---
async function createOrUpdateToken(data: TokenData) {
    tokensDataMap.set(data.id, data);
    let tokenContainer = tokenGraphicsMap.get(data.id);
    let graphics: Graphics;
    let sprite: Sprite | undefined;

    if (!tokenContainer) {
        tokenContainer = new Container();
        tokenContainer.eventMode = 'static';
        tokenContainer.cursor = data.type === 'prop' || data.hasMoved ? 'default' : 'pointer';

        tokenContainer.on('pointerup', handleTokenClick);
        (tokenContainer as any).tokenId = data.id;

        graphics = new Graphics();
        graphics.label = 'bg'; // Using label instead of name for pixijs v8
        tokenContainer.addChild(graphics);

        tokensContainer.addChild(tokenContainer);
        tokenGraphicsMap.set(data.id, tokenContainer);

        // Try loading avatar if exists
        if (data.avatarUrl) {
            try {
                const texture = await Assets.load(data.avatarUrl);
                sprite = new Sprite(texture);
                sprite.label = 'avatar';
                sprite.anchor.set(0.5);
                sprite.position.set(GRID_SIZE / 2, GRID_SIZE / 2);

                // Scale to fit
                const size = GRID_SIZE - 8;
                const scale = Math.max(size / sprite.width, size / sprite.height);
                sprite.scale.set(scale);

                // Add circular mask
                const mask = new Graphics();
                mask.beginFill(0xffffff);
                mask.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, size / 2);
                mask.endFill();

                tokenContainer.addChild(mask);
                sprite.mask = mask;

                tokenContainer.addChild(sprite);
            } catch (e) {
                console.warn('Failed to load avatar:', data.avatarUrl);
            }
        }
    } else {
        graphics = tokenContainer.getChildByLabel('bg') as Graphics;
        tokenContainer.cursor = data.type === 'prop' || data.hasMoved ? 'default' : 'pointer';
    }

    // Draw/Redraw Background & Border
    graphics.clear();
    const radius = (GRID_SIZE / 2) - 4;

    // Dim color if hasMoved
    let fillColor = data.color;
    let alpha = data.hasMoved ? 0.5 : 1;

    graphics.beginFill(fillColor, alpha);

    // Props might be drawn as squares
    if (data.type === 'prop') {
        graphics.drawRect(4, 4, GRID_SIZE - 8, GRID_SIZE - 8);
    } else {
        graphics.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    }
    graphics.endFill();

    if (selectedTokenId === data.id) {
        graphics.lineStyle(4, 0xffaa00, 1);
    } else if (data.hasMoved) {
        graphics.lineStyle(2, 0x888888, 0.8);
    } else {
        graphics.lineStyle(2, 0x000000, 0.5);
    }

    if (data.type === 'prop') {
        graphics.drawRect(4, 4, GRID_SIZE - 8, GRID_SIZE - 8);
    } else {
        graphics.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    }

    tokenContainer.position.set(data.x, data.y);
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
        roomCharacters = state.characters || [];
        roomProps = state.props || [];
        renderCharacterList();
        renderPropsList();
        // Sync existing tokens
        state.tokens.forEach((tokenData: TokenData) => {
            createOrUpdateToken(tokenData);
        });
    });

    socket.on('character_created', (characterData: CharacterTemplate) => {
        roomCharacters.push(characterData);
        renderCharacterList();
    });

    socket.on('character_deleted', (characterId: string) => {
        roomCharacters = roomCharacters.filter(c => c.id !== characterId);
        renderCharacterList();
    });

    socket.on('turn_ended', () => {
        tokensDataMap.forEach(token => {
            token.hasMoved = false;
            createOrUpdateToken(token); // Force redraw
        });
        deselectToken();
    });

    socket.on('player_joined', (playerId: string) => {
        console.log(`Player ${playerId} joined`);
    });

    socket.on('token_spawned', (tokenData: TokenData) => {
        createOrUpdateToken(tokenData);
    });

    socket.on('token_moved', (tokenData: any) => {
        animateTokenMovement(tokenData);
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

    endTurnBtn.addEventListener('click', () => {
        if (currentRoom) {
            socket.emit('end_turn', currentRoom);
        }
    });

    toggleSidePanelBtn.addEventListener('click', () => {
        sidePanel.classList.toggle('collapsed');
    });

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = (e.currentTarget as HTMLElement).getAttribute('data-target');

            tabBtns.forEach(b => b.classList.remove('active'));
            (e.currentTarget as HTMLElement).classList.add('active');

            tabContents.forEach(tc => tc.classList.remove('active'));
            document.getElementById(targetId!)?.classList.add('active');
        });
    });

    createCharBtn.addEventListener('click', () => {
        if (!currentRoom) return;
        const name = charNameInput.value.trim() || 'Hero';
        const speed = parseInt(charSpeedInput.value) || 3;
        const url = charUrlInput.value.trim();
        const colorStr = charColorInput.value.replace('#', '0x');
        const color = parseInt(colorStr, 16);

        const newChar: CharacterTemplate = {
            id: 'char_' + Math.random().toString(36).substr(2, 9),
            name,
            speed,
            color,
            avatarUrl: url || undefined
        };

        socket.emit('create_character', currentRoom, newChar);

        // Reset form
        charNameInput.value = '';
        charUrlInput.value = '';
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        // Optionally recenter or adjust here, but usually pan/zoom makes this unnecessary
        // We leave it to the user's pan position.
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


function renderCharacterList() {
    characterList.innerHTML = '';
    roomCharacters.forEach(char => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style.borderLeftColor = '#' + char.color.toString(16).padStart(6, '0');

        item.innerHTML = `
            <div class="list-item-info">
                <strong>${char.name}</strong>
                <small>Spd: ${char.speed}</small>
            </div>
            <div class="list-item-actions">
                <button class="btn primary small spawn-char-btn" data-id="${char.id}">Spawn</button>
                <button class="btn danger small delete-char-btn" data-id="${char.id}">X</button>
            </div>
        `;
        characterList.appendChild(item);
    });

    document.querySelectorAll('.spawn-char-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const charId = (e.currentTarget as HTMLElement).getAttribute('data-id');
            const char = roomCharacters.find(c => c.id === charId);
            if (char && currentRoom) {
                spawnTokenFromTemplate(char, 'character');
            }
        });
    });

    document.querySelectorAll('.delete-char-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const charId = (e.currentTarget as HTMLElement).getAttribute('data-id');
            if (charId && currentRoom) {
                socket.emit('delete_character', currentRoom, charId);
            }
        });
    });
}

function renderPropsList() {
    propsList.innerHTML = '';
    roomProps.forEach(prop => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style.borderLeftColor = prop.color;

        item.innerHTML = `
            <div class="list-item-info">
                <strong>${prop.name}</strong>
            </div>
            <div class="list-item-actions">
                <button class="btn secondary small spawn-prop-btn" data-id="${prop.id}">Spawn</button>
            </div>
        `;
        propsList.appendChild(item);
    });

    document.querySelectorAll('.spawn-prop-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const propId = (e.currentTarget as HTMLElement).getAttribute('data-id');
            const prop = roomProps.find(p => p.id === propId);
            if (prop && currentRoom) {
                spawnTokenFromTemplate(prop, 'prop');
            }
        });
    });
}

function spawnTokenFromTemplate(template: any, type: 'character' | 'prop') {
    const randCol = Math.floor(Math.random() * COLS);
    const randRow = Math.floor(Math.random() * ROWS);

    let colorVal = 0xffffff;
    if (typeof template.color === 'number') {
        colorVal = template.color;
    } else if (typeof template.color === 'string') {
        colorVal = parseInt(template.color.replace('#', '0x'), 16);
    }

    const tokenData: TokenData = {
        id: 'inst_' + Math.random().toString(36).substr(2, 9),
        templateId: template.id,
        x: randCol * GRID_SIZE,
        y: randRow * GRID_SIZE,
        color: colorVal,
        speed: template.speed || 0,
        avatarUrl: template.avatarUrl,
        type: type,
        hasMoved: false
    };

    socket.emit('spawn_token', currentRoom, tokenData);
}

// --- Animation Logic ---

function animateTokenMovement(partialData: Partial<TokenData> & { id: string, x: number, y: number }) {
    const tokenGraphic = tokenGraphicsMap.get(partialData.id);
    const existingData = tokensDataMap.get(partialData.id);

    if (!tokenGraphic || !existingData) {
        createOrUpdateToken(partialData as TokenData);
        return;
    }

    // Update data map immediately by merging so logic sees it there without losing data like color/speed
    const newTokenData = { ...existingData, ...partialData };
    tokensDataMap.set(newTokenData.id, newTokenData);

    // If already animating, force it to end state before starting new
    if (animatingTokens.has(newTokenData.id)) {
        // Find existing ticker logic if needed, but simple approach is just let it run or override
        // A cleaner way is to keep track of animation objects and cancel them, but for prototype:
        tokenGraphic.position.set(newTokenData.x, newTokenData.y);
    }

    const startX = tokenGraphic.x;
    const startY = tokenGraphic.y;
    const endX = newTokenData.x;
    const endY = newTokenData.y;

    // If not actually moving, just update visual state (selection etc)
    if (startX === endX && startY === endY) {
        createOrUpdateToken(newTokenData);
        return;
    }

    animatingTokens.add(newTokenData.id);

    // Deselect if we are moving the selected token (optional, but good UX)
    if (selectedTokenId === newTokenData.id) {
         deselectToken();
    }

    const duration = 500; // ms
    const startTime = performance.now();

    const ticker = new Ticker();
    ticker.add(() => {
        const now = performance.now();
        const progress = Math.min((now - startTime) / duration, 1);

        // Easing function (linear for x/y)
        const currentX = startX + (endX - startX) * progress;
        const currentY = startY + (endY - startY) * progress;

        // Jump arc (parabola)
        // peak height based on distance
        const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        const peakHeight = Math.min(dist / 2, 50); // Max jump height 50

        // y = -4 * h * (x-0.5)^2 + h
        const jumpOffset = -4 * peakHeight * Math.pow(progress - 0.5, 2) + peakHeight;

        // Scale peak calculation (1.0 to 1.3 back to 1.0)
        const scaleBoost = -4 * 0.3 * Math.pow(progress - 0.5, 2) + 0.3;
        const currentScale = 1.0 + scaleBoost;

        tokenGraphic.position.set(currentX, currentY - jumpOffset);

        // Scale around center
        // When setting pivot, the visual position shifts by the pivot amount scaled.
        // We already set tokenGraphic.position to (currentX, currentY - jumpOffset).
        // To maintain the visual center, we adjust position by pivot.
        tokenGraphic.pivot.set(GRID_SIZE/2, GRID_SIZE/2);
        tokenGraphic.x = currentX + GRID_SIZE/2;
        tokenGraphic.y = (currentY - jumpOffset) + GRID_SIZE/2;
        tokenGraphic.scale.set(currentScale);

        if (progress >= 1) {
            tokenGraphic.pivot.set(0, 0);
            tokenGraphic.scale.set(1);
            ticker.destroy();
            animatingTokens.delete(newTokenData.id);
            // Redraw to reset to clean state (stroke, exact position)
            createOrUpdateToken(newTokenData);
        }
    });

    ticker.start();
}
