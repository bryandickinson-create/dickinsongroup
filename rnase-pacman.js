// =================================================================
//  RNA DESTROYER — Easter Egg Pac-Man Game
//  Dickinson Group Lab Website
//  Unlock: type RNASE anywhere on the page
//
//  You are an RNase enzyme navigating the cell.
//  Eat RNA strands (dots) while avoiding RNase Inhibitors (ghosts).
//  Grab RNA hairpins (power pellets) to temporarily degrade the
//  inhibitors!
// =================================================================
(function () {
    'use strict';

    // === SECRET CODE ===
    var SECRET = 'RNASE';
    var codeBuffer = '';
    var unlocked = false;
    var active = false;
    var running = false;
    var paused = false;
    var animId = null;

    // === COLORS ===
    var WALL_COLOR = '#1a1a4e';
    var WALL_EDGE = '#4444cc';
    var PATH_COLOR = '#000000';
    var RNASE_BODY = '#c8aa1e';
    var RNASE_DARK = '#8a7510';
    var DOT_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f39c12'];
    var RNA_BASES = ['A', 'U', 'G', 'C'];
    var POWER_COLOR = '#ff69b4';
    var GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];
    var GHOST_NAMES = ['RI', 'SUPERase', 'RNasin', 'DEPC'];
    var FRIGHTENED_COLOR = '#2121de';
    var FRIGHTENED_FLASH = '#ffffff';
    var EYES_WHITE = '#ffffff';
    var EYES_PUPIL = '#222222';

    // === MAZE TEMPLATE ===
    // 0=dot, 1=wall, 2=empty, 3=power pellet, 4=ghost house, 5=ghost door
    var COLS = 21;
    var ROWS = 22;
    var MAZE_TEMPLATE = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1],
        [1,3,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,3,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,1,0,1],
        [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1],
        [1,1,1,1,1,0,1,1,1,2,1,2,1,1,1,0,1,1,1,1,1],
        [2,2,2,2,1,0,1,2,2,2,2,2,2,2,1,0,1,2,2,2,2],
        [1,1,1,1,1,0,1,2,1,1,5,1,1,2,1,0,1,1,1,1,1],
        [2,2,2,2,2,0,2,2,1,4,4,4,1,2,2,0,2,2,2,2,2],
        [1,1,1,1,1,0,1,2,1,1,1,1,1,2,1,0,1,1,1,1,1],
        [2,2,2,2,1,0,1,2,2,2,2,2,2,2,1,0,1,2,2,2,2],
        [1,1,1,1,1,0,1,2,1,1,1,1,1,2,1,0,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1],
        [1,3,0,0,1,0,0,0,0,0,2,0,0,0,0,0,1,0,0,3,1],
        [1,1,1,0,1,0,1,0,1,1,1,1,1,0,1,0,1,0,1,1,1],
        [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
    ];

    // Player start position (tile coords)
    var PLAYER_START_COL = 10;
    var PLAYER_START_ROW = 16;

    // Ghost start positions (inside ghost house)
    var GHOST_STARTS = [
        { col: 10, row: 10 },   // RI — starts outside house (above door)
        { col: 9,  row: 10 },   // SUPERase
        { col: 10, row: 10 },   // RNasin
        { col: 11, row: 10 }    // DEPC
    ];

    // Ghost scatter targets (corners)
    var SCATTER_TARGETS = [
        { col: COLS - 2, row: 1 },      // top-right
        { col: 1,        row: 1 },       // top-left
        { col: COLS - 2, row: ROWS - 2 },// bottom-right
        { col: 1,        row: ROWS - 2 } // bottom-left
    ];

    // Direction vectors: 0=right, 1=down, 2=left, 3=up
    var DX = [1, 0, -1, 0];
    var DY = [0, 1, 0, -1];

    // === GAME STATE ===
    var canvas, ctx, W, H, TS, OX, OY;
    var mobile;
    var listenersAdded = false;
    var maze;
    var player;
    var ghosts;
    var score, lives, level;
    var totalDots, dotsEaten;
    var ghostMode, modeTimer;
    var frightenedTimer, frightenedDuration;
    var ghostsEatenCombo;
    var mouthAngle, mouthDir;
    var dotBases;
    var readyTimer;
    var deathTimer;
    var deathAnimFrame;
    var levelCompleteTimer;
    var gameOver;
    var hiScore;
    var frameCount = 0;
    var scatterChaseCycle;

    // Mode timing (frames): [scatter, chase, scatter, chase, ...]
    var MODE_SCHEDULE = [420, 1200, 420, 1200, 300, 1200, 300, -1];

    // === SECRET CODE LISTENER ===
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (active) {
            if (running && !paused && !gameOver) {
                if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); player.nextDir = 0; }
                if (e.code === 'ArrowDown'  || e.code === 'KeyS') { e.preventDefault(); player.nextDir = 1; }
                if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { e.preventDefault(); player.nextDir = 2; }
                if (e.code === 'ArrowUp'    || e.code === 'KeyW') { e.preventDefault(); player.nextDir = 3; }
            }
            if (e.code === 'Escape') exitGame();
            return;
        }

        var key = e.key.toUpperCase();
        if (key.length === 1 && /[A-Z]/.test(key)) {
            codeBuffer += key;
            if (codeBuffer.length > SECRET.length) codeBuffer = codeBuffer.slice(-SECRET.length);
            if (codeBuffer === SECRET && !unlocked) { unlocked = true; playAccess(); }
        }
    });

    // === MOBILE UNLOCK: tap the RNA hint in the footer ===
    document.addEventListener('DOMContentLoaded', function () {
        var hint = document.querySelector('.rna-hint');
        if (!hint) return;
        var tapCount = 0;
        var tapTimer = null;
        hint.style.cursor = 'pointer';
        hint.addEventListener('click', function (e) {
            e.preventDefault();
            tapCount++;
            if (tapTimer) clearTimeout(tapTimer);
            tapTimer = setTimeout(function () { tapCount = 0; }, 800);
            if (tapCount >= 3 && !unlocked && !active) {
                tapCount = 0;
                unlocked = true;
                playAccess();
            }
        });
    });

    // === ACCESS GRANTED ANIMATION ===
    function playAccess() {
        var ov = document.getElementById('pacman-access-overlay');
        ov.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(function () { ov.style.display = 'none'; launch(); }, 2200);
    }

    // === LAUNCH ===
    function launch() {
        var overlay = document.getElementById('pacman-overlay');
        overlay.style.display = 'block';
        active = true;
        canvas = document.getElementById('pacman-canvas');
        ctx = canvas.getContext('2d');
        mobile = 'ontouchstart' in window;
        hiScore = parseInt(localStorage.getItem('rnase_highscore') || '0', 10);

        resize();
        window.addEventListener('resize', resize);

        if (!listenersAdded) {
            // Touch controls
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });

            document.getElementById('pacman-start-btn').addEventListener('click', startGame);
            document.getElementById('pacman-restart-btn').addEventListener('click', startGame);
            document.getElementById('pacman-exit-btn').addEventListener('click', exitGame);
            listenersAdded = true;
        }

        var hs = document.getElementById('pacman-highscore');
        if (hs) hs.textContent = hiScore > 0 ? 'BEST: ' + hiScore : '';

        document.getElementById('pacman-start-screen').style.display = 'flex';
        document.getElementById('pacman-over-screen').style.display = 'none';

        renderStartScreen();
    }

    function resize() {
        var dpr = window.devicePixelRatio || 1;
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Calculate tile size to fit maze
        TS = Math.floor(Math.min((W - 20) / COLS, (H - 80) / ROWS));
        if (TS < 8) TS = 8;
        OX = Math.floor((W - COLS * TS) / 2);
        OY = Math.floor((H - ROWS * TS) / 2) + 20;
    }

    // === TOUCH ===
    var touchStartX = 0, touchStartY = 0;
    function onTouchStart(e) {
        if (!running || paused || gameOver) return;
        e.preventDefault();
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
    }
    function onTouchMove(e) {
        if (!running || paused || gameOver) return;
        e.preventDefault();
        var t = e.touches[0];
        var dx = t.clientX - touchStartX;
        var dy = t.clientY - touchStartY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 20) {
            if (Math.abs(dx) > Math.abs(dy)) {
                player.nextDir = dx > 0 ? 0 : 2;
            } else {
                player.nextDir = dy > 0 ? 1 : 3;
            }
            touchStartX = t.clientX;
            touchStartY = t.clientY;
        }
    }

    // === EXIT ===
    function exitGame() {
        running = false;
        active = false;
        unlocked = false;
        codeBuffer = '';
        if (animId) cancelAnimationFrame(animId);
        document.getElementById('pacman-overlay').style.display = 'none';
        document.body.style.overflow = '';
        window.removeEventListener('resize', resize);
    }

    // === INIT MAZE ===
    function initMaze() {
        maze = [];
        dotBases = [];
        totalDots = 0;
        for (var r = 0; r < ROWS; r++) {
            maze[r] = [];
            dotBases[r] = [];
            for (var c = 0; c < COLS; c++) {
                var v = r < MAZE_TEMPLATE.length ? MAZE_TEMPLATE[r][c] : 1;
                maze[r][c] = v;
                // Assign a random RNA base to each dot/power pellet
                dotBases[r][c] = Math.floor(Math.random() * 4);
                if (v === 0 || v === 3) totalDots++;
            }
        }
        dotsEaten = 0;
    }

    // === TILE HELPERS ===
    function isWall(c, r) {
        if (r < 0 || r >= ROWS) return true;
        // Wrap horizontally for tunnel
        if (c < 0 || c >= COLS) return false;
        var t = maze[r][c];
        return t === 1;
    }

    function isPassable(c, r, isGhost, isLeaving) {
        // Handle tunnel wrap
        if (c < 0 || c >= COLS) return true;
        if (r < 0 || r >= ROWS) return false;
        var t = maze[r][c];
        if (t === 1) return false;
        if (t === 4) return isGhost;
        if (t === 5) return isGhost;
        return true;
    }

    // === INIT PLAYER ===
    function initPlayer() {
        player = {
            col: PLAYER_START_COL,
            row: PLAYER_START_ROW,
            px: PLAYER_START_COL * TS + TS / 2,
            py: PLAYER_START_ROW * TS + TS / 2,
            dir: 2,       // facing left
            nextDir: 2,
            speed: TS / 8,
            moving: false,
            alive: true
        };
    }

    // === INIT GHOSTS ===
    function initGhosts() {
        ghosts = [];
        for (var i = 0; i < 4; i++) {
            var g = GHOST_STARTS[i];
            ghosts.push({
                id: i,
                col: g.col,
                row: g.row,
                px: g.col * TS + TS / 2,
                py: g.row * TS + TS / 2,
                dir: 3,     // facing up
                speed: TS / 10,
                frightened: false,
                eaten: false,
                inHouse: i > 0,
                releaseTimer: i * 180,  // stagger releases
                exitingHouse: false
            });
        }
        // First ghost starts outside the house
        ghosts[0].inHouse = false;
        ghosts[0].row = 8;
        ghosts[0].py = 8 * TS + TS / 2;
        ghosts[0].releaseTimer = 0;
    }

    // === START GAME ===
    function startGame() {
        document.getElementById('pacman-start-screen').style.display = 'none';
        document.getElementById('pacman-over-screen').style.display = 'none';

        score = 0;
        lives = 3;
        level = 1;
        gameOver = false;
        frameCount = 0;

        initMaze();
        initPlayer();
        initGhosts();

        ghostMode = 'scatter';
        modeTimer = MODE_SCHEDULE[0];
        scatterChaseCycle = 0;
        frightenedTimer = 0;
        frightenedDuration = 480;
        ghostsEatenCombo = 0;
        mouthAngle = 0;
        mouthDir = 1;

        readyTimer = 120; // 2 seconds of "READY!" display
        deathTimer = 0;
        deathAnimFrame = 0;
        levelCompleteTimer = 0;

        running = true;
        updateHUD();
        loop();
    }

    // === MAIN LOOP ===
    function loop() {
        if (!running) return;
        animId = requestAnimationFrame(loop);
        frameCount++;

        if (levelCompleteTimer > 0) {
            levelCompleteTimer--;
            renderGame();
            if (levelCompleteTimer <= 0) {
                nextLevel();
            }
            return;
        }

        if (readyTimer > 0) {
            readyTimer--;
            renderGame();
            drawReadyText();
            return;
        }

        if (deathTimer > 0) {
            deathTimer--;
            deathAnimFrame++;
            renderGame();
            if (deathTimer <= 0) {
                if (lives <= 0) {
                    showGameOver();
                } else {
                    initPlayer();
                    initGhosts();
                    readyTimer = 120;
                }
            }
            return;
        }

        update();
        renderGame();
    }

    // === UPDATE ===
    function update() {
        // Mouth animation
        mouthAngle += 0.12 * mouthDir;
        if (mouthAngle > 0.9) mouthDir = -1;
        if (mouthAngle < 0.05) mouthDir = 1;

        // Move player
        movePlayer();

        // Check dot collection
        collectDots();

        // Update ghost mode timers
        updateGhostMode();

        // Move ghosts
        for (var i = 0; i < ghosts.length; i++) {
            moveGhost(ghosts[i]);
        }

        // Check collisions
        checkCollisions();

        // Check level complete
        if (dotsEaten >= totalDots) {
            levelCompleteTimer = 120;
        }
    }

    // === PLAYER MOVEMENT ===
    function movePlayer() {
        var p = player;
        if (!p.alive) return;

        var cx = p.col * TS + TS / 2;
        var cy = p.row * TS + TS / 2;

        // At tile center, check direction changes
        if (Math.abs(p.px - cx) < p.speed + 0.5 && Math.abs(p.py - cy) < p.speed + 0.5) {
            // Snap to center
            p.px = cx;
            p.py = cy;

            // Try the queued direction first
            var nc = p.col + DX[p.nextDir];
            var nr = p.row + DY[p.nextDir];
            if (isPassable(nc, nr, false, false)) {
                p.dir = p.nextDir;
            }

            // Check if current direction is passable
            var fc = p.col + DX[p.dir];
            var fr = p.row + DY[p.dir];
            if (!isPassable(fc, fr, false, false)) {
                p.moving = false;
                return;
            }
            p.moving = true;
        }

        if (!p.moving) return;

        // Move
        p.px += DX[p.dir] * p.speed;
        p.py += DY[p.dir] * p.speed;

        // Update tile position
        var newCol = Math.floor((p.px) / TS);
        var newRow = Math.floor((p.py) / TS);

        // Tunnel wrap
        if (p.px < -TS / 2) { p.px = COLS * TS - TS / 2; newCol = COLS - 1; }
        if (p.px > COLS * TS + TS / 2) { p.px = TS / 2; newCol = 0; }

        p.col = newCol;
        p.row = newRow;
    }

    // === DOT COLLECTION ===
    function collectDots() {
        var c = player.col;
        var r = player.row;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;

        var tile = maze[r][c];
        if (tile === 0) {
            maze[r][c] = 2;
            dotsEaten++;
            score += 10;
            updateHUD();
        } else if (tile === 3) {
            maze[r][c] = 2;
            dotsEaten++;
            score += 50;
            activateFrightened();
            updateHUD();
        }
    }

    // === FRIGHTENED MODE ===
    function activateFrightened() {
        frightenedTimer = frightenedDuration;
        ghostsEatenCombo = 0;
        for (var i = 0; i < ghosts.length; i++) {
            if (!ghosts[i].eaten) {
                ghosts[i].frightened = true;
                // Reverse direction
                ghosts[i].dir = (ghosts[i].dir + 2) % 4;
            }
        }
    }

    // === GHOST MODE ===
    function updateGhostMode() {
        if (frightenedTimer > 0) {
            frightenedTimer--;
            if (frightenedTimer <= 0) {
                for (var i = 0; i < ghosts.length; i++) {
                    ghosts[i].frightened = false;
                }
            }
            return;
        }

        modeTimer--;
        if (modeTimer <= 0) {
            scatterChaseCycle++;
            if (scatterChaseCycle < MODE_SCHEDULE.length) {
                var dur = MODE_SCHEDULE[scatterChaseCycle];
                if (dur === -1) {
                    ghostMode = 'chase';
                    modeTimer = 999999;
                } else {
                    ghostMode = scatterChaseCycle % 2 === 0 ? 'scatter' : 'chase';
                    modeTimer = dur;
                    // Reverse all ghost directions on mode change
                    for (var j = 0; j < ghosts.length; j++) {
                        if (!ghosts[j].frightened && !ghosts[j].inHouse) {
                            ghosts[j].dir = (ghosts[j].dir + 2) % 4;
                        }
                    }
                }
            }
        }
    }

    // === GHOST MOVEMENT ===
    function moveGhost(g) {
        // Handle ghost house release
        if (g.inHouse) {
            g.releaseTimer--;
            if (g.releaseTimer <= 0) {
                g.exitingHouse = true;
                g.inHouse = false;
            } else {
                // Bob up and down in house
                g.py += Math.sin(frameCount * 0.08 + g.id) * 0.5;
                return;
            }
        }

        // Exiting ghost house — move up to door then above it
        if (g.exitingHouse) {
            var doorX = 10 * TS + TS / 2;
            var doorY = 8 * TS + TS / 2;

            // First move horizontally to door column
            if (Math.abs(g.px - doorX) > 2) {
                g.px += (doorX > g.px ? 1 : -1) * g.speed;
                return;
            }
            g.px = doorX;

            // Then move up through door
            if (g.py > doorY) {
                g.py -= g.speed;
                return;
            }
            g.py = doorY;
            g.col = 10;
            g.row = 8;
            g.exitingHouse = false;
            g.dir = 2; // start going left
            return;
        }

        // If eaten, return to house
        if (g.eaten) {
            var houseX = 10 * TS + TS / 2;
            var houseY = 10 * TS + TS / 2;
            var dx = houseX - g.px;
            var dy = houseY - g.py;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < g.speed * 3) {
                g.px = houseX;
                g.py = houseY;
                g.col = 10;
                g.row = 10;
                g.eaten = false;
                g.frightened = false;
                g.inHouse = true;
                g.releaseTimer = 60;
                return;
            }
            // Move towards house at high speed
            g.px += (dx / dist) * g.speed * 3;
            g.py += (dy / dist) * g.speed * 3;
            g.col = Math.floor(g.px / TS);
            g.row = Math.floor(g.py / TS);
            return;
        }

        var cx = g.col * TS + TS / 2;
        var cy = g.row * TS + TS / 2;
        var spd = g.frightened ? g.speed * 0.5 : g.speed;

        // At tile center, choose direction
        if (Math.abs(g.px - cx) < spd + 0.5 && Math.abs(g.py - cy) < spd + 0.5) {
            g.px = cx;
            g.py = cy;

            var target = getGhostTarget(g);
            var bestDir = -1;
            var bestDist = Infinity;
            var reverse = (g.dir + 2) % 4;

            for (var d = 0; d < 4; d++) {
                if (d === reverse) continue; // ghosts can't reverse
                var nc = g.col + DX[d];
                var nr = g.row + DY[d];

                // Handle tunnel
                if (nc < 0) nc = COLS - 1;
                if (nc >= COLS) nc = 0;

                if (!isPassable(nc, nr, true, false)) continue;
                // Don't let ghosts re-enter house from above
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    if ((maze[nr][nc] === 4 || maze[nr][nc] === 5) && !g.inHouse) continue;
                }

                if (g.frightened) {
                    // Random direction when frightened
                    var dd = Math.random();
                    if (dd < bestDist) { bestDist = dd; bestDir = d; }
                } else {
                    var tdist = (nc - target.col) * (nc - target.col) + (nr - target.row) * (nr - target.row);
                    if (tdist < bestDist) { bestDist = tdist; bestDir = d; }
                }
            }

            if (bestDir >= 0) {
                g.dir = bestDir;
            }
        }

        // Move
        g.px += DX[g.dir] * spd;
        g.py += DY[g.dir] * spd;

        // Tunnel wrap
        if (g.px < -TS / 2) g.px = COLS * TS - TS / 2;
        if (g.px > COLS * TS + TS / 2) g.px = TS / 2;

        g.col = Math.floor(g.px / TS);
        g.row = Math.floor(g.py / TS);
        if (g.col < 0) g.col = 0;
        if (g.col >= COLS) g.col = COLS - 1;
    }

    // === GHOST TARGETING ===
    function getGhostTarget(g) {
        if (ghostMode === 'scatter' && frightenedTimer <= 0) {
            return SCATTER_TARGETS[g.id];
        }

        switch (g.id) {
            case 0: // RI (Blinky) — targets player directly
                return { col: player.col, row: player.row };
            case 1: // SUPERase (Pinky) — targets 4 tiles ahead of player
                return {
                    col: player.col + DX[player.dir] * 4,
                    row: player.row + DY[player.dir] * 4
                };
            case 2: // RNasin (Inky) — vector from Blinky through 2 tiles ahead of player, doubled
                var ahead2col = player.col + DX[player.dir] * 2;
                var ahead2row = player.row + DY[player.dir] * 2;
                return {
                    col: ahead2col + (ahead2col - ghosts[0].col),
                    row: ahead2row + (ahead2row - ghosts[0].row)
                };
            case 3: // DEPC (Clyde) — targets player if far, scatters if close
                var dc = player.col - g.col;
                var dr = player.row - g.row;
                if (dc * dc + dr * dr > 64) {
                    return { col: player.col, row: player.row };
                }
                return SCATTER_TARGETS[3];
            default:
                return { col: player.col, row: player.row };
        }
    }

    // === COLLISION DETECTION ===
    function checkCollisions() {
        for (var i = 0; i < ghosts.length; i++) {
            var g = ghosts[i];
            if (g.eaten || g.inHouse) continue;

            var dx = player.px - g.px;
            var dy = player.py - g.py;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < TS * 0.7) {
                if (g.frightened) {
                    // Eat the ghost!
                    g.eaten = true;
                    ghostsEatenCombo++;
                    var bonus = 200 * Math.pow(2, ghostsEatenCombo - 1);
                    score += bonus;
                    updateHUD();
                } else {
                    // Player dies
                    playerDeath();
                    return;
                }
            }
        }
    }

    // === PLAYER DEATH ===
    function playerDeath() {
        player.alive = false;
        lives--;
        deathTimer = 90;
        deathAnimFrame = 0;
        updateHUD();
    }

    // === NEXT LEVEL ===
    function nextLevel() {
        level++;
        initMaze();
        initPlayer();
        initGhosts();

        // Increase difficulty
        player.speed = TS / 8 + level * 0.3;
        for (var i = 0; i < ghosts.length; i++) {
            ghosts[i].speed = TS / 10 + level * 0.2;
        }
        frightenedDuration = Math.max(180, 480 - level * 40);

        ghostMode = 'scatter';
        modeTimer = MODE_SCHEDULE[0];
        scatterChaseCycle = 0;
        frightenedTimer = 0;
        readyTimer = 120;
        levelCompleteTimer = 0;

        updateHUD();
    }

    // === GAME OVER ===
    function showGameOver() {
        running = false;
        gameOver = true;

        if (score > hiScore) {
            hiScore = score;
            localStorage.setItem('rnase_highscore', String(hiScore));
        }

        document.getElementById('pacman-final-score').textContent = score;
        document.getElementById('pacman-final-level').textContent = level;
        document.getElementById('pacman-final-rna').textContent = dotsEaten;
        document.getElementById('pacman-over-highscore').textContent = score >= hiScore ? '★ NEW HIGH SCORE!' : 'BEST: ' + hiScore;
        document.getElementById('pacman-over-screen').style.display = 'flex';
    }

    // === HUD ===
    function updateHUD() {
        var el;
        el = document.getElementById('pacman-score-value');
        if (el) el.textContent = score;
        el = document.getElementById('pacman-level-value');
        if (el) el.textContent = level;
        el = document.getElementById('pacman-lives-value');
        if (el) el.textContent = '';
        // Draw lives as small RNase icons in the HUD
        if (el) {
            var txt = '';
            for (var i = 0; i < lives; i++) txt += '◉ ';
            el.textContent = txt.trim();
        }
    }

    // === RENDER ===
    function renderStartScreen() {
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, W, H);

        // Draw a preview of the maze dimly
        initMaze();
        ctx.save();
        ctx.translate(OX, OY);
        drawMaze(0.15);
        ctx.restore();
    }

    function renderGame() {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.translate(OX, OY);

        drawMaze(1);
        drawDots();

        // Draw ghosts
        for (var i = 0; i < ghosts.length; i++) {
            drawGhost(ghosts[i]);
        }

        // Draw player
        if (player.alive || deathTimer > 0) {
            drawPlayer();
        }

        ctx.restore();
    }

    // === DRAW MAZE ===
    function drawMaze(alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;

        for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
                var tile = maze[r] ? maze[r][c] : 1;
                var x = c * TS;
                var y = r * TS;

                if (tile === 1) {
                    // Draw wall
                    ctx.fillStyle = WALL_COLOR;
                    ctx.fillRect(x, y, TS, TS);

                    // Draw inner border for wall edges
                    ctx.strokeStyle = WALL_EDGE;
                    ctx.lineWidth = Math.max(1, TS / 12);

                    // Only draw edges that face a non-wall tile
                    var top    = (r > 0 && maze[r-1] && maze[r-1][c] !== 1);
                    var bottom = (r < ROWS-1 && maze[r+1] && maze[r+1][c] !== 1);
                    var left   = (c > 0 && maze[r][c-1] !== 1);
                    var right  = (c < COLS-1 && maze[r][c+1] !== 1);

                    // Also treat edges of the maze template that have '2' neighbors
                    if (r === 0) top = false;
                    if (r === ROWS - 1) bottom = false;

                    ctx.beginPath();
                    if (top) { ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TS, y + 0.5); }
                    if (bottom) { ctx.moveTo(x, y + TS - 0.5); ctx.lineTo(x + TS, y + TS - 0.5); }
                    if (left) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TS); }
                    if (right) { ctx.moveTo(x + TS - 0.5, y); ctx.lineTo(x + TS - 0.5, y + TS); }
                    ctx.stroke();
                } else if (tile === 5) {
                    // Ghost house door
                    ctx.fillStyle = '#ff88cc';
                    ctx.fillRect(x, y + TS * 0.4, TS, TS * 0.2);
                }
            }
        }

        ctx.restore();
    }

    // === DRAW DOTS ===
    function drawDots() {
        for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
                var tile = maze[r][c];
                var cx = c * TS + TS / 2;
                var cy = r * TS + TS / 2;
                var baseIdx = dotBases[r][c];

                if (tile === 0) {
                    // Small RNA nucleotide dot
                    var base = RNA_BASES[baseIdx];
                    var col = DOT_COLORS[baseIdx];
                    var dotSize = Math.max(6, TS * 0.28);

                    ctx.fillStyle = col;
                    ctx.font = 'bold ' + Math.round(dotSize) + 'px Courier New';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(base, cx, cy);
                } else if (tile === 3) {
                    // Power pellet — RNA hairpin structure
                    var pulse = Math.sin(frameCount * 0.08) * 0.3 + 0.7;
                    var hSize = Math.max(8, TS * 0.4);

                    ctx.save();
                    ctx.globalAlpha = pulse;
                    ctx.fillStyle = POWER_COLOR;
                    ctx.font = 'bold ' + Math.round(hSize * 1.4) + 'px Courier New';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('⌘', cx, cy);

                    // Glow
                    ctx.shadowColor = POWER_COLOR;
                    ctx.shadowBlur = 10;
                    ctx.beginPath();
                    ctx.arc(cx, cy, hSize * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.restore();
                }
            }
        }
    }

    // === DRAW PLAYER (RNase) ===
    function drawPlayer() {
        var p = player;

        ctx.save();
        ctx.translate(p.px, p.py);

        var r = TS * 0.45;
        var mouth = player.alive ? mouthAngle : Math.min(deathAnimFrame * 0.05, Math.PI);

        // Direction angle
        var angle = 0;
        if (p.dir === 0) angle = 0;
        else if (p.dir === 1) angle = Math.PI / 2;
        else if (p.dir === 2) angle = Math.PI;
        else if (p.dir === 3) angle = -Math.PI / 2;

        if (!player.alive) {
            // Death animation — mouth opens wide like dissolving
            ctx.globalAlpha = Math.max(0, 1 - deathAnimFrame / 90);
            ctx.fillStyle = RNASE_BODY;
            ctx.beginPath();
            ctx.arc(0, 0, r, angle + mouth, angle + Math.PI * 2 - mouth);
            ctx.lineTo(0, 0);
            ctx.closePath();
            ctx.fill();
        } else {
            // Body (Pac-Man shape)
            ctx.fillStyle = RNASE_BODY;
            ctx.beginPath();
            ctx.arc(0, 0, r, angle + mouth * 0.8, angle + Math.PI * 2 - mouth * 0.8);
            ctx.lineTo(0, 0);
            ctx.closePath();
            ctx.fill();

            // Darker edge for depth
            ctx.strokeStyle = RNASE_DARK;
            ctx.lineWidth = Math.max(1, TS / 16);
            ctx.beginPath();
            ctx.arc(0, 0, r, angle + mouth * 0.8, angle + Math.PI * 2 - mouth * 0.8);
            ctx.stroke();

            // Eye
            var eyeAngle = angle - Math.PI * 0.3;
            var eyeX = Math.cos(eyeAngle) * r * 0.45;
            var eyeY = Math.sin(eyeAngle) * r * 0.45;
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY, r * 0.15, 0, Math.PI * 2);
            ctx.fill();

            // Label "E" for enzyme (subtle)
            if (TS > 16) {
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.font = 'bold ' + Math.round(r * 0.6) + 'px Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var labelAngle = angle + Math.PI;
                var lx = Math.cos(labelAngle) * r * 0.15;
                var ly = Math.sin(labelAngle) * r * 0.15;
                ctx.fillText('E', lx, ly);
            }
        }

        ctx.restore();
    }

    // === DRAW GHOST (RNase Inhibitor) ===
    function drawGhost(g) {
        if (g.inHouse && g.releaseTimer > 60) return; // Don't draw until close to release

        ctx.save();
        ctx.translate(g.px, g.py);

        var r = TS * 0.43;
        var color;

        if (g.eaten) {
            // Just draw eyes when eaten
            drawGhostEyes(r, g.dir);
            ctx.restore();
            return;
        }

        if (g.frightened) {
            // Flashing when about to end
            if (frightenedTimer < 120 && Math.floor(frightenedTimer / 15) % 2 === 0) {
                color = FRIGHTENED_FLASH;
            } else {
                color = FRIGHTENED_COLOR;
            }
        } else {
            color = GHOST_COLORS[g.id];
        }

        // Ghost body — rounded top, wavy bottom
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r, Math.PI, 0);

        // Wavy bottom
        var baseY = r * 0.9;
        var wavePeriod = r / 2;
        var waveAmp = r * 0.25;
        var phase = frameCount * 0.15;

        ctx.lineTo(r, baseY);
        var steps = 6;
        for (var i = 0; i <= steps; i++) {
            var t = i / steps;
            var wx = r - t * r * 2;
            var wy = baseY + Math.sin(t * Math.PI * 3 + phase) * waveAmp;
            ctx.lineTo(-wx, wy);
        }
        ctx.closePath();
        ctx.fill();

        // Eyes
        if (!g.frightened) {
            drawGhostEyes(r, g.dir);
        } else {
            // Frightened face
            drawFrightenedFace(r);
        }

        // Name label (very small, below ghost)
        if (TS > 14 && !g.frightened) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = Math.max(6, Math.round(TS * 0.2)) + 'px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(GHOST_NAMES[g.id], 0, r + 2);
        }

        ctx.restore();
    }

    function drawGhostEyes(r, dir) {
        var eyeR = r * 0.28;
        var pupilR = r * 0.15;
        var eyeSpacing = r * 0.45;
        var eyeY = -r * 0.15;

        // Look direction offset
        var lookX = DX[dir] * pupilR * 0.5;
        var lookY = DY[dir] * pupilR * 0.5;

        for (var side = -1; side <= 1; side += 2) {
            var ex = side * eyeSpacing;
            // White
            ctx.fillStyle = EYES_WHITE;
            ctx.beginPath();
            ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.2, 0, 0, Math.PI * 2);
            ctx.fill();
            // Pupil
            ctx.fillStyle = EYES_PUPIL;
            ctx.beginPath();
            ctx.arc(ex + lookX, eyeY + lookY, pupilR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawFrightenedFace(r) {
        var eyeSize = r * 0.13;
        var eyeSpacing = r * 0.35;
        var eyeY = -r * 0.2;

        // Small white eyes
        ctx.fillStyle = '#fff';
        for (var side = -1; side <= 1; side += 2) {
            ctx.beginPath();
            ctx.arc(side * eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Wavy mouth
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath();
        var mouthY = r * 0.2;
        var mouthW = r * 0.6;
        for (var i = 0; i <= 4; i++) {
            var mx = -mouthW + (i / 4) * mouthW * 2;
            var my = mouthY + (i % 2 === 0 ? -r * 0.08 : r * 0.08);
            if (i === 0) ctx.moveTo(mx, my);
            else ctx.lineTo(mx, my);
        }
        ctx.stroke();
    }

    // === DRAW READY TEXT ===
    function drawReadyText() {
        ctx.save();
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold ' + Math.round(TS * 1.2) + 'px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('READY!', OX + COLS * TS / 2, OY + 13 * TS + TS / 2);
        ctx.restore();
    }

})();
