// =================================================================
//  PEAK CLIMBER — Easter Egg Fitness Landscape Game
//  Dickinson Group Lab Website
//  Unlock: type the reverse complement of 5'-ATGCGA-3' (TCGCAT)
//
//  You are a protein navigating a fitness landscape.
//  Mutate left/right to climb peaks and gain fitness.
//  The landscape shifts during drift phases — race to the new
//  global maximum before selection pressure surges back!
//
//  Round structure:
//    DRIFT  → water drops, landscape shifts, race to new peak
//    PRESSURE → water surges up, survive on your peak
//    repeat with increasing difficulty
// =================================================================
(function () {
    'use strict';

    var SECRET = 'TCGCAT';

    // === COLORS ===
    var MAROON = '#800000';
    var TEAL = '#5a9fa6';
    var GREEN = '#0d8f65';
    var GOLD = '#a07d1e';
    var WARN = '#cc5500';
    var RED = '#c43c3c';
    var PURPLE = '#9b59b6';
    var BG_TOP = '#050508';
    var BG_BOT = '#0a0808';

    var DEATH_MSGS = [
        "Swallowed by the rising tide of selection.",
        "Stuck on a local maximum. The landscape moved on.",
        "Fitness valley too deep. No escape.",
        "Natural selection waits for no protein.",
        "Your adaptive walk ended in a dead end.",
        "The error catastrophe got you.",
        "Muller's ratchet strikes again.",
        "Epistasis was not in your favor.",
        "That valley was a fitness graveyard.",
        "The landscape shifted. You didn't.",
        "Selection pressure: overwhelming.",
        "You peaked too early.",
        "Trapped by a local optimum.",
        "The global maximum was the other way.",
        "Drift phase ended. You weren't ready.",
        "The fitness valley claimed another protein."
    ];

    // === GAME CONSTANTS ===
    var LANDSCAPE_POINTS = 200;
    var PLAYER_MOVE_BASE = 3;
    var GRAVITY = 0.15;
    var BOUNCE = 0.3;
    var LANDSCAPE_SHIFT_SPEED = 0.004;
    var PEAK_BONUS_RADIUS = 30;
    var LANDSCAPE_LERP_SPEED = 0.012;

    // === ROUND SYSTEM CONSTANTS ===
    // Round = DRIFT phase + PRESSURE phase
    var DRIFT_BASE_DURATION = 300;    // ~5 seconds at 60fps — time to reposition
    var PRESSURE_BASE_DURATION = 350; // ~5.8 seconds — survive the surge
    var DRIFT_MIN_DURATION = 120;     // Minimum drift time at high rounds
    var PRESSURE_MAX_DURATION = 600;  // Pressure phases get longer

    // === STATE ===
    var codeBuffer = '';
    var unlocked = false;
    var active = false;
    var running = false;
    var animId = null;
    var lastTime = 0;

    var canvas, ctx, W, H, mobile, hiScore;

    var player;
    var landscape;
    var waterLevel;
    var waterBaseLevel;
    var waterWavePhase;
    var score;
    var generation;
    var genTimer;
    var mutRate;
    var selPressure;
    var gameTime;

    var landscapeTime;
    var peaks;
    var epistasisZones;
    var landscapeTargets;
    var landscapeTransitioning;

    // Round system
    var roundNumber;         // Current round (starts at 1)
    var roundPhase;          // 'drift' or 'pressure'
    var phaseTimer;          // Countdown for current phase
    var phaseDuration;       // Total duration of current phase
    var waterDriftTarget;    // Where water drops to during drift
    var waterPressureTarget; // Where water surges to during pressure
    var roundBannerAlpha;    // Alpha for round/drift/pressure banner
    var roundBannerText;     // Text to show

    var keysDown;
    var moveDir;

    var particles, texts;
    var shakeAmt, shakeDur;
    var lastPeakX;
    var peaksClaimed;

    // === SECRET CODE ===
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (active) {
            if (running) {
                if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); moveDir = -1; }
                if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); moveDir = 1; }
                if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') { e.preventDefault(); jump(); }
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

    document.addEventListener('keyup', function (e) {
        if (!active || !running) return;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') {
            moveDir = 0;
        }
    });

    function playAccess() {
        var ov = document.getElementById('access-granted-overlay');
        ov.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(function () { ov.style.display = 'none'; launch(); }, 2200);
    }

    function launch() {
        document.getElementById('game-overlay').style.display = 'block';
        active = true;
        canvas = document.getElementById('game-canvas');
        ctx = canvas.getContext('2d');
        mobile = 'ontouchstart' in window;
        hiScore = parseInt(localStorage.getItem('peak_highscore') || '0', 10);

        resize();
        window.addEventListener('resize', resize);

        canvas.addEventListener('touchstart', onTouch, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });

        document.getElementById('game-start-btn').addEventListener('click', startGame);
        document.getElementById('game-restart-btn').addEventListener('click', startGame);
        document.getElementById('game-exit-btn').addEventListener('click', exitGame);

        var hs = document.getElementById('game-highscore');
        if (hs) hs.textContent = hiScore > 0 ? 'BEST: ' + hiScore : '';

        document.getElementById('game-start-screen').style.display = 'flex';
        document.getElementById('game-over-screen').style.display = 'none';

        reset();
        render();
    }

    function resize() {
        var dpr = window.devicePixelRatio || 1;
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Touch input
    var touchStartX = 0, touchStartY = 0, touchActive = false;
    function onTouch(e) {
        if (!running) return;
        e.preventDefault();
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchActive = true;
        jump();
    }
    function onTouchMove(e) {
        if (!running || !touchActive) return;
        e.preventDefault();
        var t = e.touches[0];
        var dx = t.clientX - touchStartX;
        if (Math.abs(dx) > 15) {
            moveDir = dx > 0 ? 1 : -1;
        } else {
            moveDir = 0;
        }
    }
    function onTouchEnd(e) {
        if (!running) return;
        touchActive = false;
        moveDir = 0;
    }

    // === RESET ===
    function reset() {
        keysDown = {};
        moveDir = 0;
        gameTime = 0;
        score = 0;
        generation = 0;
        genTimer = 0;
        mutRate = 0;
        selPressure = 0;
        particles = [];
        texts = [];
        shakeAmt = 0;
        shakeDur = 0;
        lastPeakX = -1;
        peaksClaimed = {};

        landscapeTime = 0;
        epistasisZones = [];
        landscapeTargets = [];
        landscapeTransitioning = false;

        // Round system — start with a generous drift phase
        roundNumber = 0;
        roundPhase = 'drift';
        phaseTimer = 0;
        phaseDuration = 0;
        roundBannerAlpha = 0;
        roundBannerText = '';

        // Generate landscape
        generateLandscape();

        // Water starts well below screen
        waterBaseLevel = H + 100;
        waterLevel = waterBaseLevel;
        waterWavePhase = 0;
        waterDriftTarget = H + 100;
        waterPressureTarget = H + 100;

        // Player starts on the highest peak (global max) — best starting position
        var startPeak = null;
        for (var sp = 0; sp < peaks.length; sp++) {
            if (peaks[sp].isGlobal) { startPeak = peaks[sp]; break; }
        }
        if (!startPeak) startPeak = peaks[Math.floor(peaks.length / 2)];
        var startX = startPeak ? startPeak.x : W / 2;
        var startHeight = getLandscapeHeight(startX);

        player = {
            x: startX,
            y: startHeight - 15,
            vy: 0,
            radius: 12,
            alive: true,
            glow: 0,
            onGround: true,
            jumpCooldown: 0,
            moveTrail: []
        };

        updateHUD();

        // Start first round after a brief warmup
        startDriftPhase();
    }

    // === ROUND SYSTEM ===
    function getDriftDuration() {
        // First drift is extra long (tutorial), then shortens each round
        if (roundNumber === 1) return 420; // ~7 seconds — learn the controls
        return Math.max(DRIFT_MIN_DURATION, DRIFT_BASE_DURATION - roundNumber * 18);
    }

    function getPressureDuration() {
        // Pressure phases get longer as rounds increase (survive longer)
        return Math.min(PRESSURE_MAX_DURATION, PRESSURE_BASE_DURATION + roundNumber * 20);
    }

    function getPressureHeight() {
        // How high water surges during pressure — gets more dangerous each round
        // Returns a Y value (lower = higher on screen = more dangerous)
        // Strategy: water should rise into valleys, then threaten peaks progressively
        var peakYs = [];
        for (var i = 0; i < peaks.length; i++) {
            peakYs.push(peaks[i].y);
        }
        peakYs.sort(function(a, b) { return a - b; }); // lowest Y = highest peak on screen

        var highestPeakY = peakYs[0] || H * 0.3;
        var secondPeakY = peakYs[Math.min(1, peakYs.length - 1)] || H * 0.5;
        var lowestPeakY = peakYs[peakYs.length - 1] || H * 0.6; // shortest peak

        // Difficulty progression:
        // Round 1-2: water rises into valleys but stays BELOW all peaks
        //            Target: just below the lowest/shortest peak (safe everywhere)
        // Round 3-4: water starts threatening the shortest peaks
        //            Target: between lowest and 2nd-highest peak
        // Round 5+:  water approaches the 2nd-highest, then creeps toward highest
        //            Target: between 2nd-highest and highest peak

        var target;
        var maxOsc = getMaxOscillation();

        if (roundNumber <= 2) {
            // Totally safe — water just peeks up at the very bottom of the screen
            // Even the deepest valley is safe. This is a tutorial phase.
            // Find the deepest valley (highest Y value in the landscape)
            var deepestValley = 0;
            for (var vi = 0; vi < landscape.length; vi++) {
                if (landscape[vi].y > deepestValley) deepestValley = landscape[vi].y;
            }
            // Water stays below even the deepest valley
            target = deepestValley + maxOsc + 30; // Below everything
            // But visible on screen
            target = Math.min(target, H * 0.95);
        } else if (roundNumber <= 4) {
            // Starting to threaten — water between lowest peak and 2nd peak
            var t = (roundNumber - 2) * 0.25; // 0.25 at r3, 0.5 at r4
            target = lowestPeakY + (secondPeakY - lowestPeakY) * t;
        } else {
            // Dangerous — water approaches 2nd peak, then creeps toward highest
            var t = Math.min((roundNumber - 4) * 0.1, 0.65); // 0.1, 0.2, 0.3... to 0.65
            target = secondPeakY + (highestPeakY - secondPeakY) * t;
        }

        // Safety buffer — the global maximum must ALWAYS be survivable
        // The buffer accounts for oscillation amplitude so waves don't splash over
        var buffer = maxOsc + 15;
        buffer = Math.max(buffer, 25);
        target = Math.max(target, highestPeakY + buffer);
        return target;
    }

    function getMaxOscillation() {
        // Calculate the maximum possible oscillation amplitude for the current round
        // (all sine waves peaking at the same time — worst case)
        var r = roundNumber;
        return (8 + r * 2) + (4 + r * 1.5) + (2 + r * 0.8);
    }

    function startDriftPhase() {
        roundNumber++;
        roundPhase = 'drift';
        phaseDuration = getDriftDuration();
        phaseTimer = phaseDuration;

        // Water target: drop down low to give breathing room
        waterDriftTarget = H + 30;

        // Shift the landscape — new peaks to find!
        if (roundNumber > 1) {
            generateNewLandscapeTargets();
        }

        // Reset peak claims
        peaksClaimed = {};

        // Banner
        roundBannerText = 'DRIFT!';
        roundBannerAlpha = 1.5; // Stays bright a bit longer

        // Generation counter
        generation = roundNumber;

        // Effects
        texts.push({ x: W / 2, y: H * 0.12, text: 'ROUND ' + roundNumber, color: TEAL, life: 90, vy: 0, size: 20 });
        texts.push({ x: W / 2, y: H * 0.12 + 28, text: 'Drift! Find the new peak!', color: '#fff', life: 75, vy: 0, size: 12 });
        if (roundNumber > 1) {
            spawnP(W * 0.3, H * 0.5, TEAL, 8, 2, 25);
            spawnP(W * 0.5, H * 0.5, GOLD, 8, 2, 25);
            spawnP(W * 0.7, H * 0.5, TEAL, 8, 2, 25);
        }
    }

    function startPressurePhase() {
        roundPhase = 'pressure';
        phaseDuration = getPressureDuration();
        phaseTimer = phaseDuration;

        // Calculate how high the water will surge
        waterPressureTarget = getPressureHeight();

        // Banner
        roundBannerText = 'SELECTION!';
        roundBannerAlpha = 1.5;

        // Effects
        texts.push({ x: W / 2, y: H * 0.12, text: 'SELECTION PRESSURE!', color: RED, life: 70, vy: 0, size: 18 });
        texts.push({ x: W / 2, y: H * 0.12 + 26, text: 'Survive on the peak!', color: '#fff', life: 55, vy: 0, size: 11 });
        spawnP(W * 0.3, waterLevel, RED, 6, 2, 20);
        spawnP(W * 0.7, waterLevel, RED, 6, 2, 20);
    }

    // === LANDSCAPE ===
    function generatePeakSet() {
        var numPeaks = 5 + Math.floor(Math.random() * 3);
        var peakPositions = [];
        for (var p = 0; p < numPeaks; p++) {
            peakPositions.push({
                x: W * 0.1 + (W * 0.8) * (p / (numPeaks - 1)) + (Math.random() - 0.5) * (W * 0.08),
                height: 0.3 + Math.random() * 0.5,
                width: 40 + Math.random() * 80
            });
        }
        return peakPositions;
    }

    function computeLandscapeY(peakPositions) {
        var result = [];
        for (var i = 0; i <= LANDSCAPE_POINTS; i++) {
            var x = (i / LANDSCAPE_POINTS) * W;
            var h = 0;
            for (var pi = 0; pi < peakPositions.length; pi++) {
                var pk = peakPositions[pi];
                var dist = (x - pk.x) / pk.width;
                h += pk.height * Math.exp(-dist * dist * 0.5);
            }
            h += Math.sin(x * 0.02) * 0.03;
            h += Math.sin(x * 0.05 + 1.5) * 0.02;
            var screenY = H - h * H * 0.7 - H * 0.08;
            result.push(screenY);
        }
        return result;
    }

    function generateLandscape() {
        landscape = [];
        peaks = [];

        var peakPositions = generatePeakSet();
        var yValues = computeLandscapeY(peakPositions);

        for (var i = 0; i <= LANDSCAPE_POINTS; i++) {
            var x = (i / LANDSCAPE_POINTS) * W;
            var screenY = yValues[i];
            var h = 1 - (screenY - H * 0.08) / (H * 0.7);
            landscape.push({ x: x, y: screenY, baseY: screenY, h: h });
        }

        landscapeTargets = [];
        for (var ti = 0; ti <= LANDSCAPE_POINTS; ti++) {
            landscapeTargets.push(landscape[ti].baseY);
        }

        findPeaksAndZones();
    }

    function generateNewLandscapeTargets() {
        var newPeaks = generatePeakSet();
        var newY = computeLandscapeY(newPeaks);
        landscapeTargets = newY;
        landscapeTransitioning = true;
    }

    function findPeaksAndZones() {
        peaks = [];
        for (var j = 2; j < landscape.length - 2; j++) {
            if (landscape[j].h > landscape[j - 1].h &&
                landscape[j].h > landscape[j + 1].h &&
                landscape[j].h > landscape[j - 2].h &&
                landscape[j].h > landscape[j + 2].h &&
                landscape[j].h > 0.25) {
                peaks.push({
                    x: landscape[j].x,
                    y: landscape[j].y,
                    h: landscape[j].h,
                    idx: j,
                    claimed: false,
                    isGlobal: false
                });
            }
        }

        if (peaks.length > 0) {
            var globalPeak = peaks[0];
            for (var g = 1; g < peaks.length; g++) {
                if (peaks[g].h > globalPeak.h) globalPeak = peaks[g];
            }
            globalPeak.isGlobal = true;
        }

        epistasisZones = [];
        if (peaks.length >= 2) {
            for (var ez = 0; ez < peaks.length - 1; ez++) {
                if (Math.random() < 0.4) {
                    var zx = (peaks[ez].x + peaks[ez + 1].x) / 2;
                    var zw = Math.abs(peaks[ez + 1].x - peaks[ez].x) * 0.3;
                    epistasisZones.push({
                        x: zx,
                        width: zw,
                        type: Math.random() < 0.5 ? 'bonus' : 'penalty',
                        alpha: 0.3
                    });
                }
            }
        }
    }

    function getLandscapeHeight(x) {
        var frac = (x / W) * LANDSCAPE_POINTS;
        var idx = Math.floor(frac);
        var t = frac - idx;
        idx = Math.max(0, Math.min(LANDSCAPE_POINTS - 1, idx));
        var next = Math.min(idx + 1, LANDSCAPE_POINTS);
        return landscape[idx].y * (1 - t) + landscape[next].y * t;
    }

    function getLandscapeFitness(x) {
        var frac = (x / W) * LANDSCAPE_POINTS;
        var idx = Math.floor(frac);
        var t = frac - idx;
        idx = Math.max(0, Math.min(LANDSCAPE_POINTS - 1, idx));
        var next = Math.min(idx + 1, LANDSCAPE_POINTS);
        return landscape[idx].h * (1 - t) + landscape[next].h * t;
    }

    // === JUMP ===
    function jump() {
        if (!player.alive || !player.onGround) return;
        if (player.jumpCooldown > 0) return;
        player.vy = -4.5;
        player.onGround = false;
        player.jumpCooldown = 15;
        spawnP(player.x, player.y + player.radius, TEAL, 6, 2, 15);
    }

    // === START ===
    function startGame() {
        document.getElementById('game-start-screen').style.display = 'none';
        document.getElementById('game-over-screen').style.display = 'none';
        reset();
        running = true;
        lastTime = performance.now();
        animId = requestAnimationFrame(loop);
    }

    function loop(ts) {
        if (!running) return;
        var dt = Math.min((ts - lastTime) / 16.67, 3);
        lastTime = ts;
        update(dt);
        render();
        animId = requestAnimationFrame(loop);
    }

    // === UPDATE ===
    function update(dt) {
        if (!player.alive) return;
        gameTime += dt;

        // Generation timer (for display purposes)
        genTimer += dt;
        if (genTimer >= 60) {
            genTimer -= 60;
        }

        // === ROUND PHASE SYSTEM ===
        phaseTimer -= dt;
        if (roundBannerAlpha > 0) roundBannerAlpha -= 0.015 * dt;

        if (roundPhase === 'drift') {
            // DRIFT PHASE: water drops, landscape shifts, player repositions
            // Water smoothly drops to drift target
            waterBaseLevel += (waterDriftTarget - waterBaseLevel) * 0.03 * dt;

            // When drift timer runs out, start pressure
            if (phaseTimer <= 0) {
                startPressurePhase();
            }

            // Warning as drift ends — countdown beeps
            if (phaseTimer < 90 && phaseTimer > 0) {
                var sec = Math.ceil(phaseTimer / 60);
                if (Math.floor(phaseTimer) % 60 === 0 && sec > 0 && sec <= 3) {
                    texts.push({ x: W / 2, y: H * 0.3, text: String(sec), color: WARN, life: 40, vy: -0.5, size: 24 });
                }
            }

        } else if (roundPhase === 'pressure') {
            // PRESSURE PHASE: water surges up toward target, must survive

            // Water rises toward pressure target — gradual early, urgent later
            var riseSpeed;
            if (roundNumber <= 2) {
                riseSpeed = 0.015 + roundNumber * 0.005; // 0.02, 0.025 — very slow early
            } else {
                riseSpeed = 0.03 + roundNumber * 0.006; // 0.048, 0.054, 0.06...
            }
            riseSpeed = Math.min(riseSpeed, 0.12);
            waterBaseLevel += (waterPressureTarget - waterBaseLevel) * riseSpeed * dt;

            // Add oscillation during pressure for tension — gets scarier each round
            // Round 1: ~12px, Round 3: ~18px, Round 5: ~25px, Round 8: ~35px
            // Smooth ramp — no cliff between rounds 2 and 3
            var oscBase = 8 + roundNumber * 2;      // slow swell: 10,12,14,16...
            var oscMid = 4 + roundNumber * 1.5;     // medium wave: 5.5,7,8.5,10...
            var oscFast = 2 + roundNumber * 0.8;    // fast ripple: 2.8,3.6,4.4,5.2...
            var pressureOsc = Math.sin(gameTime * 0.06) * oscBase;
            pressureOsc += Math.sin(gameTime * 0.15) * oscMid;
            pressureOsc += Math.sin(gameTime * 0.31) * oscFast;
            waterLevel = waterBaseLevel + pressureOsc;

            // When pressure timer runs out, start next drift
            if (phaseTimer <= 0) {
                // Survived! Bonus points
                var survivalBonus = 25 + roundNumber * 10;
                score += survivalBonus;
                texts.push({ x: W / 2, y: H * 0.25, text: 'SURVIVED! +' + survivalBonus, color: GREEN, life: 60, vy: -0.5, size: 16 });
                spawnP(player.x, player.y, GREEN, 12, 3, 25);

                startDriftPhase();
            }
        }

        // === LANDSCAPE MORPHING ===
        if (landscapeTransitioning) {
            var lerpSpeed = LANDSCAPE_LERP_SPEED * dt * (1 + roundNumber * 0.02);
            var allClose = true;
            for (var li = 0; li <= LANDSCAPE_POINTS; li++) {
                var diff = landscapeTargets[li] - landscape[li].baseY;
                if (Math.abs(diff) > 0.5) {
                    landscape[li].baseY += diff * lerpSpeed;
                    allClose = false;
                } else {
                    landscape[li].baseY = landscapeTargets[li];
                }
            }
            if (allClose) {
                landscapeTransitioning = false;
                findPeaksAndZones();
            }
        }

        // Small visual wobble
        landscapeTime += LANDSCAPE_SHIFT_SPEED * dt;
        for (var lw = 0; lw <= LANDSCAPE_POINTS; lw++) {
            var morph = Math.sin(landscapeTime + lw * 0.03) * 6 +
                        Math.sin(landscapeTime * 0.7 + lw * 0.05) * 4;
            landscape[lw].y = landscape[lw].baseY + morph;
        }

        // Recalculate h values
        for (var lj = 0; lj <= LANDSCAPE_POINTS; lj++) {
            landscape[lj].h = 1 - (landscape[lj].y - H * 0.08) / (H * 0.7);
        }

        // Refresh peaks during transitions
        if (landscapeTransitioning && Math.floor(gameTime) % 30 === 0) {
            findPeaksAndZones();
        }

        // Update peak display positions
        for (var pk = 0; pk < peaks.length; pk++) {
            var pidx = peaks[pk].idx;
            if (pidx >= 0 && pidx < landscape.length) {
                peaks[pk].y = landscape[pidx].y;
                peaks[pk].h = landscape[pidx].h;
            }
        }

        // === PLAYER MOVEMENT ===
        var moveSpeed = PLAYER_MOVE_BASE + mutRate * 4;
        if (moveDir !== 0) {
            player.x += moveDir * moveSpeed * dt;
            if (gameTime % 3 < 1) {
                player.moveTrail.push({ x: player.x, y: player.y, life: 20 });
            }
        }

        // Wrap around (sequence space is circular)
        if (player.x < 0) player.x = W;
        if (player.x > W) player.x = 0;

        // Gravity
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;

        // Collide with landscape
        var groundY = getLandscapeHeight(player.x);
        if (player.y + player.radius >= groundY) {
            player.y = groundY - player.radius;
            if (player.vy > 0) {
                player.vy = -player.vy * BOUNCE;
                if (Math.abs(player.vy) < 0.5) player.vy = 0;
            }
            player.onGround = true;
        } else {
            player.onGround = false;
        }

        if (player.jumpCooldown > 0) player.jumpCooldown -= dt;
        if (player.glow > 0) player.glow -= dt;

        // Trail decay
        for (var ti = player.moveTrail.length - 1; ti >= 0; ti--) {
            player.moveTrail[ti].life -= dt;
            if (player.moveTrail[ti].life <= 0) player.moveTrail.splice(ti, 1);
        }

        // === MUTATION RATE ===
        var playerSpeed = Math.abs(moveDir * moveSpeed);
        var targetMutRate = Math.min(playerSpeed / (PLAYER_MOVE_BASE + 4), 1);
        mutRate += (targetMutRate - mutRate) * 0.05 * dt;

        // === WATER LEVEL ===
        // During drift, water base is smoothly dropping (handled above)
        // During pressure, water base is rising (handled above)
        // Add gentle wave on top for visual interest (except pressure which has its own osc)
        waterWavePhase += 0.025 * dt;
        if (roundPhase === 'drift') {
            var driftWave = Math.sin(waterWavePhase) * 8 +
                            Math.sin(waterWavePhase * 2.3) * 4;
            waterLevel = waterBaseLevel + driftWave;
        }
        // (pressure phase sets waterLevel above with its own oscillation)

        // Selection pressure display based on proximity
        var waterDist = waterLevel - player.y;
        selPressure = Math.max(0, Math.min(1, 1 - waterDist / (H * 0.4)));

        // === SCORING ===
        var currentFitness = getLandscapeFitness(player.x);
        score += currentFitness * 0.08 * dt;

        // Peak claims
        for (var pi = 0; pi < peaks.length; pi++) {
            var peak = peaks[pi];
            var distToPeak = Math.abs(player.x - peak.x);
            if (distToPeak < PEAK_BONUS_RADIUS && !peaksClaimed[pi]) {
                peaksClaimed[pi] = true;
                var peakBonus = peak.isGlobal ? 100 : 40;
                score += peakBonus;
                var label = peak.isGlobal ? 'GLOBAL MAXIMUM!' : 'Local Maximum!';
                var col = peak.isGlobal ? GOLD : GREEN;
                texts.push({ x: peak.x, y: peak.y - 40, text: label, color: col, life: 60, vy: -1, size: peak.isGlobal ? 16 : 13 });
                texts.push({ x: peak.x, y: peak.y - 22, text: '+' + peakBonus, color: col, life: 50, vy: -1, size: 14 });
                spawnP(peak.x, peak.y, col, 12, 3, 25);
                player.glow = 20;

                if (peak.isGlobal) {
                    texts.push({ x: peak.x, y: peak.y - 5, text: 'Best position for selection!', color: TEAL, life: 50, vy: -0.8, size: 10 });
                }
            }
        }

        // === EPISTASIS ZONES ===
        for (var ei = 0; ei < epistasisZones.length; ei++) {
            var ez = epistasisZones[ei];
            if (Math.abs(player.x - ez.x) < ez.width / 2 && player.onGround) {
                if (ez.type === 'bonus' && Math.random() < 0.02 * dt) {
                    score += 15;
                    texts.push({ x: player.x, y: player.y - 25, text: 'Epistatic Boost!', color: PURPLE, life: 40, vy: -1, size: 11 });
                    spawnP(player.x, player.y, PURPLE, 6, 2, 20);
                } else if (ez.type === 'penalty' && Math.random() < 0.015 * dt) {
                    moveDir = 0;
                    player.vy -= 1;
                    texts.push({ x: player.x, y: player.y - 25, text: 'Epistatic Friction!', color: RED, life: 40, vy: -1, size: 11 });
                    spawnP(player.x, player.y, RED, 6, 2, 20);
                }
            }
        }

        // === DEATH CHECK ===
        if (player.y + player.radius > waterLevel) {
            die();
            return;
        }

        // Update effects
        for (var pti = particles.length - 1; pti >= 0; pti--) {
            var p = particles[pti];
            p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
            if (p.life <= 0) particles.splice(pti, 1);
        }
        for (var fi = texts.length - 1; fi >= 0; fi--) {
            var ft = texts[fi];
            ft.y += ft.vy * dt; ft.life -= dt;
            if (ft.life <= 0) texts.splice(fi, 1);
        }
        if (shakeDur > 0) { shakeDur -= dt; shakeAmt *= 0.92; }

        updateHUD();
    }

    // === DEATH ===
    function die() {
        player.alive = false;
        shakeAmt = 14; shakeDur = 30;
        spawnP(player.x, player.y, RED, 25, 5, 40);
        spawnP(player.x, player.y, '#fff', 8, 3, 20);

        var finalScore = Math.floor(score);
        if (finalScore > hiScore) {
            hiScore = finalScore;
            localStorage.setItem('peak_highscore', String(hiScore));
        }

        setTimeout(function () {
            running = false;
            document.getElementById('game-over-message').textContent = DEATH_MSGS[Math.floor(Math.random() * DEATH_MSGS.length)];
            document.getElementById('game-final-gen').textContent = roundNumber;
            document.getElementById('game-final-fitness').textContent = finalScore;
            document.getElementById('game-final-mutrate').textContent = (mutRate * 100).toFixed(0) + '%';
            document.getElementById('game-final-selpress').textContent = (selPressure * 100).toFixed(0) + '%';
            var hs = document.getElementById('game-over-highscore');
            if (hs) {
                if (finalScore >= hiScore) { hs.textContent = 'NEW BEST!'; hs.style.color = GOLD; }
                else { hs.textContent = 'BEST: ' + hiScore; hs.style.color = 'rgba(255,255,255,0.4)'; }
            }
            document.getElementById('game-over-screen').style.display = 'flex';
        }, 700);
    }

    function exitGame() {
        running = false; active = false; unlocked = false; codeBuffer = '';
        if (animId) cancelAnimationFrame(animId);
        document.getElementById('game-overlay').style.display = 'none';
        document.body.style.overflow = '';
        if (canvas) {
            canvas.removeEventListener('touchstart', onTouch);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
        }
        window.removeEventListener('resize', resize);
    }

    // === HUD ===
    function updateHUD() {
        var el;
        el = document.getElementById('game-score-value'); if (el) el.textContent = roundNumber;
        el = document.getElementById('game-fitness-value'); if (el) el.textContent = Math.floor(score);
        el = document.getElementById('game-mutrate-value');
        if (el) {
            el.textContent = (mutRate * 100).toFixed(0) + '%';
            el.style.color = mutRate < 0.4 ? GREEN : mutRate < 0.7 ? GOLD : RED;
        }
        el = document.getElementById('game-selpress-value');
        if (el) {
            el.textContent = (selPressure * 100).toFixed(0) + '%';
            el.style.color = selPressure < 0.35 ? TEAL : selPressure < 0.65 ? WARN : RED;
        }
    }

    // === PARTICLES ===
    function spawnP(x, y, color, count, spd, life) {
        var max = mobile ? 60 : 150;
        for (var i = 0; i < count && particles.length < max; i++) {
            var a = Math.random() * Math.PI * 2;
            var s = (0.5 + Math.random()) * spd;
            particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color: color, life: life * (0.5 + Math.random() * 0.5), maxLife: life, size: 1.5 + Math.random() * 3 });
        }
    }

    // === RENDER ===
    function render() {
        ctx.clearRect(0, 0, W, H);

        var bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, BG_TOP); bg.addColorStop(1, BG_BOT);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        ctx.save();
        if (shakeDur > 0) ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);

        drawStars();
        drawEpistasisZones();
        drawLandscape();
        drawPeakMarkers();
        drawWater();
        drawPlayerTrail();
        drawPlayerChar();
        drawParticlesR();
        drawTextsR();
        drawBars();
        drawPhaseBanner();
        drawPhaseTimer();

        ctx.restore();
    }

    // === DRAW: STARS ===
    function drawStars() {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (var i = 0; i < 40; i++) {
            var sx = ((i * 137.5) % W);
            var sy = ((i * 97.3) % (H * 0.5));
            var sz = 0.5 + (i % 3) * 0.5;
            ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2); ctx.fill();
        }
    }

    // === DRAW: EPISTASIS ZONES ===
    function drawEpistasisZones() {
        for (var i = 0; i < epistasisZones.length; i++) {
            var ez = epistasisZones[i];
            ctx.save();
            ctx.globalAlpha = 0.06;
            ctx.fillStyle = ez.type === 'bonus' ? PURPLE : RED;
            ctx.fillRect(ez.x - ez.width / 2, 0, ez.width, H);
            ctx.restore();

            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = ez.type === 'bonus' ? PURPLE : RED;
            ctx.font = '9px Courier New';
            ctx.textAlign = 'center';
            ctx.fillText(ez.type === 'bonus' ? 'EPISTASIS+' : 'EPISTASIS\u2212', ez.x, 60);
            ctx.restore();
        }
    }

    // === DRAW: LANDSCAPE ===
    function drawLandscape() {
        if (!landscape || landscape.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(landscape[0].x, landscape[0].y);
        for (var i = 1; i < landscape.length; i++) {
            ctx.lineTo(landscape[i].x, landscape[i].y);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();

        var lGrad = ctx.createLinearGradient(0, H * 0.1, 0, H);
        lGrad.addColorStop(0, 'rgba(13, 143, 101, 0.15)');
        lGrad.addColorStop(0.4, 'rgba(128, 0, 0, 0.1)');
        lGrad.addColorStop(1, 'rgba(10, 10, 15, 0.9)');
        ctx.fillStyle = lGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(landscape[0].x, landscape[0].y);
        for (var j = 1; j < landscape.length; j++) {
            ctx.lineTo(landscape[j].x, landscape[j].y);
        }
        ctx.strokeStyle = MAROON;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(200, 60, 60, 0.4)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 8]);
        for (var cl = 0.2; cl < 0.9; cl += 0.15) {
            var contourY = H - cl * H * 0.7 - H * 0.08;
            ctx.beginPath(); ctx.moveTo(0, contourY); ctx.lineTo(W, contourY); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    // === DRAW: PEAK MARKERS ===
    function drawPeakMarkers() {
        for (var i = 0; i < peaks.length; i++) {
            var pk = peaks[i];
            var claimed = peaksClaimed[i];

            ctx.save();
            ctx.globalAlpha = claimed ? 0.25 : 0.7;

            if (pk.isGlobal) {
                ctx.fillStyle = GOLD;
                ctx.font = '16px Courier New';
                ctx.textAlign = 'center';
                ctx.fillText('\u2605', pk.x, pk.y - 25);

                ctx.font = '8px Courier New';
                ctx.fillStyle = GOLD;
                ctx.globalAlpha = claimed ? 0.15 : 0.4;
                ctx.fillText('GLOBAL MAX', pk.x, pk.y - 12);
            } else {
                ctx.fillStyle = claimed ? 'rgba(255,255,255,0.2)' : GREEN;
                ctx.beginPath();
                ctx.moveTo(pk.x, pk.y - 22);
                ctx.lineTo(pk.x - 5, pk.y - 14);
                ctx.lineTo(pk.x + 5, pk.y - 14);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }
    }

    // === DRAW: WATER ===
    function drawWater() {
        if (waterLevel > H + 50) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, waterLevel);
        for (var wx = 0; wx <= W; wx += 4) {
            var wave = Math.sin(wx * 0.03 + gameTime * 0.05) * 3 +
                       Math.sin(wx * 0.01 + gameTime * 0.02) * 2;
            ctx.lineTo(wx, waterLevel + wave);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();

        var wGrad = ctx.createLinearGradient(0, waterLevel, 0, H);
        // Tint water differently based on phase
        if (roundPhase === 'pressure') {
            wGrad.addColorStop(0, 'rgba(196, 60, 60, 0.35)');
            wGrad.addColorStop(0.3, 'rgba(160, 30, 30, 0.45)');
            wGrad.addColorStop(1, 'rgba(100, 0, 0, 0.7)');
        } else {
            wGrad.addColorStop(0, 'rgba(90, 159, 166, 0.15)');
            wGrad.addColorStop(0.3, 'rgba(60, 100, 110, 0.2)');
            wGrad.addColorStop(1, 'rgba(30, 50, 60, 0.4)');
        }
        ctx.fillStyle = wGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, waterLevel);
        for (var wx2 = 0; wx2 <= W; wx2 += 4) {
            var wave2 = Math.sin(wx2 * 0.03 + gameTime * 0.05) * 3 +
                        Math.sin(wx2 * 0.01 + gameTime * 0.02) * 2;
            ctx.lineTo(wx2, waterLevel + wave2);
        }
        ctx.strokeStyle = roundPhase === 'pressure' ? RED : TEAL;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#fff';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'center';
        var waterLabel = roundPhase === 'pressure' ? '\u25B2 SELECTION PRESSURE \u25B2' : '\u25BC drift \u25BC';
        ctx.fillText(waterLabel, W / 2, Math.min(waterLevel + 25, H - 10));
        ctx.globalAlpha = 1;

        ctx.restore();
    }

    // === DRAW: PHASE BANNER ===
    function drawPhaseBanner() {
        if (roundBannerAlpha <= 0 || !roundBannerText) return;
        ctx.save();
        var alpha = Math.min(roundBannerAlpha, 1);
        ctx.globalAlpha = alpha * 0.15;
        ctx.fillStyle = roundPhase === 'drift' ? TEAL : RED;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    // === DRAW: PHASE TIMER ===
    function drawPhaseTimer() {
        if (!running) return;

        // Progress bar at top of screen showing phase time remaining
        var progress = phaseTimer / phaseDuration;
        progress = Math.max(0, Math.min(1, progress));

        var barY = 4;
        var barH = 3;
        var barW = W * 0.4;
        var barX = (W - barW) / 2;

        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.restore();

        var barColor = roundPhase === 'drift' ? TEAL : RED;
        // Flash when running low
        if (phaseTimer < 90 && roundPhase === 'drift') {
            barColor = Math.floor(gameTime * 0.2) % 2 === 0 ? WARN : TEAL;
        }
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = barColor;
        ctx.fillRect(barX, barY, barW * progress, barH);
        ctx.globalAlpha = 1;

        // Phase label
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#fff';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'center';
        var phaseLabel = roundPhase === 'drift' ? 'DRIFT' : 'SELECTION';
        ctx.fillText('R' + roundNumber + ' \u2022 ' + phaseLabel, W / 2, barY + barH + 12);
        ctx.restore();
    }

    // === DRAW: PLAYER TRAIL ===
    function drawPlayerTrail() {
        for (var i = 0; i < player.moveTrail.length; i++) {
            var t = player.moveTrail[i];
            var alpha = t.life / 20 * 0.3;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = TEAL;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // === DRAW: PLAYER ===
    function drawPlayerChar() {
        if (!player.alive && shakeDur <= 0) return;
        var px = player.x, py = player.y, r = player.radius;

        ctx.save();
        ctx.translate(px, py);

        var gr = r * 2.5;
        var gg = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, gr);
        gg.addColorStop(0, player.glow > 0 ? 'rgba(90,159,166,0.5)' : 'rgba(90,159,166,0.25)');
        gg.addColorStop(1, 'rgba(90,159,166,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2); ctx.fill();

        var bodyCol = mutRate > 0.7 ? lerpCol(TEAL, '#a05a5a', (mutRate - 0.7) / 0.3 * 0.3) : TEAL;
        ctx.fillStyle = bodyCol;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

        var hl = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
        hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-r * 0.28, -r * 0.1, r * 0.2, 0, Math.PI * 2);
        ctx.arc(r * 0.28, -r * 0.1, r * 0.2, 0, Math.PI * 2);
        ctx.fill();

        var look = moveDir * 1.5;
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(-r * 0.25 + look, -r * 0.1, r * 0.1, 0, Math.PI * 2);
        ctx.arc(r * 0.31 + look, -r * 0.1, r * 0.1, 0, Math.PI * 2);
        ctx.fill();

        if (player.alive) {
            ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1; ctx.lineCap = 'round';
            if (selPressure > 0.5) {
                ctx.beginPath(); ctx.arc(0, r * 0.3, r * 0.15, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke();
            } else {
                ctx.beginPath(); ctx.arc(0, r * 0.15, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
            }
        }

        ctx.restore();
    }

    // === DRAW: BARS ===
    function drawBars() {
        if (!running) return;
        drawBar(14, 75, 6, 80, mutRate, mutRate < 0.4 ? GREEN : mutRate < 0.7 ? GOLD : RED, 'MUT');
        drawBar(W - 20, 75, 6, 80, selPressure, selPressure < 0.35 ? TEAL : selPressure < 0.65 ? WARN : RED, 'SEL');
    }
    function drawBar(x, y, w, h, val, col, label) {
        ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h); ctx.restore();
        ctx.fillStyle = col; ctx.globalAlpha = 0.65; ctx.fillRect(x, y + h - h * val, w, h * val); ctx.globalAlpha = 1;
        ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.font = '8px Courier New'; ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y - 5); ctx.restore();
    }

    function drawParticlesR() {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i]; ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.3 + p.life / p.maxLife * 0.7), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    function drawTextsR() {
        for (var i = 0; i < texts.length; i++) {
            var ft = texts[i]; ctx.globalAlpha = Math.min(ft.life / 15, 1); ctx.fillStyle = ft.color;
            ctx.font = 'bold ' + (ft.size || 14) + 'px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
    }

    // === UTILITY ===
    function lerpCol(c1, c2, t) {
        var a = hexRgb(c1), b = hexRgb(c2);
        if (!a || !b) return c1;
        return 'rgb(' + Math.round(a.r + (b.r - a.r) * t) + ',' + Math.round(a.g + (b.g - a.g) * t) + ',' + Math.round(a.b + (b.b - a.b) * t) + ')';
    }
    function hexRgb(h) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
    }

})();
