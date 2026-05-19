const fs = require('fs');

let content = fs.readFileSync('client/src/main.ts', 'utf8');

// Replace Top Variables
content = content.replace(
`// Global State
let socket: Socket;
let currentRoom: string | null = null;
let app: Application;
let worldContainer: Container;
let gridContainer: Container;
let tokensContainer: Container;
const tokenGraphicsMap = new Map<string, Graphics>();
let isDragging = false;
let draggedToken: Graphics | null = null;
let dragOffset = { x: 0, y: 0 };

// Camera / Pan & Zoom State
let isPanning = false;
let panStart = { x: 0, y: 0 };`,
`// Global State
let socket: Socket;
let currentRoom: string | null = null;
let app: Application;
let worldContainer: Container;
let gridContainer: Container;
let highlightContainer: Container;
let tokensContainer: Container;
const tokenGraphicsMap = new Map<string, Graphics>();
const tokensDataMap = new Map<string, TokenData>();

let selectedTokenId: string | null = null;
let reachableCells: {x: number, y: number}[] = [];

// Camera / Pan & Zoom State
let isPanning = false;
let panStart = { x: 0, y: 0 };
let hasMovedDuringPan = false;`
);

// Replace init() setup
content = content.replace(
`    worldContainer = new Container();
    gridContainer = new Container();
    tokensContainer = new Container();

    worldContainer.addChild(gridContainer);
    worldContainer.addChild(tokensContainer);
    app.stage.addChild(worldContainer);`,
`    worldContainer = new Container();
    gridContainer = new Container();
    highlightContainer = new Container();
    tokensContainer = new Container();

    worldContainer.addChild(gridContainer);
    worldContainer.addChild(highlightContainer);
    worldContainer.addChild(tokensContainer);
    app.stage.addChild(worldContainer);`
);

// Replace Camera Controls pointer events
content = content.replace(
`    app.stage.on('pointerdown', (e) => {
        // Only start panning if we didn't click on a token (or later, a specific game action)
        if (e.target === app.stage) {
            isPanning = true;
            panStart.x = e.global.x - worldContainer.x;
            panStart.y = e.global.y - worldContainer.y;
            app.canvas.style.cursor = 'grabbing';
        }
    });

    app.stage.on('pointermove', (e) => {
        if (isPanning) {
            worldContainer.x = e.global.x - panStart.x;
            worldContainer.y = e.global.y - panStart.y;
        }
    });

    const stopPanning = () => {
        if (isPanning) {
            isPanning = false;
            app.canvas.style.cursor = 'default';
        }
    };

    app.stage.on('pointerup', stopPanning);
    app.stage.on('pointerupoutside', stopPanning);`,
`    app.stage.on('pointerdown', (e) => {
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
    app.stage.on('pointerupoutside', stopPanning);`
);

// Replace pointerup drag handlers in init()
content = content.replace(
`    // Add interaction to stage to handle dropping outside tokens
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-100000, -100000, 200000, 200000);
    app.stage.on('pointerup', onDragEnd);
    app.stage.on('pointerupoutside', onDragEnd);`,
`    // Add interaction to stage to handle dropping outside tokens
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(-100000, -100000, 200000, 200000);`
);

// Replace entire token and drag drop logic block
const dragDropLogicPattern = /\/\/ --- Token Logic ---[\s\S]*?\/\/ --- Socket & UI Listeners ---/;
const replacementLogic = `// --- Selection & Pathfinding Logic ---

function handleTokenClick(event: any) {
    if (hasMovedDuringPan) return;

    const tokenId = event.currentTarget.tokenId;
    if (selectedTokenId === tokenId) {
        // Deselect
        deselectToken();
    } else {
        // Select
        selectedTokenId = tokenId;
        calculateReachableCells();
        drawHighlights();
        // Redraw all tokens to show selection
        for (const [id, data] of tokensDataMap) {
            createOrUpdateToken(data);
        }
    }
}

function deselectToken() {
    selectedTokenId = null;
    reachableCells = [];
    highlightContainer.removeChildren();
    // Redraw all tokens to remove selection
    for (const [id, data] of tokensDataMap) {
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

        // Emit move event immediately. Visuals updated by animation later.
        socket.emit('move_token', currentRoom, {
            id: selectedTokenId,
            x: targetX,
            y: targetY
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
    visited.add(\`\${startX},\${startY}\`);

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
                    const key = \`\${n.x},\${n.y}\`;
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
function createOrUpdateToken(data: TokenData) {
    tokensDataMap.set(data.id, data);
    let token = tokenGraphicsMap.get(data.id);

    if (!token) {
        token = new Graphics();
        token.eventMode = 'static';
        token.cursor = 'pointer';

        token.on('pointerup', handleTokenClick);

        // Custom property to store ID
        (token as any).tokenId = data.id;

        tokensContainer.addChild(token);
        tokenGraphicsMap.set(data.id, token);
    }

    // Draw/Redraw
    token.clear();
    token.beginFill(data.color);
    const radius = (GRID_SIZE / 2) - 4;
    token.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);
    token.endFill();

    if (selectedTokenId === data.id) {
        token.lineStyle(4, 0xffaa00, 1);
    } else {
        token.lineStyle(2, 0x000000, 0.5);
    }
    token.drawCircle(GRID_SIZE / 2, GRID_SIZE / 2, radius);

    token.position.set(data.x, data.y);
}

// --- Socket & UI Listeners ---`;
content = content.replace(dragDropLogicPattern, replacementLogic);

// Replace token_moved logic inside setupSocketListeners to not use draggedToken anymore
content = content.replace(
`    socket.on('token_moved', (tokenData: TokenData) => {
        // Only update if we aren't currently dragging this token
        if (draggedToken && (draggedToken as any).tokenId === tokenData.id) {
            return;
        }
        createOrUpdateToken(tokenData);
    });`,
`    socket.on('token_moved', (tokenData: TokenData) => {
        // For now, just update immediately. Animation will be implemented next step.
        createOrUpdateToken(tokenData);
    });`
);

fs.writeFileSync('client/src/main.ts', content);
console.log("Replaced successfully");
