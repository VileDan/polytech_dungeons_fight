// @ts-nocheck
import { Application, Graphics, Container, Rectangle, Ticker, Sprite, Assets, Text, TextStyle } from 'pixi.js';
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
    currentHealth?: number;
}

interface CharacterTemplate {
    id: string;
    name: string;
    speed: number;
    color: number;
    avatarUrl?: string;
    maxHealth?: number;
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
let tooltipContainer: Container;
let hoveredTokenId: string | null = null;
const tokenGraphicsMap = new Map<string, Container>();
const tokensDataMap = new Map<string, TokenData>();
const animatingTokens = new Set<string>();

let selectedTokenId: string | null = null;
let reachableCells: {x: number, y: number}[] = [];

// Placement Mode State
let placementTemplate: any = null;
let placementType: 'character' | 'prop' | null = null;

// Camera / Pan & Zoom State
let isPanning = false;
let panStart = { x: 0, y: 0 };
let hasMovedDuringPan = false;

const GRID_SIZE = 50;
let ROWS = 15;
let COLS = 20;


// --- Authentication ---
let currentUser: { id: string, name: string } | null = null;
const loginScreen = document.getElementById('login-screen')!;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const loginBtn = document.getElementById('login-btn')!;

function checkAuth() {
    const savedUser = localStorage.getItem('casual_game_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        loginScreen.classList.add('hidden');
        document.getElementById('ui-layer')!.classList.remove('hidden');
        connectSocket();
    } else {
        document.getElementById('ui-layer')!.classList.add('hidden');
    }
}

loginBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        currentUser = {
            id: 'user_' + Math.random().toString(36).substr(2, 9),
            name: name
        };
        localStorage.setItem('casual_game_user', JSON.stringify(currentUser));
        loginScreen.classList.add('hidden');
        document.getElementById('ui-layer')!.classList.remove('hidden');
        connectSocket();
    }
});

// UI Elements
const lobbyMenu = document.getElementById('lobby-menu')!;
const gameUi = document.getElementById('game-ui')!;
const roomInput = document.getElementById('room-id-input') as HTMLInputElement;
const createRoomBtn = document.getElementById('create-room-btn')!;
const joinRoomBtn = document.getElementById('join-room-btn')!;
const leaveRoomBtn = document.getElementById('leave-room-btn')!;
const changeNameBtn = document.getElementById('change-name-btn')!;
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
const charHealthInput = document.getElementById('char-health') as HTMLInputElement;
const charUrlInput = document.getElementById('char-url') as HTMLInputElement;
const charColorInput = document.getElementById('char-color') as HTMLInputElement;
const createCharBtn = document.getElementById('create-char-btn')!;


// Preload SVGs
const heartSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const skullSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"><path d="M12 2C6.48 2 2 6.48 2 12c0 2.21.72 4.25 1.93 5.92L2 22l4.08-1.93C7.75 21.28 9.79 22 12 22s4.25-.72 5.92-1.93L22 22l-1.93-4.08C21.28 16.25 22 14.21 22 12c0-5.52-4.48-10-10-10zm-3.5 13c-1.38 0-2.5-1.12-2.5-2.5S7.12 10 8.5 10s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zm7 0c-1.38 0-2.5-1.12-2.5-2.5S13.12 10 14.5 10s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';

async function preloadIcons() {
    await Assets.load({ alias: 'heart', src: heartSvg, format: 'svg', loadParser: 'loadSVG' });
    await Assets.load({ alias: 'skull', src: skullSvg, format: 'svg', loadParser: 'loadSVG' });
}

