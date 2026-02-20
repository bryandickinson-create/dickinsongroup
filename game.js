// =================================================================
//  FITNESS LANDSCAPE RUNNER — Easter Egg Game
//  Dickinson Group Lab Website
//  Unlock: type the reverse complement of 5'-ATGCGA-3' (TCGCAT)
// =================================================================
(function () {
    'use strict';

    // === CONSTANTS ===
    const SECRET_CODE = 'TCGCAT';
    const GRAVITY = 0.55;
    const JUMP_FORCE = -11;
    const BASE_SCROLL_SPEED = 3;
    const TERRAIN_SEGMENT_W = 4;
    const PLAYER_RADIUS = 16;
    const PLAYER_X_RATIO = 0.18;

    const COLORS = {
        player: '#5a9fa6',
        playerGlow: 'rgba(90, 159, 166, 0.35)',
        terrainTop: '#a82020',
        terrainBot: '#2a0000',
        terrainEdge: '#d44',
        obstacle: '#c43c3c',
        stopCodon: '#8b0000',
        degradation: '#cc5500',
        collectGood: '#0d8f65',
        collectGreat: '#a07d1e',
        dnaHelix: '#5a9fa6',
        bg: '#0d0d0d',
        bannerBg: 'rgba(90, 159, 166, 0.15)',
        bannerText: '#5a9fa6'
    };

    const GAME_OVER_MESSAGES = [
        "Lethal mutation detected. Evolution is harsh.",
        "Your protein was selected... against.",
        "Fitness: 0. Back to the primordial soup.",
        "The fitness landscape claimed another molecule.",
        "Truncated by a stop codon. Classic.",
        "Aggregated beyond rescue. GG.",
        "You've been outcompeted. Survival of the fittest.",
        "Degradation signal received. Proteasome inbound.",
        "Frame-shifted into oblivion.",
        "Negative selection is unforgiving.",
        "Your Kd was too high. Nature noticed.",
        "Lost in sequence space. Try a different trajectory."
    ];

    // === STATE ===
    let codeBuffer = '';
    let gameUnlocked = false;
    let gameActive = false;
    let gameRunning = false;
    let animFrameId = null;
    let lastTimestamp = 0;

    // Game objects
    let canvas, ctx;
    let gameWidth, gameHeight;
    let player, terrain, obstacles, collectibles, particles, floatingTexts;
    let scrollOffset, scrollSpeed;
    let generations, fitness, generationTimer;
    let shakeIntensity, shakeDuration;
    let activeBanner, bannerShown;
    let isMobile;

    // === SECRET CODE DETECTION ===
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Game controls when game is active
        if (gameActive) {
            if (e.code === 'Space' || e.code === 'ArrowUp') {
                e.preventDefault();
                if (gameRunning) jump();
            }
            if (e.code === 'Escape') {
                exitGame();
            }
            return;
        }

        // Secret code detection
        var key = e.key.toUpperCase();
        if (key.length === 1 && /[A-Z]/.test(key)) {
            codeBuffer += key;
            if (codeBuffer.length > SECRET_CODE.length) {
                codeBuffer = codeBuffer.slice(-SECRET_CODE.length);
            }
            if (codeBuffer === SECRET_CODE && !gameUnlocked) {
                gameUnlocked = true;
                playAccessGranted();
            }
        }
    });

    // === ACCESS GRANTED ANIMATION ===
    function playAccessGranted() {
        var overlay = document.getElementById('access-granted-overlay');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        setTimeout(function () {
            overlay.style.display = 'none';
            launchGame();
        }, 2200);
    }

    // === LAUNCH GAME ===
    function launchGame() {
        var overlay = document.getElementById('game-overlay');
        overlay.style.display = 'block';
        gameActive = true;

        canvas = document.getElementById('game-canvas');
        ctx = canvas.getContext('2d');
        isMobile = 'ontouchstart' in window;

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Touch / click handlers
        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('touchstart', onCanvasTouch, { passive: false });

        // Button handlers
        document.getElementById('game-start-btn').addEventListener('click', startGame);
        document.getElementById('game-restart-btn').addEventListener('click', startGame);
        document.getElementById('game-exit-btn').addEventListener('click', exitGame);

        // Show start screen
        document.getElementById('game-start-screen').style.display = 'flex';
        document.getElementById('game-over-screen').style.display = 'none';

        // Draw a preview background
        resetGameState();
        renderFrame();
    }

    function resizeCanvas() {
        var dpr = window.devicePixelRatio || 1;
        gameWidth = window.innerWidth;
        gameHeight = window.innerHeight;
        canvas.width = gameWidth * dpr;
        canvas.height = gameHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onCanvasClick() {
        if (gameRunning) jump();
    }

    function onCanvasTouch(e) {
        if (gameRunning) {
            e.preventDefault();
            jump();
        }
    }

    // === GAME STATE ===
    function resetGameState() {
        scrollOffset = 0;
        scrollSpeed = BASE_SCROLL_SPEED;
        generations = 0;
        fitness = 0;
        generationTimer = 0;
        shakeIntensity = 0;
        shakeDuration = 0;
        activeBanner = null;
        bannerShown = {};

        player = {
            x: gameWidth * PLAYER_X_RATIO,
            y: gameHeight * 0.4,
            vy: 0,
            radius: PLAYER_RADIUS,
            alive: true,
            glowTimer: 0,
            jumps: 0
        };

        // Generate initial terrain
        terrain = [];
        var numPoints = Math.ceil(gameWidth / TERRAIN_SEGMENT_W) + 200;
        for (var i = 0; i < numPoints; i++) {
            terrain.push(getTerrainY(i * TERRAIN_SEGMENT_W));
        }

        obstacles = [];
        collectibles = [];
        particles = [];
        floatingTexts = [];
    }

    function getTerrainY(worldX) {
        // Layered sine waves for organic fitness landscape
        var base = gameHeight * 0.7;
        var y = base
            - Math.sin(worldX * 0.002) * (gameHeight * 0.15)
            - Math.sin(worldX * 0.007 + 2.0) * (gameHeight * 0.08)
            - Math.sin(worldX * 0.018 + 5.0) * (gameHeight * 0.03)
            - Math.sin(worldX * 0.0008 + 1.0) * (gameHeight * 0.1);

        // Add difficulty: terrain gets more extreme over time
        var difficultyFactor = Math.min(scrollOffset * 0.00002, 0.08);
        y -= Math.sin(worldX * 0.012 + 3.0) * (gameHeight * difficultyFactor);

        return y;
    }

    function getTerrainHeightAtX(screenX) {
        var worldX = screenX + scrollOffset;
        var idx = Math.floor(worldX / TERRAIN_SEGMENT_W);
        if (idx < 0) idx = 0;
        if (idx >= terrain.length - 1) {
            // Generate more terrain
            while (terrain.length <= idx + 100) {
                terrain.push(getTerrainY(terrain.length * TERRAIN_SEGMENT_W));
            }
        }
        // Interpolate between two points
        var frac = (worldX / TERRAIN_SEGMENT_W) - idx;
        var y1 = terrain[idx] || gameHeight * 0.7;
        var y2 = terrain[idx + 1] || gameHeight * 0.7;
        return y1 + (y2 - y1) * frac;
    }

    // === START GAME ===
    function startGame() {
        document.getElementById('game-start-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'none';
        resetGameState();
        gameRunning = true;
        lastTimestamp = performance.now();
        animFrameId = requestAnimationFrame(gameLoop);
    }

    // === JUMP ===
    function jump() {
        if (!player.alive) return;
        player.vy = JUMP_FORCE;
        player.jumps++;
        player.glowTimer = 10;
        spawnParticles(player.x, player.y, COLORS.player, 8, 3, 25);
    }

    // === GAME LOOP ===
    function gameLoop(timestamp) {
        if (!gameRunning) return;

        var rawDt = (timestamp - lastTimestamp) / 16.67;
        var dt = Math.min(rawDt, 3);
        lastTimestamp = timestamp;

        update(dt);
        renderFrame();

        animFrameId = requestAnimationFrame(gameLoop);
    }

    // === UPDATE ===
    function update(dt) {
        if (!player.alive) return;

        // Scroll
        scrollSpeed = BASE_SCROLL_SPEED + Math.min(generations * 0.06, 3);
        scrollOffset += scrollSpeed * dt;

        // Ensure terrain is generated ahead
        var neededIdx = Math.ceil((gameWidth + scrollOffset + 400) / TERRAIN_SEGMENT_W);
        while (terrain.length <= neededIdx) {
            terrain.push(getTerrainY(terrain.length * TERRAIN_SEGMENT_W));
        }

        // Player physics
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;

        // Ceiling
        if (player.y - player.radius < 0) {
            player.y = player.radius;
            player.vy = 0;
        }

        // Glow timer
        if (player.glowTimer > 0) player.glowTimer -= dt;

        // Terrain collision
        var terrainY = getTerrainHeightAtX(player.x);
        if (player.y + player.radius >= terrainY) {
            die();
            return;
        }

        // Scoring
        generationTimer += dt;
        if (generationTimer >= 60) { // ~1 second at 60fps
            generationTimer -= 60;
            generations++;
            document.getElementById('game-score-value').textContent = generations;

            // Selection round banner
            if (generations % 10 === 0 && generations > 0 && !bannerShown[generations]) {
                bannerShown[generations] = true;
                activeBanner = {
                    text: '== SELECTION ROUND ' + (generations / 10) + ' ==',
                    timer: 0,
                    maxTimer: 120 // 2 seconds
                };
            }
        }
        fitness += 0.15 * dt;
        document.getElementById('game-fitness-value').textContent = Math.floor(fitness);

        // Spawn obstacles
        var spawnInterval = Math.max(80, 160 - generations * 3);
        if (Math.random() < (dt / spawnInterval)) {
            spawnObstacle();
        }

        // Spawn collectibles
        if (Math.random() < (dt / 300)) {
            spawnCollectible();
        }

        // Update obstacles
        for (var i = obstacles.length - 1; i >= 0; i--) {
            var obs = obstacles[i];
            obs.x -= scrollSpeed * dt;

            // Drift for degradation type
            if (obs.type === 'degradation') {
                obs.y += 0.3 * dt;
            }

            // Off screen
            if (obs.x + obs.size < -50) {
                obstacles.splice(i, 1);
                continue;
            }

            // Collision (circle vs circle)
            var dx = player.x - obs.x;
            var dy = player.y - obs.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < player.radius + obs.size * 0.4) {
                die();
                return;
            }
        }

        // Update collectibles
        for (var j = collectibles.length - 1; j >= 0; j--) {
            var col = collectibles[j];
            col.x -= scrollSpeed * dt;
            col.bobPhase += 0.05 * dt;

            if (col.x < -50) {
                collectibles.splice(j, 1);
                continue;
            }

            // Collection check
            var cdx = player.x - col.x;
            var cdy = player.y - (col.y + Math.sin(col.bobPhase) * 5);
            var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
            if (cdist < player.radius + 12) {
                var bonus = col.type === 'great' ? 100 : 50;
                fitness += bonus;
                var pColor = col.type === 'great' ? COLORS.collectGreat : COLORS.collectGood;
                spawnParticles(col.x, col.y, pColor, 12, 4, 30);
                floatingTexts.push({
                    x: col.x, y: col.y,
                    text: '+' + bonus,
                    color: pColor,
                    life: 50,
                    vy: -1.5
                });
                collectibles.splice(j, 1);
            }
        }

        // Update particles
        for (var k = particles.length - 1; k >= 0; k--) {
            var p = particles[k];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 0.08 * dt;
            p.life -= dt;
            if (p.life <= 0) particles.splice(k, 1);
        }

        // Update floating texts
        for (var m = floatingTexts.length - 1; m >= 0; m--) {
            var ft = floatingTexts[m];
            ft.y += ft.vy * dt;
            ft.life -= dt;
            if (ft.life <= 0) floatingTexts.splice(m, 1);
        }

        // Update banner
        if (activeBanner) {
            activeBanner.timer += dt;
            if (activeBanner.timer >= activeBanner.maxTimer) {
                activeBanner = null;
            }
        }

        // Screen shake decay
        if (shakeDuration > 0) {
            shakeDuration -= dt;
            shakeIntensity *= 0.94;
        }
    }

    // === SPAWNERS ===
    function spawnObstacle() {
        var types = ['misfolded'];
        if (generations >= 5) types.push('stopCodon');
        if (generations >= 15) types.push('degradation');

        var type = types[Math.floor(Math.random() * types.length)];
        var terrainY = getTerrainHeightAtX(gameWidth + 50);
        var minH = 50;
        var maxH = Math.min(terrainY - 80, gameHeight * 0.5);
        var y = terrainY - minH - Math.random() * (maxH - minH);

        obstacles.push({
            type: type,
            x: gameWidth + 50,
            y: y,
            size: 22 + Math.random() * 10
        });
    }

    function spawnCollectible() {
        var terrainY = getTerrainHeightAtX(gameWidth + 50);
        var y = terrainY - 80 - Math.random() * (gameHeight * 0.35);
        var type = Math.random() < 0.2 ? 'great' : 'good';

        collectibles.push({
            type: type,
            x: gameWidth + 50,
            y: y,
            bobPhase: Math.random() * Math.PI * 2
        });
    }

    function spawnParticles(x, y, color, count, speed, life) {
        var maxParticles = isMobile ? 40 : 80;
        for (var i = 0; i < count && particles.length < maxParticles; i++) {
            var angle = Math.random() * Math.PI * 2;
            var spd = (0.5 + Math.random()) * speed;
            particles.push({
                x: x, y: y,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd - 2,
                color: color,
                life: life * (0.5 + Math.random() * 0.5),
                maxLife: life,
                size: 2 + Math.random() * 3
            });
        }
    }

    // === DEATH ===
    function die() {
        player.alive = false;
        shakeIntensity = 14;
        shakeDuration = 25;
        spawnParticles(player.x, player.y, '#c43c3c', 20, 5, 40);

        setTimeout(function () {
            gameRunning = false;
            var msg = GAME_OVER_MESSAGES[Math.floor(Math.random() * GAME_OVER_MESSAGES.length)];
            document.getElementById('game-over-message').textContent = msg;
            document.getElementById('game-final-value').textContent = generations;
            document.getElementById('game-over-screen').style.display = 'flex';
        }, 600);
    }

    // === EXIT ===
    function exitGame() {
        gameRunning = false;
        gameActive = false;
        gameUnlocked = false;
        codeBuffer = '';
        if (animFrameId) cancelAnimationFrame(animFrameId);

        document.getElementById('game-overlay').style.display = 'none';
        document.body.style.overflow = '';

        // Clean up listeners
        if (canvas) {
            canvas.removeEventListener('click', onCanvasClick);
            canvas.removeEventListener('touchstart', onCanvasTouch);
        }
        window.removeEventListener('resize', resizeCanvas);
    }

    // === RENDER ===
    function renderFrame() {
        ctx.clearRect(0, 0, gameWidth, gameHeight);

        // Background
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, gameWidth, gameHeight);

        ctx.save();

        // Screen shake
        if (shakeDuration > 0) {
            var sx = (Math.random() - 0.5) * shakeIntensity;
            var sy = (Math.random() - 0.5) * shakeIntensity;
            ctx.translate(sx, sy);
        }

        drawDNABackground();
        drawTerrain();
        drawCollectibles();
        drawObstacles();
        drawPlayer();
        drawParticles();
        drawFloatingTexts();
        drawBanner();

        ctx.restore();
    }

    // === DRAW: DNA BACKGROUND ===
    function drawDNABackground() {
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.strokeStyle = COLORS.dnaHelix;
        ctx.lineWidth = 1.5;

        var amplitude = 35;
        var frequency = 0.012;
        var yCenter = gameHeight * 0.3;
        var off = scrollOffset * 0.3; // Parallax

        for (var strand = 0; strand < 2; strand++) {
            var phase = strand * Math.PI;
            ctx.beginPath();
            for (var x = -10; x <= gameWidth + 10; x += 3) {
                var worldX = x + off;
                var y = yCenter + Math.sin(worldX * frequency + phase) * amplitude;
                if (x === -10) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Rungs
        for (var rx = -10; rx <= gameWidth + 10; rx += 28) {
            var rwx = rx + off;
            var ry1 = yCenter + Math.sin(rwx * frequency) * amplitude;
            var ry2 = yCenter + Math.sin(rwx * frequency + Math.PI) * amplitude;
            ctx.beginPath();
            ctx.moveTo(rx, ry1);
            ctx.lineTo(rx, ry2);
            ctx.stroke();
        }

        ctx.restore();
    }

    // === DRAW: TERRAIN ===
    function drawTerrain() {
        // Filled terrain polygon
        var grad = ctx.createLinearGradient(0, gameHeight * 0.3, 0, gameHeight);
        grad.addColorStop(0, COLORS.terrainTop);
        grad.addColorStop(1, COLORS.terrainBot);
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.moveTo(0, gameHeight);

        for (var x = 0; x <= gameWidth; x += TERRAIN_SEGMENT_W) {
            var ty = getTerrainHeightAtX(x);
            ctx.lineTo(x, ty);
        }

        ctx.lineTo(gameWidth, gameHeight);
        ctx.closePath();
        ctx.fill();

        // Edge line
        ctx.beginPath();
        ctx.strokeStyle = COLORS.terrainEdge;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        for (var ex = 0; ex <= gameWidth; ex += TERRAIN_SEGMENT_W) {
            var ey = getTerrainHeightAtX(ex);
            if (ex === 0) ctx.moveTo(ex, ey);
            else ctx.lineTo(ex, ey);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // === DRAW: PLAYER ===
    function drawPlayer() {
        if (!player.alive && shakeDuration <= 0) return;

        var px = player.x;
        var py = player.y;
        var r = player.radius;

        // Glow
        var glowR = r * (player.glowTimer > 0 ? 3.5 : 2.5);
        var glow = ctx.createRadialGradient(px, py, r * 0.5, px, py, glowR);
        glow.addColorStop(0, player.glowTimer > 0 ? 'rgba(90, 159, 166, 0.5)' : COLORS.playerGlow);
        glow.addColorStop(1, 'rgba(90, 159, 166, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = COLORS.player;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();

        // Inner highlight
        var highlight = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
        highlight.addColorStop(0, 'rgba(255,255,255,0.25)');
        highlight.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px - 4, py - 3, 3.5, 0, Math.PI * 2);
        ctx.arc(px + 4, py - 3, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Pupils (look in direction of movement)
        var pupilOffset = Math.min(player.vy * 0.1, 1.5);
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(px - 3.5, py - 3 + pupilOffset, 1.8, 0, Math.PI * 2);
        ctx.arc(px + 4.5, py - 3 + pupilOffset, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }

    // === DRAW: OBSTACLES ===
    function drawObstacles() {
        for (var i = 0; i < obstacles.length; i++) {
            var obs = obstacles[i];
            var ox = obs.x;
            var oy = obs.y;
            var s = obs.size;

            ctx.save();
            ctx.translate(ox, oy);

            if (obs.type === 'misfolded') {
                // Tangled protein squiggle
                ctx.strokeStyle = COLORS.obstacle;
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(-s * 0.4, -s * 0.3);
                ctx.bezierCurveTo(-s * 0.1, -s * 0.6, s * 0.2, s * 0.4, s * 0.4, -s * 0.1);
                ctx.bezierCurveTo(s * 0.1, s * 0.3, -s * 0.3, -s * 0.1, -s * 0.2, s * 0.3);
                ctx.stroke();

                // Glow
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = COLORS.obstacle;
                ctx.beginPath();
                ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (obs.type === 'stopCodon') {
                // Red octagon
                ctx.fillStyle = COLORS.stopCodon;
                ctx.beginPath();
                var sides = 8;
                for (var si = 0; si < sides; si++) {
                    var angle = (Math.PI * 2 / sides) * si - Math.PI / 8;
                    var hx = Math.cos(angle) * s * 0.5;
                    var hy = Math.sin(angle) * s * 0.5;
                    if (si === 0) ctx.moveTo(hx, hy);
                    else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.fill();

                // Text
                ctx.fillStyle = '#fff';
                ctx.font = 'bold ' + Math.floor(s * 0.32) + 'px Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var codons = ['UAG', 'UAA', 'UGA'];
                ctx.fillText(codons[Math.floor(scrollOffset) % 3], 0, 1);
            } else if (obs.type === 'degradation') {
                // Downward arrow
                ctx.fillStyle = COLORS.degradation;
                ctx.beginPath();
                ctx.moveTo(0, s * 0.5);
                ctx.lineTo(-s * 0.4, 0);
                ctx.lineTo(-s * 0.15, 0);
                ctx.lineTo(-s * 0.15, -s * 0.5);
                ctx.lineTo(s * 0.15, -s * 0.5);
                ctx.lineTo(s * 0.15, 0);
                ctx.lineTo(s * 0.4, 0);
                ctx.closePath();
                ctx.fill();

                // Glow
                ctx.globalAlpha = 0.15;
                ctx.fillStyle = COLORS.degradation;
                ctx.beginPath();
                ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }
    }

    // === DRAW: COLLECTIBLES ===
    function drawCollectibles() {
        for (var i = 0; i < collectibles.length; i++) {
            var col = collectibles[i];
            var cx = col.x;
            var cy = col.y + Math.sin(col.bobPhase) * 5;
            var isGreat = col.type === 'great';
            var color = isGreat ? COLORS.collectGreat : COLORS.collectGood;
            var r = isGreat ? 10 : 8;

            // Glow
            ctx.save();
            ctx.globalAlpha = 0.3;
            var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
            glow.addColorStop(0, color);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Circle
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // + symbol
            ctx.fillStyle = '#fff';
            ctx.font = 'bold ' + (r * 1.2) + 'px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(isGreat ? '\u2605' : '+', cx, cy + 1);
        }
    }

    // === DRAW: PARTICLES ===
    function drawParticles() {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            var alpha = p.life / p.maxLife;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // === DRAW: FLOATING TEXTS ===
    function drawFloatingTexts() {
        for (var i = 0; i < floatingTexts.length; i++) {
            var ft = floatingTexts[i];
            var alpha = ft.life / 50;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = ft.color;
            ctx.font = 'bold 16px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
    }

    // === DRAW: SELECTION ROUND BANNER ===
    function drawBanner() {
        if (!activeBanner) return;

        var progress = activeBanner.timer / activeBanner.maxTimer;
        var alpha;
        if (progress < 0.2) alpha = progress / 0.2;
        else if (progress > 0.8) alpha = (1 - progress) / 0.2;
        else alpha = 1;

        ctx.save();
        ctx.globalAlpha = alpha * 0.9;

        // Background bar
        ctx.fillStyle = COLORS.bannerBg;
        ctx.fillRect(0, gameHeight * 0.4, gameWidth, 50);

        // Text
        ctx.fillStyle = COLORS.bannerText;
        ctx.font = 'bold 18px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(activeBanner.text, gameWidth / 2, gameHeight * 0.4 + 25);

        ctx.restore();
    }

})();
