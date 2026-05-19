const fs = require('fs');

// 1. Fix the server to emit back to the sender
let serverContent = fs.readFileSync('server/src/index.js', 'utf8');
serverContent = serverContent.replace(
`        rooms[roomId].tokens[index].x = tokenData.x;
        rooms[roomId].tokens[index].y = tokenData.y;
        socket.to(roomId).emit('token_moved', tokenData);`,
`        rooms[roomId].tokens[index].x = tokenData.x;
        rooms[roomId].tokens[index].y = tokenData.y;
        io.to(roomId).emit('token_moved', tokenData);`
);
fs.writeFileSync('server/src/index.js', serverContent);

// 2. Fix the client camera and pinch zoom
let clientContent = fs.readFileSync('client/src/main.ts', 'utf8');

// Fix app.view to app.canvas
clientContent = clientContent.replace(
`    app.view.addEventListener?.('wheel', (e: WheelEvent) => {`,
`    app.canvas.addEventListener?.('wheel', (e: WheelEvent) => {`
);

// Add touch pinch-to-zoom logic
const pinchLogic = `
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
`;

clientContent = clientContent.replace(
`    app.stage.on('pointerdown', (e) => {`,
    pinchLogic + `\n    app.stage.on('pointerdown', (e) => {`
);

fs.writeFileSync('client/src/main.ts', clientContent);
console.log("Fixes applied.");