// Local state for UI
let isHost = false;
let isDragging = false;
let draggedToken: Container | null = null;
let dragOffset = { x: 0, y: 0 };
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
    await preloadIcons();
    document.getElementById('game-container')!.appendChild(app.canvas);

    worldContainer = new Container();
    gridContainer = new Container();
    highlightContainer = new Container();
    tokensContainer = new Container();
    tokensContainer.sortableChildren = true;

    worldContainer.addChild(gridContainer);
    worldContainer.addChild(highlightContainer);
    worldContainer.addChild(tokensContainer);

    // Add tooltip container
    tooltipContainer = new Container();
    tooltipContainer.zIndex = 2000;
    worldContainer.addChild(tooltipContainer);
    worldContainer.sortableChildren = true;
    app.stage.addChild(worldContainer);

    drawGrid();

    // UI listeners setup only once
    setupUIListeners();
    setupCameraControls();
    checkAuth();

    // Add interaction to stage to handle dropping outside tokens
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-100000, -100000, 200000, 200000);

// Host Drag and Drop Event Listeners

app.stage.on('pointermove', (e: any) => {
    if (isDragging && draggedToken) {
        const local = tokensContainer.toLocal(e.global);
        draggedToken.x = local.x + dragOffset.x;
        draggedToken.y = local.y + dragOffset.y;
    }
});

