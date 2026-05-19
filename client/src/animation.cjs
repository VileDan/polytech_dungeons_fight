const fs = require('fs');
let content = fs.readFileSync('client/src/main.ts', 'utf8');

// We need Ticker from pixi.js
content = content.replace(
`import { Application, Graphics, Container, Rectangle } from 'pixi.js';`,
`import { Application, Graphics, Container, Rectangle, Ticker } from 'pixi.js';`
);

// We need to keep track of animating tokens
content = content.replace(
`const tokensDataMap = new Map<string, TokenData>();`,
`const tokensDataMap = new Map<string, TokenData>();
const animatingTokens = new Set<string>();`
);

// We need to replace socket.on('token_moved') logic
content = content.replace(
`    socket.on('token_moved', (tokenData: TokenData) => {
        // For now, just update immediately. Animation will be implemented next step.
        createOrUpdateToken(tokenData);
    });`,
`    socket.on('token_moved', (tokenData: TokenData) => {
        animateTokenMovement(tokenData);
    });`
);

// And we need to add the animation function at the end
const animFunction = `
// --- Animation Logic ---

function animateTokenMovement(newTokenData: TokenData) {
    const tokenGraphic = tokenGraphicsMap.get(newTokenData.id);
    if (!tokenGraphic) {
        createOrUpdateToken(newTokenData);
        return;
    }

    // Update data map immediately so logic sees it there
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

        tokenGraphic.position.set(currentX, currentY - jumpOffset);

        if (progress >= 1) {
            ticker.destroy();
            animatingTokens.delete(newTokenData.id);
            // Redraw to reset to clean state (stroke, exact position)
            createOrUpdateToken(newTokenData);
        }
    });

    ticker.start();
}
`;
content += animFunction;

fs.writeFileSync('client/src/main.ts', content);
console.log("Animation replaced successfully");