app.stage.on('pointerup', (e: any) => {
    if (isDragging && draggedToken) {
        isDragging = false;
        draggedToken.zIndex = 0;

        // Snap
        const newX = Math.floor((draggedToken.x + GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE;
        const newY = Math.floor((draggedToken.y + GRID_SIZE/2) / GRID_SIZE) * GRID_SIZE;

        const tokenId = (draggedToken as any).tokenId;
        const data = tokensDataMap.get(tokenId);
        if (data) {
            socket.emit('move_token', currentRoom, {
                id: tokenId,
                x: newX,
                y: newY,
                hasMoved: data.hasMoved // Preserve state
            });
        }
        draggedToken = null;
    }
});

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
        // Ignore right clicks for panning
        if (e.data && e.data.button === 2) return;
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

    app.stage.on('pointerup', (e) => stopPanning(e));
    app.stage.on('pointerupoutside', (e) => stopPanning(e));
}

// --- Grid Logic ---

function drawGrid() {
    gridContainer.removeChildren();
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

    // Check if right click (button 2)
    if (event.data && event.data.button === 2) return;

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
        updateTooltip();
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
    updateTooltip();
}

function handleStageClick(event: any) {
    const localPos = highlightContainer.toLocal(event.global);
    const clkGridX = Math.floor(localPos.x / GRID_SIZE);
    const clkGridY = Math.floor(localPos.y / GRID_SIZE);

    if (placementTemplate) {
        // Check if cell is occupied
        let occupied = false;
        for (const [, token] of tokensDataMap) {
            if (Math.floor(token.x / GRID_SIZE) === clkGridX && Math.floor(token.y / GRID_SIZE) === clkGridY) {
                occupied = true;
                break;
            }
        }

        if (!occupied) {
            spawnTokenFromTemplateAt(placementTemplate, placementType!, clkGridX, clkGridY);
            placementTemplate = null;
            placementType = null;
            app.canvas.style.cursor = 'default';
        }
        return;
    }

    if (!selectedTokenId) return;
    const _gridX = Math.floor(localPos.x / GRID_SIZE);
    const _gridY = Math.floor(localPos.y / GRID_SIZE);

    // Check if clicked cell is reachable
    const isReachable = reachableCells.some(cell => cell.x === clkGridX && cell.y === clkGridY);
    if (isReachable) {
        const targetX = clkGridX * GRID_SIZE;
        const targetY = clkGridY * GRID_SIZE;

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
async function createOrUpdateToken(data: any) { // using any locally for isHidden
    tokensDataMap.set(data.id, data);

    // Hide logic
    if (data.isHidden && !isHost) {
        const existing = tokenGraphicsMap.get(data.id);
        if (existing) {
            existing.visible = false;
        }
        return;
    }
    let tokenContainer = tokenGraphicsMap.get(data.id);
    let graphics: Graphics;
    let sprite: Sprite | undefined;

    if (!tokenContainer) {
        tokenContainer = new Container();
        tokenContainer.eventMode = 'static';
        tokenContainer.cursor = data.type === 'prop' || data.hasMoved ? 'default' : 'pointer';

        tokenContainer.on('pointerup', handleTokenClick);

        tokenContainer.on('pointerover', () => {
            hoveredTokenId = data.id;
            updateTooltip();
            // Force redraw to show color border change
            createOrUpdateToken(tokensDataMap.get(data.id)!);
        });
        tokenContainer.on('pointerout', () => {
            if (hoveredTokenId === data.id) hoveredTokenId = null;
            updateTooltip();
            // Force redraw
            createOrUpdateToken(tokensDataMap.get(data.id)!);
        });

        (tokenContainer as any).tokenId = data.id;

        graphics = new Graphics();
        graphics.label = 'bg'; // Using label instead of name for pixijs v8
        tokenContainer.addChild(graphics);

        // Host Drag logic inside token creation
        tokenContainer.on('pointerdown', (e: any) => {
            if (isHost && e.data.button === 0) {
                e.stopPropagation(); // Prevent panning the map
                isDragging = true;
                draggedToken = tokenContainer as Container;
                const local = tokensContainer.toLocal(e.global);
                dragOffset.x = tokenContainer!.x - local.x;
                dragOffset.y = tokenContainer!.y - local.y;
                tokenContainer!.zIndex = 1000;
            }
        });

        // Ensure tokens can emit context menu events (right click)
        tokenContainer.eventMode = 'static';


        tokensContainer.addChild(tokenContainer);
        tokenGraphicsMap.set(data.id, tokenContainer);

        // Try loading avatar if exists
        if (data.avatarUrl) {
            try {
                // Pre-load logic for SVGs, especially from dynamic APIs like Dicebear
                let loadAlias = data.avatarUrl;
                let loadOptions: any = data.avatarUrl;

                // If it's dicebear or looks like SVG without extension, give Pixi a hint
                if (data.avatarUrl.includes('dicebear') || data.avatarUrl.includes('svg')) {
                     loadOptions = {
                         src: data.avatarUrl,
                         format: 'svg',
                         loadParser: 'loadSVG'
                     };
                }

                const texture = await Assets.load(loadOptions);
                sprite = new Sprite(texture);
                sprite.label = 'avatar';
                sprite.anchor.set(0.5);
                sprite.position.set(GRID_SIZE / 2, GRID_SIZE / 2);

                const size = GRID_SIZE - 8;
                // Safe scaling
                if (sprite.texture.width > 0 && sprite.texture.height > 0) {
                    const scale = Math.max(size / sprite.texture.width, size / sprite.texture.height);
                    sprite.scale.set(scale);
                } else {
                    sprite.width = size;
                    sprite.height = size;
                }

                // Add circular mask
                const mask = new Graphics();
                mask.beginFill(0xffffff);
                mask.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, size / 2);
                mask.endFill();

                tokenContainer.addChild(mask);
                sprite.mask = mask;
                // Add sprite. But ensure border is above it if it exists.
                tokenContainer.addChildAt(sprite, 1); // 0 is bg
                // Also add mask to container (not strictly necessary but keeps hierarchy clean)
                tokenContainer.addChildAt(mask, 1);

                // If border was already added (since load is async), ensure it stays at top
                const borderChild = tokenContainer.getChildByLabel('border');
                if (borderChild) {
                    tokenContainer.setChildIndex(borderChild, tokenContainer.children.length - 1);
                }
            } catch (e) {
                console.warn('Failed to load avatar:', data.avatarUrl);
            }
        }

        // Ensure a top border layer is present to draw over the avatar
        let border = new Graphics();
        border.label = 'border';
        tokenContainer.addChild(border);
    } else {
        graphics = tokenContainer.getChildByLabel('bg') as Graphics;
        tokenContainer.cursor = data.type === 'prop' || data.hasMoved ? 'default' : 'pointer';
        tokenContainer.visible = true;
    }

    if (data.isHidden && isHost) {
        tokenContainer.alpha = 0.5; // Visual indicator for host
    } else {
        tokenContainer.alpha = 1;
    }

    // Base graphics (fill)
    graphics.clear();
    const radius = (GRID_SIZE / 2) - 4;

    let alpha = data.hasMoved ? 0.5 : 1;
    graphics.beginFill(data.color, alpha);

    if (data.type === 'prop') {
        graphics.drawRect(4, 4, GRID_SIZE - 8, GRID_SIZE - 8);
    } else {
        graphics.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    }
    graphics.endFill();

    // Border overlay
    const border = tokenContainer.getChildByLabel('border') as Graphics;
    border.clear();
    // For border use token's color, or yellow if selected, or gray if moved
    if (selectedTokenId === data.id) {
        border.lineStyle(4, 0xffaa00, 1);
    } else if (hoveredTokenId === data.id) {
        border.lineStyle(4, data.color, 1); // Hover state
    } else if (data.hasMoved) {
        border.lineStyle(2, 0x888888, 0.8);
    } else {
        border.lineStyle(2, data.color, 1); // Selected color border instead of black
    }

    if (data.type === 'prop') {
        border.drawRect(4, 4, GRID_SIZE - 8, GRID_SIZE - 8);
    } else {
        border.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    }

    tokenContainer.position.set(data.x, data.y);
}

// --- Socket & UI Listeners ---


function connectSocket() {
    if (socket) return;
    socket = io('http://localhost:3000', {
        auth: { userId: currentUser!.id, userName: currentUser!.name }
    });
    setupSocketListeners();
}



function updateTooltip() {
    tooltipContainer.removeChildren();

    // First update the health overlays directly on all tokens
    for (const [tokenId, container] of tokenGraphicsMap) {
        let healthOverlay = container.getChildByLabel('healthOverlay');
        const token = tokensDataMap.get(tokenId);

        // Remove existing overlay to rebuild it
        if (healthOverlay) {
            container.removeChild(healthOverlay);
            healthOverlay.destroy({ children: true });
        }

        // Only show if selected or hovered, and if it's a character
        if (token && token.type === 'character' && (hoveredTokenId === tokenId || selectedTokenId === tokenId)) {
            const charTemplate = roomCharacters.find(c => c.id === token.templateId);
            const maxHp = charTemplate ? (charTemplate.maxHealth || 10) : 10;
            const hp = token.currentHealth !== undefined ? token.currentHealth : maxHp;

            healthOverlay = new Container();
            healthOverlay.label = 'healthOverlay';

            const icon = new Sprite(hp <= 0 ? skullTexture : heartTexture);
            icon.width = 24;
            icon.height = 24;

            // Heart is red, skull is gray. SVG fills might handle this, but let's just use the loaded textures.
            healthOverlay.addChild(icon);

            const hpText = new Text(hp.toString(), new TextStyle({
                fontFamily: 'Arial',
                fontSize: 12,
                fill: '#ffffff',
                fontWeight: 'bold',
                align: 'center',
                stroke: '#000000',
                strokeThickness: 2
            }));

            // Center text inside icon
            hpText.anchor.set(0.5);
            hpText.position.set(12, 12);
            healthOverlay.addChild(hpText);

            // Bottom left of token
            healthOverlay.position.set(-8, GRID_SIZE - 16);
            healthOverlay.zIndex = 50; // Above border and avatar
            container.addChild(healthOverlay);
        }
    }

    const targetId = hoveredTokenId || selectedTokenId;
    if (!targetId) return;

    const token = tokensDataMap.get(targetId);
    if (!token) return;

    // Position floating name tooltip above the token
    const tooltip = new Container();

    let name = 'Prop';
    if (token.type === 'character') {
        const charTemplate = roomCharacters.find(c => c.id === token.templateId);
        if (charTemplate) name = charTemplate.name;
    } else {
        const propTemplate = roomProps.find(p => p.id === token.templateId);
        if (propTemplate) name = propTemplate.name;
    }

    const textStyle = new TextStyle({
        fontFamily: 'Arial',
        fontSize: 14,
        fill: '#ffffff',
        fontWeight: 'bold'
    });
    const text = new Text(escapeHtml(name), textStyle);

    // Background width based on text
    const bg = new Graphics();
    bg.beginFill(0x000000, 0.7);
    bg.drawRoundedRect(0, 0, text.width + 20, 30, 8);
    bg.endFill();
    tooltip.addChild(bg);

    text.position.set(10, (30 - text.height) / 2);
    tooltip.addChild(text);

    tooltip.position.set(token.x + GRID_SIZE / 2 - (text.width + 20)/2, token.y - 35);
    tooltipContainer.addChild(tooltip);
}


function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('room_created', (roomId: string, hostFlag: boolean) => {
        isHost = hostFlag;
        enterRoom(roomId);
        if (isHost) {
            document.getElementById('map-tab-btn')!.style.display = 'block';
        }
    });

    socket.on('room_joined', (roomId: string, state: any) => {
        enterRoom(roomId);
        isHost = state.isHost || false;
        roomCharacters = state.characters || [];
        if (isHost) {
            document.getElementById('map-tab-btn')!.style.display = 'block';
        }
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


const mapColsInput = document.getElementById('map-cols') as HTMLInputElement;
const mapRowsInput = document.getElementById('map-rows') as HTMLInputElement;
const updateMapBtn = document.getElementById('update-map-btn')!;

updateMapBtn.addEventListener('click', () => {
    if (!currentRoom || !isHost) return;
    const cols = parseInt(mapColsInput.value) || 20;
    const rows = parseInt(mapRowsInput.value) || 15;
    socket.emit('update_map', currentRoom, { cols, rows });
});

socket.on('map_updated', (mapData: {cols: number, rows: number}) => {
    COLS = mapData.cols;
    ROWS = mapData.rows;
    drawGrid();
});

    socket.on('character_updated', (characterData: CharacterTemplate) => {
        const idx = roomCharacters.findIndex(c => c.id === characterData.id);
        if (idx !== -1) {
            roomCharacters[idx] = characterData;
            renderCharacterList();
        }
    });

    socket.on('turn_ended', () => {
        tokensDataMap.forEach(token => {
            token.hasMoved = false;
            createOrUpdateToken(token); // Force redraw
        });
        deselectToken();
    });

// --- Context Menu Logic ---
const contextMenu = document.getElementById('context-menu')!;
let cmTargetTokenId: string | null = null;
let cmTargetCell: {x: number, y: number} | null = null;
let copiedTokenId: string | null = null;

app.canvas.addEventListener?.('contextmenu', (e: any) => {
    e.preventDefault();
    if (!isHost) return;

    const rect = (app.canvas as HTMLCanvasElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = worldContainer.toLocal({x: mouseX, y: mouseY});
    const cgX = Math.floor(worldPos.x / GRID_SIZE);
    const cgY = Math.floor(worldPos.y / GRID_SIZE);

    // Find if a token is at this location
    let targetToken = null;
    for (const [, token] of tokensDataMap) {
        if (Math.floor(token.x / GRID_SIZE) === cgX && Math.floor(token.y / GRID_SIZE) === cgY) {
            targetToken = token;
            break;
        }
    }

    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');

    if (targetToken) {
        cmTargetTokenId = targetToken.id;
        cmTargetCell = null;
        document.getElementById('cm-delete')!.classList.remove('hidden');
        document.getElementById('cm-copy')!.classList.remove('hidden');
        document.getElementById('cm-toggle-visibility')!.classList.remove('hidden');
        document.getElementById('cm-paste')!.classList.add('hidden');
        if (targetToken.type === 'character') {
            document.getElementById('cm-change-health')!.classList.remove('hidden');
        } else {
            document.getElementById('cm-change-health')!.classList.add('hidden');
        }
    } else {
        cmTargetTokenId = null;
        cmTargetCell = {x: cgX, y: cgY};
        document.getElementById('cm-delete')!.classList.add('hidden');
        document.getElementById('cm-copy')!.classList.add('hidden');
        document.getElementById('cm-toggle-visibility')!.classList.add('hidden');
        if (copiedTokenId) {
            document.getElementById('cm-paste')!.classList.remove('hidden');
        } else {
            document.getElementById('cm-paste')!.classList.add('hidden');
        }
        document.getElementById('cm-change-health')!.classList.add('hidden');
    }
});

// Hide context menu on click anywhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target as Node)) {
        contextMenu.classList.add('hidden');
    }
});

document.getElementById('cm-delete')!.addEventListener('click', () => {
    if (cmTargetTokenId && currentRoom) {
        socket.emit('delete_token', currentRoom, cmTargetTokenId);
    }
    contextMenu.classList.add('hidden');
});

document.getElementById('cm-copy')!.addEventListener('click', () => {
    if (cmTargetTokenId) {
        copiedTokenId = cmTargetTokenId;
    }
    contextMenu.classList.add('hidden');
});

document.getElementById('cm-paste')!.addEventListener('click', () => {
    if (copiedTokenId && cmTargetCell && currentRoom) {
        const templateToken = tokensDataMap.get(copiedTokenId);
        if (templateToken) {
            // Find template data
            let template = roomCharacters.find(c => c.id === templateToken.templateId) || roomProps.find(p => p.id === templateToken.templateId);
            if (template) {
               spawnTokenFromTemplateAt(template, templateToken.type, cmTargetCell.x, cmTargetCell.y);
            }
        }
    }
    contextMenu.classList.add('hidden');
});


document.getElementById('cm-change-health')!.addEventListener('click', () => {
    if (cmTargetTokenId && currentRoom) {
        const token = tokensDataMap.get(cmTargetTokenId);
        if (token && token.type === 'character') {
            const currentHp = token.currentHealth !== undefined ? token.currentHealth : 10;
            const newHpStr = prompt('Enter new health for ' + escapeHtml(token.id) + ':', currentHp.toString());
            if (newHpStr !== null) {
                const newHp = parseInt(newHpStr);
                if (!isNaN(newHp)) {
                    socket.emit('update_token', currentRoom, { id: cmTargetTokenId, currentHealth: newHp });
                }
            }
        }
    }
    contextMenu.classList.add('hidden');
});

document.getElementById('cm-toggle-visibility')!.addEventListener('click', () => {
    if (cmTargetTokenId && currentRoom) {
        const token = tokensDataMap.get(cmTargetTokenId);
        if (token) {
            const isHidden = (token as any).isHidden || false;
            socket.emit('update_token', currentRoom, { id: cmTargetTokenId, isHidden: !isHidden });
        }
    }
    contextMenu.classList.add('hidden');
});

// Add socket listener for deletes and updates
socket.on('token_deleted', (tokenId: string) => {
    const container = tokenGraphicsMap.get(tokenId);
    if (container) {
        container.destroy();
        tokenGraphicsMap.delete(tokenId);
        tokensDataMap.delete(tokenId);
    }
});

socket.on('token_updated', (tokenData: any) => {
    const existing = tokensDataMap.get(tokenData.id);
    if (existing) {
        const merged = { ...existing, ...tokenData };
        tokensDataMap.set(tokenData.id, merged);
        createOrUpdateToken(merged);
    }
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

    changeNameBtn.addEventListener('click', () => {
        localStorage.removeItem('casual_game_user');
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



const charModal = document.getElementById('character-modal')!;
const openCharModalBtn = document.getElementById('open-create-char-modal-btn')!;
const closeCharModalBtn = document.getElementById('close-char-modal-btn')!;
const saveCharBtn = document.getElementById('save-char-btn')!;
const charIdInput = document.getElementById('char-id') as HTMLInputElement;
const charModalTitle = document.getElementById('char-modal-title')!;

openCharModalBtn.addEventListener('click', () => {
    charModalTitle.textContent = 'Create Character';
    charIdInput.value = '';
    charNameInput.value = '';
    charSpeedInput.value = '3';
    charHealthInput.value = '10';
    charUrlInput.value = '';
    charColorInput.value = '#ff0000';
    charModal.classList.remove('hidden');
});

closeCharModalBtn.addEventListener('click', () => {
    charModal.classList.add('hidden');
});

saveCharBtn.addEventListener('click', () => {
    if (!currentRoom) return;

    const id = charIdInput.value;
    const name = charNameInput.value.trim() || 'Hero';
    const speed = parseInt(charSpeedInput.value) || 3;
    const maxHealth = parseInt(charHealthInput.value) || 10;
    const url = charUrlInput.value.trim();
    const colorStr = charColorInput.value.replace('#', '0x');
    const color = parseInt(colorStr, 16);

    const charData: CharacterTemplate = {
        id: id || ('char_' + Math.random().toString(36).substr(2, 9)),
        name,
        speed,
        color,
        avatarUrl: url || undefined,
        maxHealth
    };

    if (id) {
        socket.emit('update_character', currentRoom, charData);
    } else {
        socket.emit('create_character', currentRoom, charData);
    }

    charModal.classList.add('hidden');
});

// Update characterList render to include edit button
function escapeHtml(unsafe: string) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function renderCharacterList() {
    characterList.innerHTML = '';
    roomCharacters.forEach(char => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style.borderLeftColor = '#' + char.color.toString(16).padStart(6, '0');

        item.innerHTML = `
            <div class="list-item-info">
                <strong>${escapeHtml(char.name)}</strong>
                <small>Spd: ${char.speed} | HP: ${char.maxHealth || 10}</small>
            </div>
            <div class="list-item-actions">
                <button class="btn primary small spawn-char-btn" data-id="${char.id}">Spawn</button>
                <button class="btn secondary small edit-char-btn" data-id="${char.id}">Edit</button>
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
                placementTemplate = char;
                placementType = 'character';
                app.canvas.style.cursor = 'crosshair';
                deselectToken(); // clear selection while placing
            }
        });
    });

    document.querySelectorAll('.edit-char-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const charId = (e.currentTarget as HTMLElement).getAttribute('data-id');
            const char = roomCharacters.find(c => c.id === charId);
            if (char) {
                charModalTitle.textContent = 'Edit Character';
                charIdInput.value = char.id;
                charNameInput.value = char.name;
                charSpeedInput.value = char.speed.toString();
                charHealthInput.value = (char.maxHealth || 10).toString();
                charUrlInput.value = char.avatarUrl || '';
                charColorInput.value = '#' + char.color.toString(16).padStart(6, '0');
                charModal.classList.remove('hidden');
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
                <strong>${escapeHtml(prop.name)}</strong>
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
                placementTemplate = prop;
                placementType = 'prop';
                app.canvas.style.cursor = 'crosshair';
                deselectToken(); // clear selection while placing
            }
        });
    });
}

function spawnTokenFromTemplateAt(template: any, type: 'character' | 'prop', gridX: number, gridY: number) {

    let colorVal = 0xffffff;
    if (typeof template.color === 'number') {
        colorVal = template.color;
    } else if (typeof template.color === 'string') {
        colorVal = parseInt(template.color.replace('#', '0x'), 16);
    }

    const tokenData: TokenData = {
        id: 'inst_' + Math.random().toString(36).substr(2, 9),
        templateId: template.id,
        x: gridX * GRID_SIZE,
        y: gridY * GRID_SIZE,
        color: colorVal,
        speed: template.speed || 0,
        avatarUrl: template.avatarUrl,
        type: type,
        hasMoved: false,
        currentHealth: type === 'character' ? (template.maxHealth || 10) : undefined
    };

    socket.emit('spawn_token', currentRoom, tokenData);
}

// --- Animation Logic ---

function animateTokenMovement(partialData: Partial<TokenData> & { id: string, x: number, y: number }) {
    updateTooltip();
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

    // Increase z-index temporarily
    tokenGraphic.zIndex = 1000;

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
            tokenGraphic.zIndex = 0; // Restore z-index
            ticker.destroy();
            animatingTokens.delete(newTokenData.id);
            // Redraw to reset to clean state (stroke, exact position)
            createOrUpdateToken(newTokenData);
        }
    });

    ticker.start();
}
