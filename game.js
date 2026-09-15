// =================================================================
//  PIPETTENSTEIN 3-D — Easter Egg First-Person Shooter
//  Dickinson Group Lab Website
//  Unlock: type the reverse complement of 5'-ATGCGA-3' (TCGCAT)
//
//  A directed evolution experiment has escaped containment.
//  Fight your way through four floors of evolved phage, mutant
//  E. coli and rogue proteases to reach the final boss:
//  Reviewer #2.
//
//  Classic grid raycaster (Wolfenstein 3-D style). Every texture,
//  sprite and sound is generated procedurally — no asset files.
// =================================================================
(function () {
    'use strict';

    var SECRET = 'TCGCAT';

    // === RENDER CONSTANTS ===
    var BASE_H = 200;          // internal framebuffer height (pixels)
    var STATUS_H = 40;         // status bar height
    var VIEW_H = BASE_H - STATUS_H;
    var TEX = 64;              // texture size
    var PROJ = 242;            // projection distance in pixels (~66deg FOV at 320 wide)

    // === GAMEPLAY CONSTANTS ===
    var MOVE_SPEED = 3.2;      // tiles / second
    var RUN_MULT = 1.65;
    var TURN_SPEED = 2.6;      // radians / second
    var PLAYER_RADIUS = 0.28;
    var MAX_AMMO = 99;
    var DOOR_SPEED = 2.2;      // open fraction / second
    var DOOR_HOLD = 4.0;       // seconds a door stays open
    var PUSH_SPEED = 1.1;      // tiles / second

    // === PALETTE (site brand) ===
    var MAROON = '#800000';
    var TEAL = '#5a9fa6';
    var GOLD = '#a07d1e';

    // === STATE ===
    var codeBuffer = '';
    var unlocked = false;
    var active = false;        // overlay is open
    var running = false;       // gameplay loop is ticking
    var paused = false;
    var animId = null;
    var lastTime = 0;
    var debug = /p3d-debug/.test(location.hash);

    var screenCanvas, screenCtx;   // visible canvas
    var fb, fbCtx, fbImage, fbData; // low-res framebuffer
    var RW = 320;                  // framebuffer width (depends on aspect)
    var zbuf;                      // per-column wall distance
    var mobile = false;

    // =================================================================
    //  UTILITIES
    // =================================================================
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }

    // Deterministic RNG so generated textures look identical every run
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function makeCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    // Pack RGBA into a little-endian Uint32 pixel
    function rgba(r, g, b, a) {
        return ((a === undefined ? 255 : a) << 24 | b << 16 | g << 8 | r) >>> 0;
    }

    function hexToRgb(h) {
        h = h.replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }

    function hexPix(h) { var c = hexToRgb(h); return rgba(c[0], c[1], c[2]); }

    // Darken a packed pixel (used for Y-side walls, like the original)
    function shadePix(p, f) {
        var r = (p & 255) * f, g = (p >> 8 & 255) * f, b = (p >> 16 & 255) * f;
        return ((p >>> 24) << 24 | b << 16 | g << 8 | r) >>> 0;
    }

    // =================================================================
    //  SOUND — tiny WebAudio synth
    // =================================================================
    var AC = null, master = null, noiseBuf = null, muted = false;
    var lastSfx = {};

    function audio() {
        if (!AC) {
            try {
                AC = new (window.AudioContext || window.webkitAudioContext)();
                master = AC.createGain();
                master.gain.value = 0.55;
                master.connect(AC.destination);
                noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
                var d = noiseBuf.getChannelData(0);
                for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            } catch (e) { AC = null; }
        }
        if (AC && AC.state === 'suspended') AC.resume();
        return AC;
    }

    function tone(o) {
        if (muted || !AC) return;
        var t = AC.currentTime + (o.delay || 0);
        var osc = AC.createOscillator(), g = AC.createGain();
        osc.type = o.type || 'square';
        osc.frequency.setValueAtTime(o.f0, t);
        if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
        g.gain.setValueAtTime(o.vol || 0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + o.dur + 0.02);
    }

    function noise(o) {
        if (muted || !AC) return;
        var t = AC.currentTime + (o.delay || 0);
        var src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
        src.buffer = noiseBuf;
        f.type = o.filter || 'lowpass';
        f.frequency.setValueAtTime(o.freq || 2000, t);
        if (o.freq1) f.frequency.exponentialRampToValueAtTime(o.freq1, t + o.dur);
        f.Q.value = o.q || 1;
        g.gain.setValueAtTime(o.vol || 0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.02);
    }

    var SFX = {
        notebook: function () { noise({ dur: 0.09, vol: 0.5, freq: 700 }); tone({ type: 'sine', f0: 160, f1: 50, dur: 0.12, vol: 0.35 }); },
        pipette:  function () { tone({ type: 'square', f0: 1100, f1: 180, dur: 0.13, vol: 0.16 }); noise({ dur: 0.07, vol: 0.3, freq: 3500, filter: 'highpass' }); },
        multi:    function () { tone({ type: 'square', f0: 800, f1: 220, dur: 0.08, vol: 0.12 }); noise({ dur: 0.05, vol: 0.22, freq: 2800, filter: 'highpass' }); },
        ln2:      function () { noise({ dur: 0.11, vol: 0.32, freq: 7000, freq1: 2500, filter: 'bandpass', q: 0.7 }); tone({ type: 'sawtooth', f0: 260, f1: 110, dur: 0.07, vol: 0.07 }); },
        eject:    function () { tone({ type: 'square', f0: 2600, f1: 1400, dur: 0.03, vol: 0.05 }); tone({ type: 'triangle', f0: 3400, f1: 2900, dur: 0.035, vol: 0.04, delay: 0.32 }); },
        empty:    function () { tone({ type: 'square', f0: 220, dur: 0.04, vol: 0.12 }); },
        door:     function () { noise({ dur: 0.45, vol: 0.28, freq: 400, freq1: 150 }); tone({ type: 'sawtooth', f0: 70, f1: 55, dur: 0.4, vol: 0.06 }); },
        push:     function () { noise({ dur: 1.4, vol: 0.35, freq: 250, freq1: 90 }); },
        locked:   function () { tone({ type: 'square', f0: 180, dur: 0.1, vol: 0.15 }); tone({ type: 'square', f0: 130, dur: 0.18, vol: 0.15, delay: 0.1 }); },
        noway:    function () { tone({ type: 'triangle', f0: 120, f1: 90, dur: 0.12, vol: 0.2 }); },
        ammo:     function () { tone({ type: 'square', f0: 500, dur: 0.05, vol: 0.12 }); tone({ type: 'square', f0: 750, dur: 0.07, vol: 0.12, delay: 0.05 }); },
        health:   function () { tone({ type: 'triangle', f0: 440, dur: 0.08, vol: 0.2 }); tone({ type: 'triangle', f0: 660, dur: 0.12, vol: 0.2, delay: 0.07 }); },
        treasure: function () { [880, 1175, 1568].forEach(function (f, i) { tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.18, delay: i * 0.05 }); }); },
        weapon:   function () { [330, 440, 554, 659].forEach(function (f, i) { tone({ type: 'square', f0: f, dur: 0.1, vol: 0.13, delay: i * 0.06 }); }); },
        key:      function () { [988, 1319].forEach(function (f, i) { tone({ type: 'sine', f0: f, dur: 0.18, vol: 0.22, delay: i * 0.09 }); }); },
        oneup:    function () { [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { tone({ type: 'square', f0: f, dur: 0.1, vol: 0.13, delay: i * 0.08 }); }); },
        hurt:     function () { tone({ type: 'sawtooth', f0: 220, f1: 80, dur: 0.18, vol: 0.2 }); noise({ dur: 0.1, vol: 0.2, freq: 900 }); },
        die:      function () { tone({ type: 'sawtooth', f0: 300, f1: 40, dur: 0.9, vol: 0.25 }); noise({ dur: 0.6, vol: 0.2, freq: 600, freq1: 100 }); },
        enemyShot:function () { tone({ type: 'square', f0: 600, f1: 140, dur: 0.12, vol: 0.1 }); noise({ dur: 0.05, vol: 0.14, freq: 2000 }); },
        bite:     function () { noise({ dur: 0.08, vol: 0.3, freq: 1500 }); tone({ type: 'square', f0: 140, f1: 90, dur: 0.07, vol: 0.14 }); },
        alertPhage:    function () { tone({ type: 'square', f0: 300, f1: 600, dur: 0.12, vol: 0.12 }); tone({ type: 'square', f0: 600, f1: 300, dur: 0.12, vol: 0.12, delay: 0.12 }); },
        alertEcoli:    function () { tone({ type: 'sawtooth', f0: 900, f1: 1400, dur: 0.15, vol: 0.08 }); },
        alertProtease: function () { tone({ type: 'sawtooth', f0: 90, f1: 60, dur: 0.35, vol: 0.2 }); noise({ dur: 0.3, vol: 0.12, freq: 500 }); },
        alertReviewer: function () { [196, 185, 175, 147].forEach(function (f, i) { tone({ type: 'sawtooth', f0: f, dur: 0.22, vol: 0.16, delay: i * 0.2 }); }); },
        enemyDie: function () { tone({ type: 'square', f0: 500, f1: 60, dur: 0.35, vol: 0.14 }); noise({ dur: 0.25, vol: 0.18, freq: 1200, freq1: 200 }); },
        splat:    function () { noise({ dur: 0.2, vol: 0.3, freq: 800, freq1: 150 }); },
        exit:     function () { [392, 494, 587, 784, 587, 784].forEach(function (f, i) { tone({ type: 'triangle', f0: f, dur: 0.16, vol: 0.2, delay: i * 0.11 }); }); },
        secret:   function () { [659, 622, 659, 784].forEach(function (f, i) { tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.18, delay: i * 0.09 }); }); }
    };

    // Play with light rate limiting so bursts don't clip
    function sfx(name, minGap) {
        if (muted || !audio()) return;
        var now = performance.now();
        if (minGap && lastSfx[name] && now - lastSfx[name] < minGap) return;
        lastSfx[name] = now;
        SFX[name]();
    }

    // =================================================================
    //  PIXEL FONT — 5x7 glyphs, one number per row (bit 16 = leftmost)
    // =================================================================
    var GLYPHS = {
        'A': [14,17,17,31,17,17,17], 'B': [30,17,17,30,17,17,30], 'C': [14,17,16,16,16,17,14],
        'D': [30,17,17,17,17,17,30], 'E': [31,16,16,30,16,16,31], 'F': [31,16,16,30,16,16,16],
        'G': [14,17,16,23,17,17,15], 'H': [17,17,17,31,17,17,17], 'I': [14,4,4,4,4,4,14],
        'J': [7,2,2,2,2,18,12],     'K': [17,18,20,24,20,18,17], 'L': [16,16,16,16,16,16,31],
        'M': [17,27,21,21,17,17,17], 'N': [17,17,25,21,19,17,17], 'O': [14,17,17,17,17,17,14],
        'P': [30,17,17,30,16,16,16], 'Q': [14,17,17,17,21,18,13], 'R': [30,17,17,30,20,18,17],
        'S': [15,16,16,14,1,1,30],   'T': [31,4,4,4,4,4,4],       'U': [17,17,17,17,17,17,14],
        'V': [17,17,17,17,17,10,4],  'W': [17,17,17,21,21,21,10], 'X': [17,17,10,4,10,17,17],
        'Y': [17,17,10,4,4,4,4],     'Z': [31,1,2,4,8,16,31],
        '0': [14,17,19,21,25,17,14], '1': [4,12,4,4,4,4,14],      '2': [14,17,1,2,4,8,31],
        '3': [31,2,4,2,1,17,14],     '4': [2,6,10,18,31,2,2],     '5': [31,16,30,1,1,17,14],
        '6': [6,8,16,30,17,17,14],   '7': [31,1,2,4,8,8,8],       '8': [14,17,17,14,17,17,14],
        '9': [14,17,17,15,1,2,12],
        ' ': [0,0,0,0,0,0,0],        '.': [0,0,0,0,0,12,12],      ',': [0,0,0,0,12,4,8],
        ':': [0,12,12,0,12,12,0],    '!': [4,4,4,4,4,0,4],        '?': [14,17,1,2,4,0,4],
        '-': [0,0,0,31,0,0,0],       '%': [24,25,2,4,8,19,3],     '#': [10,10,31,10,31,10,10],
        '/': [1,1,2,4,8,16,16],      "'": [4,4,8,0,0,0,0],        '+': [0,4,4,31,4,4,0],
        '(': [2,4,8,8,8,4,2],        ')': [8,4,2,2,2,4,8],        '=': [0,0,31,0,31,0,0],
        '&': [12,18,20,8,21,18,13],  '<': [2,4,8,16,8,4,2],       '>': [8,4,2,1,2,4,8],
        '*': [0,21,14,31,14,21,0]
    };

    var glyphCache = {};

    // Pre-render each glyph per color so text drawing is a few drawImage calls
    function glyphCanvas(ch, color) {
        var key = ch + color;
        if (glyphCache[key]) return glyphCache[key];
        var rows = GLYPHS[ch] || GLYPHS['?'];
        var c = makeCanvas(5, 7), x = c.getContext('2d');
        x.fillStyle = color;
        for (var r = 0; r < 7; r++) {
            for (var b = 0; b < 5; b++) {
                if (rows[r] & (16 >> b)) x.fillRect(b, r, 1, 1);
            }
        }
        glyphCache[key] = c;
        return c;
    }

    function textWidth(str, scale) { return str.length * 6 * (scale || 1) - (scale || 1); }

    // align: 'left' | 'center' | 'right'. Draws a 1px drop shadow when shadow is set.
    function drawText(ctx, str, x, y, color, scale, align, shadow) {
        scale = scale || 1;
        str = String(str).toUpperCase();
        var w = textWidth(str, scale);
        if (align === 'center') x -= Math.floor(w / 2);
        else if (align === 'right') x -= w;
        x = Math.round(x); y = Math.round(y);
        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (ch !== ' ') {
                if (shadow) ctx.drawImage(glyphCanvas(ch, shadow), x + i * 6 * scale + scale, y + scale, 5 * scale, 7 * scale);
                ctx.drawImage(glyphCanvas(ch, color), x + i * 6 * scale, y, 5 * scale, 7 * scale);
            }
        }
    }

    // =================================================================
    //  WALL TEXTURES — 64x64, generated procedurally at launch
    // =================================================================
    var T = {
        TILE: 0, POSTER: 1, BRICK: 2, HOOD: 3, SHELF: 4, FREEZER: 5, BIOHAZ: 6,
        WHITEBOARD: 7, ELEVATOR: 8, ELEVATOR_ON: 9, DOOR: 10, JAMB: 11, LOCKED: 12,
        STEEL: 13, WOOD: 14, REVIEWER: 15, DNA: 16, CONCRETE: 17, WINDOW: 18, SEQUENCER: 19
    };

    // Map characters -> wall texture
    var WALL_CHARS = {
        '#': T.TILE, 'T': T.POSTER, 'B': T.BRICK, 'H': T.HOOD, 'L': T.SHELF, 'F': T.FREEZER,
        'Z': T.BIOHAZ, 'W': T.WHITEBOARD, 'X': T.ELEVATOR, 'S': T.STEEL, 'O': T.WOOD,
        'R': T.REVIEWER, 'N': T.DNA, 'C': T.CONCRETE, 'V': T.WINDOW, 'Q': T.SEQUENCER
    };

    var textures = [];

    function R(x, color, x0, y0, w, h) { x.fillStyle = color; x.fillRect(x0, y0, w, h); }

    function rgbStr(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }

    function vary(hex, amt, rand) {
        var c = hexToRgb(hex), d = (rand() - 0.5) * amt;
        return rgbStr(clamp(c[0] + d, 0, 255), clamp(c[1] + d, 0, 255), clamp(c[2] + d, 0, 255));
    }

    // Grain noise + build the packed pixel arrays (lit and dark sides)
    function finishTex(c, noiseAmt, rand) {
        var x = c.getContext('2d');
        var id = x.getImageData(0, 0, TEX, TEX), d = id.data;
        for (var i = 0; i < d.length; i += 4) {
            var n = (rand() - 0.5) * noiseAmt;
            d[i] += n; d[i + 1] += n; d[i + 2] += n; d[i + 3] = 255;
        }
        x.putImageData(id, 0, 0);
        var data = new Uint32Array(id.data.buffer.slice(0));
        var dark = new Uint32Array(data.length);
        for (var j = 0; j < data.length; j++) dark[j] = shadePix(data[j], 0.7);
        return { canvas: c, data: data, dark: dark };
    }

    function drawTile(x, rand) {
        R(x, '#9a958d', 0, 0, 64, 64);
        for (var ty = 0; ty < 4; ty++) {
            for (var tx = 0; tx < 4; tx++) {
                var s = 206 + rand() * 16;
                R(x, rgbStr(s, s - 3, s - 9), tx * 16 + 1, ty * 16 + 1, 15, 15);
                R(x, rgbStr(s + 14, s + 11, s + 6), tx * 16 + 1, ty * 16 + 1, 15, 1);
            }
        }
        R(x, MAROON, 0, 40, 64, 4);
        R(x, '#520000', 0, 43, 64, 1);
    }

    function drawBrick(x, rand) {
        R(x, '#665a50', 0, 0, 64, 64);
        for (var row = 0; row < 8; row++) {
            var off = row % 2 ? 8 : 0;
            for (var col = -1; col < 5; col++) {
                var bx = col * 16 + off, by = row * 8;
                var base = vary('#7c2a1c', 34, rand);
                x.save(); x.beginPath(); x.rect(0, 0, 64, 64); x.clip();
                R(x, base, bx + 1, by + 1, 15, 7);
                R(x, 'rgba(255,220,200,0.12)', bx + 1, by + 1, 15, 1);
                R(x, 'rgba(0,0,0,0.22)', bx + 1, by + 7, 15, 1);
                x.restore();
            }
        }
    }

    function drawDoorBase(x, rand) {
        R(x, '#3c464d', 0, 0, 64, 64);
        R(x, '#6e7f8a', 2, 2, 60, 62);
        for (var y = 2; y < 64; y += 2) R(x, 'rgba(255,255,255,0.04)', 2, y, 60, 1);
        R(x, '#58666f', 2, 34, 60, 2);
        R(x, '#8b9aa4', 2, 36, 60, 1);
        R(x, '#58666f', 2, 48, 60, 2);
        R(x, '#a3acb3', 4, 54, 56, 8);
        R(x, '#7d878e', 4, 61, 56, 1);
    }

    var TEX_DRAW = [];

    TEX_DRAW[T.TILE] = function (x, rand) { drawTile(x, rand); };

    TEX_DRAW[T.POSTER] = function (x, rand) {
        drawTile(x, rand);
        R(x, '#3a3a3a', 9, 7, 46, 31);
        R(x, '#f4f1e8', 10, 8, 44, 29);
        R(x, MAROON, 10, 8, 44, 3);
        var groups = function (r, c) {
            if (c === 0) return '#e0645c';
            if (c === 1) return '#f0a04b';
            if (c === 17) return '#8fa8e8';
            if (c >= 12) return '#6fbf98';
            return '#e3c84f';
        };
        for (var r = 0; r < 7; r++) {
            for (var c = 0; c < 18; c++) {
                var show = r === 0 ? (c === 0 || c === 17)
                    : r < 3 ? (c < 2 || c >= 12)
                    : true;
                if (show) R(x, groups(r, c), 11 + c * 2 + (c > 1 ? 1 : 0) + (c > 11 ? 1 : 0), 12 + r * 3, 2, 2);
            }
        }
        for (var l = 0; l < 14; l++) R(x, '#b98fd6', 16 + l * 2, 34, 2, 1);
    };

    TEX_DRAW[T.BRICK] = function (x, rand) { drawBrick(x, rand); };

    TEX_DRAW[T.HOOD] = function (x, rand) {
        R(x, '#8e959b', 0, 0, 64, 64);
        R(x, '#5d6368', 0, 0, 64, 7);
        for (var v = 6; v < 60; v += 6) R(x, '#2b2f33', v, 2, 4, 2);
        R(x, '#23333a', 4, 8, 56, 32);
        R(x, '#3a525c', 4, 8, 56, 2);
        // bottles and flasks inside the hood
        var cols = ['#3fbf6f', '#4a8fe0', '#e08a3a', '#d04a7a', '#e6d84a'];
        for (var b = 0; b < 5; b++) {
            var bx = 8 + b * 10 + Math.floor(rand() * 3), col = cols[b];
            if (b % 2) {
                R(x, '#c9d6dc', bx + 2, 25, 2, 5);
                for (var k = 0; k < 7; k++) R(x, col, bx + 3 - Math.floor(k / 2), 30 + k, 1 + k, 1);
            } else {
                R(x, '#c9d6dc', bx, 24, 5, 13);
                R(x, col, bx + 1, 30, 3, 6);
            }
        }
        // glass reflections
        x.strokeStyle = 'rgba(190,230,240,0.25)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(8, 38); x.lineTo(24, 10); x.moveTo(14, 38); x.lineTo(30, 10); x.moveTo(40, 38); x.lineTo(56, 10); x.stroke();
        R(x, '#b7bec3', 3, 8, 2, 32); R(x, '#b7bec3', 31, 8, 2, 32); R(x, '#b7bec3', 59, 8, 2, 32);
        R(x, '#d3d9dd', 4, 38, 56, 2);
        R(x, '#e8c42e', 22, 42, 20, 4);
        R(x, '#a7adb2', 0, 47, 64, 17);
        R(x, '#7b8186', 2, 49, 29, 14); R(x, '#7b8186', 33, 49, 29, 14);
        R(x, '#a7adb2', 3, 50, 27, 12); R(x, '#a7adb2', 34, 50, 27, 12);
        R(x, '#50565b', 26, 53, 2, 5); R(x, '#50565b', 36, 53, 2, 5);
    };

    TEX_DRAW[T.SHELF] = function (x, rand) {
        R(x, '#4a2f18', 0, 0, 64, 64);
        var pal = ['#800000', '#1f4e79', '#2e6b3a', '#c9a227', '#6b3fa0', '#b35c1e', '#2d2d2d', '#5a9fa6', '#e8e0cf', '#8c1d1d'];
        for (var s = 0; s < 4; s++) {
            var top = s * 16;
            var bx = 2;
            while (bx < 61) {
                var w = 2 + Math.floor(rand() * 3), h = 9 + Math.floor(rand() * 5);
                if (bx + w > 62) w = 62 - bx;
                var col = pal[Math.floor(rand() * pal.length)];
                R(x, col, bx, top + 14 - h, w, h);
                R(x, 'rgba(255,255,255,0.2)', bx, top + 14 - h, w, 1);
                if (h > 10) R(x, 'rgba(255,240,200,0.55)', bx, top + 14 - h + 3, w, 1);
                bx += w + (rand() < 0.15 ? 1 : 0);
            }
            R(x, '#7a4f2a', 0, top + 14, 64, 2);
            R(x, '#9a6a3c', 0, top + 14, 64, 1);
        }
        R(x, '#3a2412', 0, 0, 2, 64); R(x, '#3a2412', 62, 0, 2, 64);
    };

    TEX_DRAW[T.FREEZER] = function (x, rand) {
        R(x, '#dfe2e5', 0, 0, 64, 64);
        R(x, '#b9bdc1', 0, 0, 64, 1); R(x, '#b9bdc1', 0, 63, 64, 1);
        R(x, '#c3c8cc', 1, 6, 62, 1);
        R(x, '#2a2d30', 16, 9, 32, 12);
        R(x, '#0c0c0c', 17, 10, 30, 10);
        drawText(x, '-80', 32, 11, '#ff3b30', 1, 'center');
        R(x, '#5a9fa6', 4, 11, 8, 2);
        R(x, '#9aa0a6', 53, 24, 4, 22);
        R(x, '#eef1f3', 54, 25, 1, 20);
        R(x, '#c3c8cc', 1, 46, 62, 1);
        for (var v = 50; v < 62; v += 2) R(x, '#8d9296', 8, v, 48, 1);
        R(x, '#f2c230', 6, 26, 10, 7); drawText(x, '!', 11, 26, '#1a1a1a', 1, 'center');
    };

    TEX_DRAW[T.BIOHAZ] = function (x, rand) {
        R(x, '#7f868c', 0, 0, 64, 64);
        R(x, '#646a70', 31, 0, 2, 64);
        [[3, 3], [59, 3], [3, 59], [59, 59], [27, 3], [35, 3], [27, 59], [35, 59]].forEach(function (p) {
            R(x, '#a9b0b6', p[0], p[1], 2, 2);
        });
        R(x, '#111', 13, 7, 38, 38);
        R(x, '#f2c230', 14, 8, 36, 36);
        var cx = 32, cy = 27;
        x.fillStyle = '#111';
        for (var a = 0; a < 3; a++) {
            var ang = -Math.PI / 2 + a * Math.PI * 2 / 3;
            x.beginPath(); x.arc(cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 6, 7.5, 0, Math.PI * 2); x.fill();
        }
        x.fillStyle = '#f2c230';
        for (var b = 0; b < 3; b++) {
            var ang2 = -Math.PI / 2 + b * Math.PI * 2 / 3;
            x.beginPath(); x.arc(cx + Math.cos(ang2) * 9, cy + Math.sin(ang2) * 9, 5, 0, Math.PI * 2); x.fill();
        }
        x.beginPath(); x.arc(cx, cy, 3, 0, Math.PI * 2); x.fill();
        drawText(x, 'BSL-2', 32, 50, '#f2f2f2', 1, 'center');
    };

    TEX_DRAW[T.WHITEBOARD] = function (x, rand) {
        drawTile(x, rand);
        R(x, '#b8bcc0', 3, 5, 58, 34);
        R(x, '#f7f7f5', 5, 7, 54, 30);
        R(x, '#9ea3a8', 5, 37, 54, 2);
        drawText(x, 'PACE', 8, 9, '#c0392b', 1);
        x.strokeStyle = '#2f5fb3'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(8, 33);
        for (var i = 0; i <= 44; i += 2) x.lineTo(8 + i, 33 - Math.max(0, Math.sin(i * 0.2) * 7 + Math.sin(i * 0.07) * 9));
        x.stroke();
        R(x, '#1a1a1a', 8, 34, 46, 1); R(x, '#1a1a1a', 8, 18, 1, 16);
        drawText(x, 'DNA', 40, 9, '#1d7a45', 1);
        R(x, '#1a1a1a', 36, 12, 3, 1);
        R(x, '#c0392b', 40, 36, 6, 1); R(x, '#2f5fb3', 48, 36, 6, 1);
    };

    function drawElevator(x, rand, on) {
        R(x, '#8b9197', 0, 0, 64, 64);
        for (var y = 0; y < 64; y += 3) R(x, 'rgba(255,255,255,0.06)', 0, y, 64, 1);
        R(x, '#1c2226', 18, 2, 28, 10);
        drawText(x, 'EXIT', 32, 4, on ? '#39d353' : '#1f7a33', 1, 'center');
        R(x, '#3f454a', 19, 15, 26, 38);
        R(x, '#5a6066', 20, 16, 24, 36);
        R(x, on ? '#39d353' : '#1d4d27', 24, 19, 4, 3);
        R(x, on ? '#4d1b1b' : '#ff3b30', 36, 19, 4, 3);
        R(x, '#111', 30, 24, 4, 24);
        if (on) { R(x, '#888', 31, 26, 2, 8); R(x, '#39d353', 28, 23, 8, 6); R(x, '#9dff9d', 29, 24, 3, 2); }
        else { R(x, '#888', 31, 38, 2, 8); R(x, '#d33', 28, 43, 8, 6); R(x, '#ff9d9d', 29, 44, 3, 2); }
        R(x, '#6e747a', 0, 56, 64, 8);
    }
    TEX_DRAW[T.ELEVATOR] = function (x, rand) { drawElevator(x, rand, false); };
    TEX_DRAW[T.ELEVATOR_ON] = function (x, rand) { drawElevator(x, rand, true); };

    TEX_DRAW[T.DOOR] = function (x, rand) {
        drawDoorBase(x, rand);
        R(x, '#2f383e', 21, 9, 22, 20);
        R(x, '#1b2a33', 22, 10, 20, 18);
        R(x, 'rgba(160,210,230,0.35)', 24, 12, 3, 14);
        R(x, 'rgba(160,210,230,0.2)', 29, 12, 2, 14);
        R(x, '#c7cdd2', 44, 40, 14, 3);
        R(x, '#7d878e', 44, 43, 14, 1);
    };

    TEX_DRAW[T.JAMB] = function (x, rand) {
        R(x, '#56626b', 0, 0, 64, 64);
        for (var i = 0; i < 64; i += 8) { R(x, '#3f4a52', i, 0, 2, 64); R(x, '#76838c', i + 2, 0, 1, 64); }
    };

    TEX_DRAW[T.LOCKED] = function (x, rand) {
        drawDoorBase(x, rand);
        for (var i = -40; i < 64; i += 8) {
            x.save(); x.beginPath(); x.rect(2, 22, 60, 10); x.clip();
            x.fillStyle = '#f2c230'; x.beginPath();
            x.moveTo(i, 32); x.lineTo(i + 10, 22); x.lineTo(i + 14, 22); x.lineTo(i + 4, 32); x.fill();
            x.restore();
        }
        R(x, '#1a1a1a', 2, 22, 60, 1); R(x, '#1a1a1a', 2, 31, 60, 1);
        R(x, '#8c1010', 8, 7, 34, 12);
        drawText(x, 'BSL-2', 25, 10, '#fff', 1, 'center');
        R(x, '#111', 47, 6, 11, 14);
        R(x, '#ff3b30', 51, 8, 3, 2);
        R(x, '#333', 49, 12, 7, 6);
    };

    TEX_DRAW[T.STEEL] = function (x, rand) {
        R(x, '#a9b0b6', 0, 0, 64, 64);
        for (var y = 0; y < 64; y++) R(x, 'rgba(255,255,255,' + (rand() * 0.08).toFixed(3) + ')', 0, y, 64, 1);
        R(x, '#7b8288', 0, 31, 64, 2); R(x, '#7b8288', 31, 0, 2, 64);
        R(x, '#c7cdd2', 0, 33, 64, 1); R(x, '#c7cdd2', 33, 0, 1, 64);
        [[4, 4], [26, 4], [37, 4], [59, 4], [4, 26], [26, 26], [37, 26], [59, 26],
         [4, 37], [26, 37], [37, 37], [59, 37], [4, 59], [26, 59], [37, 59], [59, 59]].forEach(function (p) {
            R(x, '#6a7176', p[0], p[1], 2, 2); R(x, '#dde2e6', p[0], p[1], 1, 1);
        });
    };

    function drawWood(x, rand) {
        R(x, '#7b5230', 0, 0, 64, 32);
        for (var p = 0; p < 64; p += 8) {
            R(x, vary('#7b5230', 22, rand), p, 0, 8, 31);
            R(x, '#5a3a20', p, 0, 1, 31);
            for (var g = 0; g < 3; g++) R(x, 'rgba(60,35,15,0.35)', p + 2 + Math.floor(rand() * 5), Math.floor(rand() * 20), 1, 6 + Math.floor(rand() * 8));
        }
        R(x, '#3e2714', 0, 31, 64, 3);
        R(x, '#8c6238', 0, 31, 64, 1);
        R(x, '#5e3b20', 0, 34, 64, 30);
        [2, 34].forEach(function (px) {
            R(x, '#4a2e17', px, 38, 28, 22);
            R(x, '#6d4627', px + 1, 39, 26, 20);
            R(x, '#7d5230', px + 1, 39, 26, 1);
        });
    }
    TEX_DRAW[T.WOOD] = function (x, rand) { drawWood(x, rand); };

    TEX_DRAW[T.REVIEWER] = function (x, rand) {
        drawWood(x, rand);
        R(x, '#6b5213', 11, 3, 42, 27);
        R(x, '#c9a33a', 12, 4, 40, 25);
        R(x, '#efe9d8', 14, 6, 36, 21);
        for (var l = 0; l < 3; l++) R(x, '#9c968a', 17, 8 + l * 2, 20 + Math.floor(rand() * 10), 1);
        R(x, '#c0392b', 14, 16, 36, 1); R(x, '#c0392b', 14, 24, 36, 1);
        drawText(x, 'REJECT', 32, 17, '#c0392b', 1, 'center');
    };

    TEX_DRAW[T.DNA] = function (x, rand) {
        drawBrick(x, rand);
        R(x, '#e8e8e8', 15, 5, 34, 36);
        R(x, '#12263a', 16, 6, 32, 34);
        for (var y = 8; y < 30; y++) {
            var s = Math.sin(y * 0.42);
            var x1 = Math.round(32 + s * 9), x2 = Math.round(32 - s * 9);
            if (y % 3 === 0) R(x, 'rgba(230,230,230,0.5)', Math.min(x1, x2), y, Math.abs(x1 - x2), 1);
            R(x, s > 0 ? '#5a9fa6' : '#3b6f75', x1 - 1, y, 2, 1);
            R(x, s > 0 ? '#b33a3a' : MAROON, x2 - 1, y, 2, 1);
        }
        drawText(x, 'DNA', 32, 31, '#f4f1e8', 1, 'center');
    };

    TEX_DRAW[T.CONCRETE] = function (x, rand) {
        R(x, '#6d6b67', 0, 0, 64, 64);
        for (var row = 0; row < 4; row++) {
            var off = row % 2 ? 16 : 0;
            for (var col = -1; col < 3; col++) {
                var bx = col * 32 + off, by = row * 16;
                x.save(); x.beginPath(); x.rect(0, 0, 64, 64); x.clip();
                R(x, vary('#8c8a86', 16, rand), bx + 1, by + 1, 31, 15);
                R(x, 'rgba(255,255,255,0.1)', bx + 1, by + 1, 31, 1);
                x.restore();
            }
        }
        for (var s = 0; s < 40; s++) R(x, 'rgba(40,40,40,0.35)', Math.floor(rand() * 64), Math.floor(rand() * 64), 1, 1);
    };

    TEX_DRAW[T.WINDOW] = function (x, rand) {
        drawTile(x, rand);
        R(x, '#4d4d4d', 7, 5, 50, 34);
        var grd = x.createLinearGradient(0, 7, 0, 37);
        grd.addColorStop(0, '#5f9bd6'); grd.addColorStop(1, '#c4def2');
        x.fillStyle = grd; x.fillRect(9, 7, 46, 30);
        var bx = 9;
        while (bx < 55) {
            var w = 4 + Math.floor(rand() * 6), h = 6 + Math.floor(rand() * 16);
            if (bx + w > 55) w = 55 - bx;
            R(x, rand() < 0.5 ? '#3d4b5c' : '#4a586a', bx, 37 - h, w, h);
            for (var wy = 37 - h + 2; wy < 36; wy += 3) {
                for (var wx = bx + 1; wx < bx + w - 1; wx += 2) if (rand() < 0.3) R(x, '#f3d77a', wx, wy, 1, 1);
            }
            bx += w;
        }
        R(x, '#4d4d4d', 31, 7, 2, 30); R(x, '#4d4d4d', 9, 21, 46, 2);
        R(x, '#cfcfcf', 7, 39, 50, 1);
    };

    TEX_DRAW[T.SEQUENCER] = function (x, rand) {
        R(x, '#2b2f33', 0, 0, 64, 64);
        R(x, '#3a3f44', 0, 0, 64, 2);
        R(x, '#111', 6, 5, 52, 19);
        R(x, '#0b1a12', 7, 6, 50, 17);
        var bases = ['#3fcf6a', '#4a8fe0', '#f0d24a', '#e05050'];
        for (var i = 8; i < 56; i++) {
            var h = Math.floor(Math.abs(Math.sin(i * 1.3) * 10) * rand()) + 1;
            R(x, bases[i % 4], i, 21 - h, 1, h);
        }
        R(x, '#5a9fa6', 0, 26, 64, 2);
        for (var l = 0; l < 6; l++) R(x, rand() < 0.7 ? '#39d353' : '#f0a030', 8 + l * 5, 31, 2, 2);
        R(x, '#0d0f11', 38, 30, 20, 8);
        R(x, '#4aa3ff', 40, 33, 16, 1);
        for (var v = 44; v < 60; v += 3) R(x, '#1a1d20', 6, v, 52, 1);
    };

    function buildTextures() {
        if (textures.length) return;
        for (var i = 0; i < TEX_DRAW.length; i++) {
            var c = makeCanvas(TEX, TEX), rand = mulberry32(1000 + i * 77);
            TEX_DRAW[i](c.getContext('2d'), rand);
            textures[i] = finishTex(c, i === T.STEEL || i === T.ELEVATOR ? 6 : 12, rand);
        }
    }

    // =================================================================
    //  SPRITES — 64x64 billboards with transparency
    // =================================================================
    var sprites = [];   // {canvas, data}
    var SP = {};        // name -> sprite index (enemies: base index of 8 frames)

    // Enemy animation frames
    var FR = { STAND: 0, WALK1: 1, WALK2: 2, ATTACK: 3, PAIN: 4, DIE1: 5, DIE2: 6, DEAD: 7 };

    function addSprite(name, draw) {
        var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
        draw(x);
        var id = x.getImageData(0, 0, TEX, TEX);
        var data = new Uint32Array(id.data.buffer.slice(0));
        var idx = sprites.length;
        sprites.push({ canvas: c, data: data });
        if (name) SP[name] = idx;
        return idx;
    }

    function addEnemySprites(name, draw) {
        SP[name] = sprites.length;
        for (var f = 0; f < 8; f++) {
            (function (frame) {
                addSprite(null, function (x) {
                    draw(x, frame);
                    if (frame === FR.PAIN) flash(x, 'rgba(255,255,255,0.45)');
                });
            })(f);
        }
    }

    // Tint everything already drawn (keeps transparency)
    function flash(x, color) {
        x.save();
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = color;
        x.fillRect(0, 0, TEX, TEX);
        x.restore();
    }

    function poly(x, color, pts, stroke) {
        x.beginPath();
        x.moveTo(pts[0], pts[1]);
        for (var i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
        x.closePath();
        x.fillStyle = color; x.fill();
        if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1; x.stroke(); }
    }

    function ellipse(x, color, cx, cy, rx, ry, stroke) {
        x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        x.fillStyle = color; x.fill();
        if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1; x.stroke(); }
    }

    function roundRect(x, color, x0, y0, w, h, r, stroke) {
        x.beginPath();
        x.moveTo(x0 + r, y0);
        x.lineTo(x0 + w - r, y0); x.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0);
        x.lineTo(x0 + w, y0 + h - r); x.arc(x0 + w - r, y0 + h - r, r, 0, Math.PI / 2);
        x.lineTo(x0 + r, y0 + h); x.arc(x0 + r, y0 + h - r, r, Math.PI / 2, Math.PI);
        x.lineTo(x0, y0 + r); x.arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
        x.closePath();
        x.fillStyle = color; x.fill();
        if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1; x.stroke(); }
    }

    function line(x, color, w, pts) {
        x.beginPath(); x.moveTo(pts[0], pts[1]);
        for (var i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
        x.strokeStyle = color; x.lineWidth = w; x.lineCap = 'round'; x.stroke();
    }

    function muzzle(x, cx, cy, r, c1, c2) {
        var pts = [];
        for (var i = 0; i < 16; i++) {
            var a = i / 16 * Math.PI * 2, rr = i % 2 ? r * 0.45 : r;
            pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        poly(x, c1, pts);
        ellipse(x, c2, cx, cy, r * 0.35, r * 0.35);
    }

    // --- T4 BACTERIOPHAGE: basic ranged grunt ---
    function drawPhage(x, f) {
        if (f === FR.DEAD) {
            poly(x, '#3f7b82', [14, 60, 24, 55, 30, 61]);
            poly(x, '#5a9fa6', [34, 62, 42, 54, 50, 60]);
            poly(x, '#86c3c9', [22, 63, 28, 58, 36, 63]);
            line(x, '#c9d1d6', 2, [40, 63, 48, 62]);
            line(x, '#e05050', 1, [8, 62, 12, 59, 16, 62, 20, 59, 24, 62]);
            line(x, '#4a8fe0', 1, [8, 60, 12, 63, 16, 60, 20, 63, 24, 60]);
            return;
        }
        var bob = f === FR.WALK1 ? -1 : f === FR.WALK2 ? 1 : 0;
        var attack = f === FR.ATTACK;
        var drop = f === FR.DIE1 ? 6 : f === FR.DIE2 ? 16 : 0;
        var hy = (attack ? 12 : 6) + bob + drop;
        var baseY = 46 + bob + Math.floor(drop / 2);

        // tail fibres (legs)
        for (var side = -1; side <= 1; side += 2) {
            for (var k = 0; k < 3; k++) {
                var swing = (f === FR.WALK1 ? 1 : f === FR.WALK2 ? -1 : 0) * (k % 2 ? 1 : -1) * side * 2;
                var kneeX = 32 + side * (13 + k * 3) + swing, kneeY = baseY + 3 - k + (drop ? 6 : 0);
                var footX = 32 + side * (7 + k * 7) - swing, footY = 63;
                line(x, '#8d979c', 2, [32 + side * 5, baseY + 1, kneeX, kneeY, footX, footY]);
                line(x, '#dfe5e8', 1, [32 + side * 5, baseY + 1, kneeX, kneeY, footX, footY]);
            }
        }
        R(x, '#6f787d', 26, baseY, 12, 3);
        R(x, '#b5bdc2', 26, baseY, 12, 1);

        // contractile tail sheath
        var sheathTop = hy + 22, sheathLen = baseY - sheathTop;
        if (attack) {
            R(x, '#eef3f5', 31, sheathTop, 2, sheathLen);
            for (var s = 0; s < 8; s += 2) { R(x, '#c9d1d6', 28, sheathTop + s, 8, 1); R(x, '#6f787d', 28, sheathTop + s + 1, 8, 1); }
        } else {
            for (var t = 0; t < sheathLen; t += 2) { R(x, '#c9d1d6', 29, sheathTop + t, 6, 1); R(x, '#6f787d', 29, sheathTop + t + 1, 6, 1); }
        }
        R(x, '#9aa3a8', 28, hy + 20, 8, 2);

        // icosahedral head
        var shift = f === FR.DIE2 ? 3 : 0;
        poly(x, '#5a9fa6', [32, hy, 43, hy + 5, 43, hy + 16, 32, hy + 21, 21, hy + 16, 21, hy + 5], '#1d3d41');
        poly(x, '#3f7b82', [32, hy, 21, hy + 5, 21, hy + 16, 32, hy + 11]);
        poly(x, '#86c3c9', [32, hy, 43, hy + 5, 32, hy + 11]);
        poly(x, '#4d8d94', [32, hy + 11, 43, hy + 16, 32, hy + 21]);
        if (f >= FR.DIE1) {
            line(x, '#0d1f22', 1, [28 + shift, hy + 1, 33, hy + 7, 29 - shift, hy + 12, 34, hy + 20]);
        }
        // eyes
        if (f >= FR.DIE1) {
            line(x, '#111', 1, [25, hy + 8, 29, hy + 12]); line(x, '#111', 1, [29, hy + 8, 25, hy + 12]);
            line(x, '#111', 1, [35, hy + 8, 39, hy + 12]); line(x, '#111', 1, [39, hy + 8, 35, hy + 12]);
        } else {
            R(x, '#1a0000', 25, hy + 8, 5, 4); R(x, '#1a0000', 34, hy + 8, 5, 4);
            R(x, '#ff3b30', 26, hy + 9, 3, 2); R(x, '#ff3b30', 35, hy + 9, 3, 2);
            R(x, '#ffd0cc', 26, hy + 9, 1, 1); R(x, '#ffd0cc', 35, hy + 9, 1, 1);
            line(x, '#0d1f22', 1, [24, hy + 6, 30, hy + 8]); line(x, '#0d1f22', 1, [40, hy + 6, 34, hy + 8]);
        }
        if (attack) {
            muzzle(x, 32, baseY + 7, 8, '#ffe066', '#ffffff');
            line(x, '#e05050', 1, [32, baseY + 3, 29, baseY + 9, 35, baseY + 13, 30, baseY + 17]);
        }
    }

    // --- MUTANT E. COLI: fast melee rusher ---
    function drawEcoli(x, f) {
        if (f === FR.DEAD) {
            ellipse(x, '#4f7f26', 32, 60, 22, 4);
            ellipse(x, '#7fbf45', 30, 59, 14, 2.5);
            ellipse(x, '#9fdc66', 44, 61, 3, 1.5);
            ellipse(x, '#9fdc66', 17, 61, 2, 1);
            line(x, '#2f5a14', 1, [10, 62, 6, 58, 10, 55]);
            return;
        }
        var bob = f === FR.WALK1 ? -2 : f === FR.WALK2 ? 1 : 0;
        var lunge = f === FR.ATTACK;
        var squash = f === FR.DIE1 ? 0.7 : f === FR.DIE2 ? 0.4 : 1;
        var cy = 42 + bob + (1 - squash) * 18;
        var sc = lunge ? 1.25 : 1;
        var phase = f * 1.7;

        x.save();
        x.translate(32, cy);
        x.scale(sc, sc * squash);
        // flagella
        for (var k = 0; k < 4; k++) {
            var ox = -14 + k * 9, pts = [ox, 7];
            for (var s = 1; s <= 8; s++) pts.push(ox + Math.sin(s * 0.9 + phase + k) * 3, 7 + s * 2.4);
            line(x, '#3d6b1c', 1.2, pts);
        }
        // pili
        for (var p = 0; p < 14; p++) {
            var a = p / 14 * Math.PI * 2, ex = Math.cos(a) * 21, ey = Math.sin(a) * 11;
            line(x, '#5d8f2e', 1, [ex * 0.85, ey * 0.85, ex * 1.12, ey * 1.18]);
        }
        roundRect(x, '#4f8a22', -20, -10, 40, 20, 9);
        roundRect(x, '#77b83d', -19, -9, 38, 18, 8);
        roundRect(x, '#98d45c', -16, -8, 22, 6, 3);
        ellipse(x, 'rgba(200,240,160,0.6)', 11, 3, 3, 2, '#3d6b1c');
        ellipse(x, 'rgba(200,240,160,0.6)', -12, 4, 2, 1.5, '#3d6b1c');
        x.restore();

        var ey = cy - 3 * sc;
        if (f >= FR.DIE1) {
            line(x, '#111', 1, [23, ey - 2, 27, ey + 2]); line(x, '#111', 1, [27, ey - 2, 23, ey + 2]);
            line(x, '#111', 1, [37, ey - 2, 41, ey + 2]); line(x, '#111', 1, [41, ey - 2, 37, ey + 2]);
            return;
        }
        ellipse(x, '#fff', 25, ey, 3.5 * sc, 3 * sc);
        ellipse(x, '#fff', 39, ey, 3.5 * sc, 3 * sc);
        R(x, '#111', 25, ey - 1, 2, 3); R(x, '#111', 38, ey - 1, 2, 3);
        line(x, '#1e3b0b', 1.5, [20, ey - 5, 29, ey - 2]); line(x, '#1e3b0b', 1.5, [44, ey - 5, 35, ey - 2]);
        if (lunge) {
            ellipse(x, '#2a0a0a', 32, cy + 5, 11, 6);
            for (var t = 0; t < 6; t++) {
                poly(x, '#fff', [23 + t * 3.5, cy, 25 + t * 3.5, cy + 3, 27 + t * 3.5, cy]);
                poly(x, '#fff', [23 + t * 3.5, cy + 10, 25 + t * 3.5, cy + 7, 27 + t * 3.5, cy + 10]);
            }
        } else {
            line(x, '#1e3b0b', 1, [25, cy + 4, 29, cy + 6, 32, cy + 4, 35, cy + 6, 39, cy + 4]);
        }
    }

    // --- ROGUE PROTEASE: tanky melee chomper ---
    function drawProtease(x, f) {
        if (f === FR.DEAD) {
            ellipse(x, '#5b2c6f', 32, 60, 25, 4);
            ellipse(x, '#8e44ad', 30, 59, 16, 2.5);
            line(x, '#d2b4de', 2, [12, 58, 16, 61, 20, 58, 24, 61]);
            poly(x, '#f4d03f', [40, 60, 50, 58, 50, 56, 54, 59, 50, 62, 50, 60]);
            poly(x, '#fff', [26, 62, 28, 57, 30, 62]);
            return;
        }
        var bob = f === FR.WALK1 ? -2 : f === FR.WALK2 ? 0 : -1;
        var open = f === FR.ATTACK ? 1 : f === FR.WALK1 ? 0.25 : 0.1;
        var sink = f === FR.DIE1 ? 6 : f === FR.DIE2 ? 18 : 0;
        var cy = 38 + bob + sink, ry = f === FR.DIE2 ? 14 : 22;

        ellipse(x, '#5b2c6f', 32, cy, 26, ry + 1);
        ellipse(x, '#7d3c98', 32, cy, 25, ry);
        ellipse(x, '#9b59b6', 27, cy - ry * 0.35, 15, ry * 0.45);
        // alpha helix ribbons + beta strand
        for (var i = 0; i < 6; i++) {
            ellipse(x, '#d2b4de', 13 + i * 2.2, cy - 6 + Math.sin(i * 1.6) * 3, 1.6, 3);
            ellipse(x, '#d2b4de', 45 + i * 2, cy - 2 + Math.sin(i * 1.6 + 1) * 3, 1.6, 3);
        }
        poly(x, '#f4d03f', [42, cy - 14, 52, cy - 16, 51, cy - 19, 57, cy - 13, 50, cy - 9, 51, cy - 12, 43, cy - 10], '#9a7d0a');

        // active site mouth
        var mh = 4 + open * 14, my = cy + 2;
        ellipse(x, '#1f0a2a', 32, my + mh / 2, 17, mh / 2 + 1);
        for (var t = 0; t < 6; t++) {
            var tx = 19 + t * 5;
            poly(x, '#f5f5f5', [tx, my, tx + 2.5, my + 3 + open * 2, tx + 5, my]);
            poly(x, '#f5f5f5', [tx, my + mh, tx + 2.5, my + mh - 3 - open * 2, tx + 5, my + mh]);
        }
        // one big eye
        var eyeY = cy - ry + 10;
        if (f >= FR.DIE1) {
            line(x, '#111', 2, [28, eyeY - 3, 36, eyeY + 3]); line(x, '#111', 2, [36, eyeY - 3, 28, eyeY + 3]);
        } else {
            ellipse(x, '#fff', 32, eyeY, 6, 5, '#3b1a4a');
            ellipse(x, '#e01e1e', 32 + (f === FR.ATTACK ? 0 : 1), eyeY + 1, 2.5, 2.5);
            R(x, '#111', 32, eyeY, 1, 2);
            line(x, '#2b0f38', 2.5, [23, eyeY - 8, 41, eyeY - 5]);
        }
        if (f === FR.ATTACK) {
            line(x, '#ffffff', 1, [8, cy - 2, 14, cy + 2]); line(x, '#ffffff', 1, [56, cy - 2, 50, cy + 2]);
        }
    }

    // --- REVIEWER #2: final boss ---
    function drawReviewer(x, f) {
        if (f === FR.DEAD) {
            poly(x, '#f2eee2', [6, 60, 20, 56, 26, 61, 12, 63]);
            poly(x, '#e8e3d3', [22, 62, 34, 55, 44, 58, 32, 63]);
            poly(x, '#f7f4ea', [40, 62, 50, 57, 60, 61, 50, 63]);
            R(x, '#c0392b', 26, 58, 10, 1); R(x, '#c0392b', 44, 59, 8, 1);
            drawText(x, 'ACCEPT', 32, 50, '#0d8f65', 1, 'center', '#003a24');
            line(x, '#c0392b', 2, [8, 63, 18, 61]);
            R(x, '#222', 50, 54, 4, 2); R(x, '#222', 55, 54, 4, 2); R(x, '#222', 54, 54, 1, 1);
            return;
        }
        var drop = f === FR.DIE1 ? 5 : f === FR.DIE2 ? 14 : 0;
        var bob = f === FR.WALK1 || f === FR.WALK2 ? -1 : 0;
        var y0 = bob + drop;
        var skin = '#d9a877', skinDark = '#b98550', tweed = '#6d4c2f', tweedDark = '#4e3520';

        // legs and shoes
        if (f === FR.DIE2) {
            R(x, '#4a4a4a', 20, 54, 24, 7); R(x, '#111', 18, 60, 28, 3);
        } else {
            var l = f === FR.WALK1 ? -3 : f === FR.WALK2 ? 3 : 0;
            R(x, '#4a4a4a', 24 + l, 44 + y0, 6, 17 - y0); R(x, '#4a4a4a', 34 - l, 44 + y0, 6, 17 - y0);
            R(x, '#3a3a3a', 27 + l, 44 + y0, 1, 17 - y0);
            R(x, '#111', 22 + l, 60, 9, 4); R(x, '#111', 33 - l, 60, 9, 4);
        }
        // torso: tweed jacket, shirt, tie, badge
        R(x, tweedDark, 19, 19 + y0, 26, 27);
        R(x, tweed, 20, 20 + y0, 24, 25);
        for (var i = 0; i < 20; i++) R(x, 'rgba(0,0,0,0.18)', 20 + (i * 7) % 24, 21 + y0 + (i * 5) % 23, 1, 1);
        poly(x, '#efefef', [28, 20 + y0, 36, 20 + y0, 32, 31 + y0]);
        poly(x, '#c0392b', [31, 21 + y0, 33, 21 + y0, 34, 32 + y0, 32, 35 + y0, 30, 32 + y0]);
        line(x, tweedDark, 1, [27, 20 + y0, 31, 33 + y0]); line(x, tweedDark, 1, [37, 20 + y0, 33, 33 + y0]);
        R(x, '#f4f1e8', 37, 26 + y0, 7, 9);
        drawText(x, '2', 38, 27 + y0, '#c0392b', 1);
        // left arm holding manuscript
        R(x, tweedDark, 13, 21 + y0, 7, 19); R(x, tweed, 14, 22 + y0, 5, 17);
        R(x, '#f2eee2', 6, 33 + y0, 12, 15); R(x, '#d8d2c0', 7, 34 + y0, 12, 15);
        R(x, '#f7f4ea', 5, 32 + y0, 12, 15);
        for (var ln = 0; ln < 5; ln++) R(x, '#9c968a', 7, 35 + y0 + ln * 2, 8, 1);
        R(x, '#c0392b', 6, 42 + y0, 10, 1); R(x, '#c0392b', 8, 40 + y0, 1, 5);
        R(x, skin, 15, 38 + y0, 5, 4);
        // right arm with red pen
        if (f === FR.ATTACK) {
            R(x, tweedDark, 44, 20 + y0, 10, 8); R(x, tweed, 45, 21 + y0, 8, 6);
            R(x, skin, 52, 20 + y0, 5, 6);
            line(x, '#c0392b', 3, [55, 22 + y0, 58, 12 + y0]);
            R(x, '#f4d03f', 56, 10 + y0, 3, 2);
            muzzle(x, 58, 9 + y0, 7, '#ff4d4d', '#ffe0e0');
        } else {
            R(x, tweedDark, 44, 21 + y0, 7, 19); R(x, tweed, 45, 22 + y0, 5, 17);
            R(x, skin, 45, 38 + y0, 5, 4);
            line(x, '#c0392b', 2, [48, 42 + y0, 52, 34 + y0]);
        }
        // head
        R(x, skinDark, 24, 5 + y0, 16, 16);
        R(x, skin, 25, 5 + y0, 14, 15);
        R(x, '#c8c8c8', 23, 8 + y0, 3, 7); R(x, '#c8c8c8', 38, 8 + y0, 3, 7);
        R(x, '#dedede', 26, 4 + y0, 12, 1);
        if (f >= FR.DIE1) {
            line(x, '#222', 1, [27, 10 + y0, 30, 13 + y0]); line(x, '#222', 1, [30, 10 + y0, 27, 13 + y0]);
            line(x, '#222', 1, [34, 10 + y0, 37, 13 + y0]); line(x, '#222', 1, [37, 10 + y0, 34, 13 + y0]);
            ellipse(x, '#5a2a1a', 32, 17 + y0, 2, 1.5);
        } else {
            R(x, '#1a1a1a', 25, 10 + y0, 6, 5); R(x, '#1a1a1a', 33, 10 + y0, 6, 5); R(x, '#1a1a1a', 31, 11 + y0, 2, 1);
            R(x, '#dfeef5', 26, 11 + y0, 4, 3); R(x, '#dfeef5', 34, 11 + y0, 4, 3);
            R(x, f === FR.ATTACK ? '#ff3b30' : '#222', 28, 12 + y0, 2, 2); R(x, f === FR.ATTACK ? '#ff3b30' : '#222', 34, 12 + y0, 2, 2);
            R(x, '#fff', 26, 11 + y0, 1, 1); R(x, '#fff', 34, 11 + y0, 1, 1);
            line(x, '#555', 1.5, [25, 8 + y0, 31, 10 + y0]); line(x, '#555', 1.5, [39, 8 + y0, 33, 10 + y0]);
            line(x, '#6b3a2a', 1, [28, 18 + y0, 32, 16 + y0, 36, 18 + y0]);
        }
    }

    function buildEnemySprites() {
        addEnemySprites('PHAGE', drawPhage);
        addEnemySprites('ECOLI', drawEcoli);
        addEnemySprites('PROTEASE', drawProtease);
        addEnemySprites('REVIEWER', drawReviewer);
    }

    // --- PICKUPS ---
    function shadow(x, w) { ellipse(x, 'rgba(0,0,0,0.55)', 32, 62, w, 2); }

    function buildItemSprites() {
        addSprite('COFFEE', function (x) {
            shadow(x, 11);
            line(x, '#e9e6df', 3, [40, 49, 45, 52, 45, 56, 40, 59]);
            R(x, '#cfcac0', 23, 46, 18, 17); R(x, '#f2efe8', 24, 46, 16, 16); R(x, '#ffffff', 25, 46, 3, 16);
            R(x, MAROON, 24, 51, 16, 5);
            drawText(x, 'U', 32, 50, '#f4f1e8', 1, 'center');
            ellipse(x, '#f2efe8', 32, 46, 8, 2); ellipse(x, '#4a2c16', 32, 46, 6.5, 1.3);
            line(x, '#e8e8e8', 1, [28, 43, 26, 39, 28, 35, 26, 31]);
            line(x, '#e8e8e8', 1, [35, 42, 33, 38, 35, 34]);
        });
        addSprite('FIRSTAID', function (x) {
            shadow(x, 14);
            R(x, '#9a9a9a', 27, 40, 10, 4); R(x, '#cfcfcf', 29, 41, 6, 3);
            R(x, '#bdbdbd', 18, 43, 28, 20); R(x, '#f5f5f5', 18, 43, 28, 18);
            R(x, '#d42b2b', 29, 46, 6, 13); R(x, '#d42b2b', 25, 50, 14, 5);
        });
        addSprite('TIPS', function (x) {
            shadow(x, 15);
            R(x, '#123f80', 17, 50, 30, 13); R(x, '#1f5fbf', 17, 50, 30, 11);
            R(x, '#2a2a2a', 17, 45, 30, 5);
            for (var r = 0; r < 2; r++) for (var c = 0; c < 9; c++) R(x, '#f2d24a', 19 + c * 3, 46 + r * 2, 2, 1);
            R(x, 'rgba(210,230,255,0.9)', 17, 38, 30, 1); R(x, 'rgba(170,200,230,0.9)', 17, 38, 1, 7); R(x, 'rgba(170,200,230,0.9)', 46, 38, 1, 7);
            drawText(x, '1000', 32, 53, '#e8f0ff', 1, 'center');
        });
        addSprite('MULTI', drawMultiPickup);
        addSprite('LN2', function (x) {
            shadow(x, 12);
            R(x, '#8d969c', 21, 30, 22, 33); R(x, '#c9d1d6', 22, 30, 20, 32); R(x, '#eef3f6', 25, 30, 4, 32);
            R(x, '#6b7479', 24, 25, 16, 5); R(x, '#1f5fbf', 28, 21, 8, 4);
            for (var i = 0; i < 9; i++) R(x, '#ffffff', 22 + (i * 7) % 20, 34 + (i * 11) % 26, 2, 1);
            R(x, '#1f5fbf', 22, 44, 20, 5); drawText(x, 'N', 32, 43, '#fff', 1, 'center');
            ellipse(x, 'rgba(235,245,255,0.85)', 36, 18, 6, 3); ellipse(x, 'rgba(235,245,255,0.8)', 28, 14, 5, 2.5);
        });
        addSprite('KEY', function (x) {
            shadow(x, 10);
            line(x, MAROON, 2, [26, 44, 24, 32, 32, 26, 40, 32, 38, 44]);
            R(x, '#7a5c12', 21, 43, 22, 18); R(x, '#e0b73a', 22, 44, 20, 16);
            R(x, '#f7e7a8', 22, 44, 20, 3);
            R(x, '#4a3a0a', 25, 49, 6, 7); R(x, '#d9a877', 26, 50, 4, 4);
            R(x, '#4a3a0a', 33, 50, 7, 1); R(x, '#4a3a0a', 33, 53, 6, 1);
        });
        addSprite('FLASK', function (x) {
            shadow(x, 12);
            poly(x, '#a9c4cf', [29, 34, 35, 34, 35, 44, 45, 62, 19, 62, 29, 44]);
            poly(x, '#d8eef5', [30, 35, 34, 35, 34, 45, 43, 61, 21, 61, 30, 45]);
            poly(x, '#35c46a', [25.5, 52, 38.5, 52, 43, 61, 21, 61]);
            R(x, '#7fe0a0', 27, 52, 10, 1);
            ellipse(x, '#c9f5d8', 30, 57, 1.5, 1.5); ellipse(x, '#c9f5d8', 35, 55, 1, 1); ellipse(x, '#c9f5d8', 33, 48, 1, 1);
            R(x, '#8aa6b0', 28, 33, 8, 2);
        });
        addSprite('GRANT', function (x) {
            shadow(x, 21);
            R(x, '#5b8a4a', 10, 44, 44, 19); R(x, '#dff2d2', 11, 45, 42, 17);
            drawText(x, 'GRANT', 13, 47, '#2e6b3a', 1);
            R(x, '#7ea86c', 13, 56, 22, 1); drawText(x, '5M', 51, 54, '#2e6b3a', 1, 'right');
        });
        addSprite('COVER', function (x) {
            shadow(x, 16);
            R(x, '#222', 16, 29, 32, 34); R(x, '#0f2440', 17, 30, 30, 32);
            R(x, '#f4f1e8', 17, 30, 30, 9);
            drawText(x, 'COVER', 32, 31, MAROON, 1, 'center');
            for (var y = 42; y < 60; y++) {
                var s = Math.sin(y * 0.5);
                R(x, '#5a9fa6', Math.round(32 + s * 8), y, 2, 1);
                R(x, '#e0645c', Math.round(32 - s * 8), y, 2, 1);
            }
            ellipse(x, '#f0d24a', 40, 45, 3, 3);
        });
        addSprite('MEDAL', function (x) {
            shadow(x, 10);
            poly(x, MAROON, [24, 30, 30, 30, 34, 46, 30, 48]);
            poly(x, '#a01818', [40, 30, 34, 30, 30, 46, 34, 48]);
            ellipse(x, '#8a6a10', 32, 52, 10, 10); ellipse(x, '#e6be3a', 32, 52, 9, 9); ellipse(x, '#f7dc7a', 31, 51, 6, 6);
            var st = [];
            for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2 : 5; st.push(31 + Math.cos(a) * r, 51 + Math.sin(a) * r); }
            poly(x, '#b8912e', st);
        });
        addSprite('TENURE', function (x) {
            ellipse(x, 'rgba(255,230,120,0.75)', 32, 48, 26, 16);
            ellipse(x, 'rgba(255,245,190,0.9)', 32, 48, 20, 11);
            R(x, '#e8dcb5', 12, 41, 40, 14); R(x, '#f7f0d8', 12, 42, 40, 12);
            ellipse(x, '#cdbd8e', 12, 48, 3, 8); ellipse(x, '#cdbd8e', 52, 48, 3, 8);
            drawText(x, 'TENURE', 32, 44, MAROON, 1, 'center');
            R(x, '#c0392b', 30, 55, 4, 6);
        });
    }

    // --- DECORATIONS ---
    function buildDecorSprites() {
        addSprite('BENCH', function (x) {
            R(x, '#6b7277', 4, 38, 56, 26); R(x, '#9aa3a8', 5, 39, 54, 24);
            R(x, '#7b8388', 31, 39, 2, 24);
            R(x, '#5a6166', 12, 46, 14, 1); R(x, '#5a6166', 38, 46, 14, 1);
            R(x, '#2a2f33', 17, 43, 4, 2); R(x, '#2a2f33', 43, 43, 4, 2);
            R(x, '#141414', 2, 34, 60, 5); R(x, '#303030', 2, 34, 60, 1);
            // microscope
            R(x, '#e9ecee', 36, 30, 16, 4); R(x, '#cfd5d9', 44, 14, 5, 16);
            poly(x, '#e9ecee', [40, 12, 49, 10, 50, 16, 42, 19]);
            R(x, '#222', 38, 8, 3, 6); R(x, '#222', 42, 7, 3, 6);
            R(x, '#555', 40, 20, 3, 7); R(x, '#e9ecee', 38, 26, 10, 2);
            // tube rack
            R(x, '#1f5fbf', 8, 30, 18, 4);
            for (var i = 0; i < 5; i++) { R(x, '#e6eef2', 9 + i * 3.5, 22, 2, 9); R(x, ['#e05050', '#3fbf6f', '#f0d24a', '#4a8fe0', '#b57edc'][i], 9 + i * 3.5, 26, 2, 5); }
        });
        addSprite('PLANT', function (x) {
            poly(x, '#8a4a24', [22, 48, 42, 48, 39, 63, 25, 63]);
            R(x, '#a85c2e', 21, 46, 22, 4);
            var leaves = [[32, 20, 4, 14], [24, 28, 4, 11], [40, 28, 4, 11], [18, 38, 3, 9], [46, 38, 3, 9], [28, 34, 4, 10], [36, 34, 4, 10]];
            leaves.forEach(function (l, i) {
                ellipse(x, i % 2 ? '#2e7d32' : '#3f9b44', l[0], l[1], l[2], l[3]);
                R(x, '#1b5e20', l[0], l[1] - l[3] + 3, 1, l[3] * 2 - 4);
            });
        });
        addSprite('CYLINDER', function (x) {
            R(x, '#1b4d20', 25, 16, 14, 47); R(x, '#2e7d32', 26, 16, 12, 46); R(x, '#5fae62', 28, 16, 3, 46);
            ellipse(x, '#2e7d32', 32, 16, 6, 4);
            R(x, '#9aa3a8', 29, 6, 6, 8); R(x, '#cfd5d9', 30, 6, 2, 8); R(x, '#666', 27, 9, 10, 2);
            R(x, '#f4f1e8', 26, 30, 12, 7); drawText(x, 'O', 32, 30, '#1b4d20', 1, 'center');
            line(x, '#b0b0b0', 1, [20, 28, 26, 26]); line(x, '#b0b0b0', 1, [44, 28, 38, 26]);
        });
        addSprite('DRUM', function (x) {
            R(x, '#9c7a10', 19, 34, 26, 29); R(x, '#f2c230', 20, 34, 24, 28); R(x, '#f7dc7a', 23, 34, 4, 28);
            ellipse(x, '#d6aa20', 32, 34, 12, 3); ellipse(x, '#b8901a', 32, 34, 9, 2);
            R(x, '#9c7a10', 20, 42, 24, 2); R(x, '#9c7a10', 20, 54, 24, 2);
            ellipse(x, '#1a1a1a', 29, 48, 2, 2); ellipse(x, '#1a1a1a', 35, 48, 2, 2); ellipse(x, '#1a1a1a', 32, 45, 2, 2);
            ellipse(x, '#f2c230', 32, 47.5, 1, 1);
        });
        addSprite('LAMP', function (x) {
            R(x, '#555', 31, 0, 2, 4);
            R(x, '#7a7a7a', 14, 4, 36, 5);
            R(x, '#fffbe6', 16, 8, 32, 3);
            R(x, '#fff3b0', 18, 11, 28, 1);
        });
        addSprite('GLASS', function (x) {
            ellipse(x, '#3a6b8a', 32, 60, 20, 3);
            ellipse(x, '#5a9fc6', 30, 59, 13, 1.8);
            poly(x, '#d8eef5', [14, 62, 18, 55, 21, 62]);
            poly(x, '#bfe0ea', [40, 62, 45, 57, 47, 62]);
            poly(x, '#eaf8fc', [26, 63, 29, 58, 33, 63]);
            poly(x, '#d8eef5', [48, 59, 52, 56, 53, 60]);
        });
        addSprite('CENTRIFUGE', function (x) {
            R(x, '#a7adb2', 14, 38, 36, 25); R(x, '#eceff1', 15, 39, 34, 23);
            ellipse(x, '#cfd5d9', 32, 38, 18, 5); ellipse(x, '#eceff1', 32, 37, 16, 4);
            ellipse(x, '#9fb6c2', 32, 37, 9, 2);
            R(x, '#263238', 20, 48, 24, 7); drawText(x, '14K', 32, 48, '#39d353', 1, 'center');
            R(x, '#5a9fa6', 15, 58, 34, 2);
        });
        addSprite('COATRACK', function (x) {
            R(x, '#4a2f18', 31, 4, 3, 58); R(x, '#4a2f18', 22, 61, 21, 2);
            line(x, '#4a2f18', 2, [32, 8, 24, 5]); line(x, '#4a2f18', 2, [33, 8, 41, 5]);
            poly(x, '#cfcfcf', [22, 10, 42, 10, 46, 50, 18, 50]);
            poly(x, '#f7f7f7', [23, 11, 41, 11, 44, 48, 20, 48]);
            poly(x, '#dcdcdc', [30, 11, 34, 11, 33, 30, 31, 30]);
            R(x, MAROON, 36, 20, 4, 2);
            R(x, '#9e9e9e', 26, 30, 1, 18);
        });
        addSprite('DESK', function (x) {
            R(x, '#3e2714', 4, 38, 56, 26); R(x, '#6d4627', 5, 39, 54, 24);
            R(x, '#4a2e17', 8, 44, 18, 16); R(x, '#4a2e17', 38, 44, 18, 16);
            R(x, '#c9a33a', 16, 51, 2, 2); R(x, '#c9a33a', 46, 51, 2, 2);
            R(x, '#2a180a', 2, 34, 60, 5); R(x, '#7b5230', 2, 34, 60, 1);
            // paper stacks
            for (var i = 0; i < 7; i++) R(x, i % 2 ? '#e8e3d3' : '#f7f4ea', 8, 33 - i * 2, 16, 2);
            for (var j = 0; j < 4; j++) R(x, j % 2 ? '#e8e3d3' : '#f7f4ea', 40, 33 - j * 2, 14, 2);
            R(x, '#c0392b', 8, 20, 16, 1);
            line(x, '#c0392b', 2, [28, 32, 36, 29]);
        });
    }

    // =================================================================
    //  FIRST-PERSON WEAPONS — 280x150 canvases, three frames each:
    //  0 idle, 1 dispense (plunger pressed), 2 eject (tip popped off)
    //
    //  The pipettes follow a modern air-displacement pipette: plunger
    //  button, tip-ejector button, finger hook, volume display, grip,
    //  shaft, ejector sleeve, tip cone and a disposable blue P1000 tip.
    //  Local drawing frame: plunger at y=0, tip toward +y, finger hook on -x.
    // =================================================================
    var W = { NOTEBOOK: 0, PIPETTE: 1, MULTI: 2, LN2: 3 };
    var WPN_W = 280, WPN_H = 150;
    var weaponFrames = [], weaponNozzles = [], weaponIcons = [];
    var tipSprite = null;

    var GLOVE = '#7d6fd6', GLOVE_D = '#4a3f9c', GLOVE_M = '#6b5dc6', GLOVE_L = '#aea4f4';
    var PIP = {
        body: '#eef1f3', shade: '#cdd4d9', edge: '#66717a',
        plunger: '#2f6fd6', plungerD: '#1b4a9a',
        tip: 'rgba(61,143,232,0.9)', tipL: 'rgba(205,230,255,0.95)', tipD: 'rgba(24,86,168,0.95)'
    };

    // Held like a pistol: hand lower right, tip aimed at the crosshair
    var POSE = {
        1: { x: 259, y: 135, rot: 2.094, s: 0.9 },
        2: { x: 237, y: 124, rot: 2.094, s: 0.85 }
    };
    var TIP_Y = 112; // where the tip seats on the cone

    function posePoint(p, lx, ly) {
        var c = Math.cos(p.rot), s = Math.sin(p.rot);
        return { x: p.x + p.s * (lx * c - ly * s), y: p.y + p.s * (lx * s + ly * c) };
    }

    // Disposable tip: collar at y0, point at y0 + len
    function drawTip(x, cx, y0, len, w) {
        poly(x, PIP.tipD, [cx - w, y0, cx + w, y0, cx + w - 1, y0 + 7, cx + 1.3, y0 + len, cx - 1.3, y0 + len, cx - w + 1, y0 + 7]);
        poly(x, PIP.tip, [cx - w + 1, y0 + 1, cx + w - 1, y0 + 1, cx + w - 2, y0 + 7, cx + 0.5, y0 + len - 1, cx - 0.5, y0 + len - 1, cx - w + 2, y0 + 7]);
        R(x, PIP.tipD, cx - w + 1, y0 + 4, 2 * w - 2, 1);
        line(x, PIP.tipL, 1, [cx - w + 2.5, y0 + 2, cx - w + 2.5, y0 + 6, cx - 0.6, y0 + len - 5]);
    }

    function drawPipetteBody(x, pressed, ejecting) {
        var p = pressed ? 6 : 0, e = ejecting ? 5 : 0;
        // tip-ejector button, beside the plunger on the hook side
        R(x, PIP.edge, -17, 5 + e, 8, 11);
        R(x, '#b9c2c8', -16, 6 + e, 6, 9);
        R(x, '#e1e6ea', -16, 6 + e, 2, 8);
        // plunger rod and colour-coded plunger button
        R(x, '#8d979e', -2.5, 3 + p, 5, 12);
        roundRect(x, PIP.plungerD, -9, p - 5, 18, 11, 4);
        roundRect(x, PIP.plunger, -8, p - 4, 16, 9, 3.5);
        R(x, '#a3c4f5', -5, p - 3, 7, 2);
        // head with volume-adjust ridges
        roundRect(x, PIP.edge, -13, 13, 26, 15, 6);
        roundRect(x, PIP.body, -12, 14, 24, 13, 5);
        for (var g = -9; g <= 9; g += 3) R(x, PIP.shade, g, 15, 1, 5);
        // grip
        poly(x, PIP.edge, [-12, 26, 12, 26, 9, 78, -9, 78]);
        poly(x, PIP.body, [-11, 27, 11, 27, 8, 77, -8, 77]);
        poly(x, PIP.shade, [5, 27, 11, 27, 8, 77, 3.5, 77]);
        // volume display window
        R(x, '#11181c', -5, 27, 10, 13);
        R(x, '#e8f0f4', -2.5, 29, 5, 2); R(x, '#e8f0f4', -2.5, 32.5, 5, 2); R(x, '#e8f0f4', -2.5, 36, 5, 2);
        // finger hook, resting over the index finger
        poly(x, PIP.edge, [-11, 30, -24, 32, -28, 40, -25, 49, -17, 48, -20, 41, -11, 40]);
        poly(x, PIP.body, [-11, 31, -23, 33, -26.5, 40, -24, 47.5, -18.5, 47, -21.5, 41, -11, 39]);
        // P1000 colour band
        R(x, PIP.plunger, -9, 77, 18, 3);
        // ejector arm down the hook side
        line(x, PIP.edge, 2, [-14, 16, -12.5, 30]);
    }

    function drawPipetteShaft(x, tipOn) {
        poly(x, PIP.edge, [-8.5, 80, 8.5, 80, 6, 95, -6, 95]);
        poly(x, '#dde3e7', [-7.5, 80, 7.5, 80, 5, 95, -5, 95]);
        poly(x, '#5f686e', [-5.5, 95, 5.5, 95, 4.5, 108, -4.5, 108]);
        poly(x, '#9aa3a9', [-4.5, 95, 0, 95, 0, 108, -3.5, 108]);
        poly(x, '#b9c2c8', [-3, 108, 3, 108, 2, 115, -2, 115]);
        if (tipOn) drawTip(x, 0, TIP_Y, 46, 5.5);
    }

    var MULTI_X = [];
    for (var mi = 0; mi < 8; mi++) MULTI_X.push(-31.5 + mi * 9);

    function drawManifold(x, tipsOn) {
        poly(x, PIP.edge, [-8, 80, 8, 80, 7, 87, -7, 87]);
        roundRect(x, PIP.edge, -38, 86, 76, 15, 4);
        roundRect(x, '#e3e8eb', -37, 87, 74, 12, 4);
        R(x, PIP.shade, -37, 94, 74, 5);
        R(x, PIP.plunger, -34, 89, 12, 2);
        for (var i = 0; i < 8; i++) {
            var cx = MULTI_X[i];
            poly(x, '#5f686e', [cx - 2.6, 101, cx + 2.6, 101, cx + 1.8, 108, cx - 1.8, 108]);
            if (tipsOn) drawTip(x, cx, 107, 30, 3.4);
        }
    }

    // Liquid shot leaving the tip(s)
    function drawSpray(x, xs, y0) {
        xs.forEach(function (cx, i) {
            ellipse(x, 'rgba(120,190,255,0.9)', cx, y0 + 6, 3, 6);
            ellipse(x, 'rgba(210,236,255,0.95)', cx + (i % 2 ? 1 : -1), y0 + 15, 2, 3.5);
            ellipse(x, 'rgba(160,210,255,0.85)', cx + (i % 2 ? -2 : 2), y0 + 23, 1.5, 2.5);
        });
    }

    // --- Nitrile-gloved right hand ---
    // Behind the pipette: sleeve, wrist, back of the hand and the thumb reaching the plunger
    function drawHandBehind(x, pressed) {
        var p = pressed ? 6 : 0;
        // lab-coat sleeve heading off the bottom of the screen
        poly(x, '#bdbdbd', [0, 56, 36, 46, 88, -70, 30, -92]);
        poly(x, '#f5f5f5', [3, 54, 33, 46, 84, -68, 32, -88]);
        poly(x, '#dedede', [20, 50, 33, 46, 84, -68, 66, -76]);
        // wrist and back of the hand under the grip
        poly(x, GLOVE_D, [-6, 76, 24, 70, 36, 24, 30, -6, 8, -2, 0, 30]);
        poly(x, GLOVE, [-4, 74, 22, 68, 33, 24, 28, -4, 9, 0, 2, 30]);
        poly(x, GLOVE_M, [16, 70, 22, 68, 33, 24, 28, -4, 24, 10, 26, 40]);
        R(x, '#e6e6e6', 6, -8, 30, 6);   // glove cuff edge against the sleeve
        // thumb running up to the plunger button
        poly(x, GLOVE_D, [8, 14, 22, 8, 12, p - 8, 0, p - 11, -4, p - 4]);
        poly(x, GLOVE, [9, 12, 20, 7, 11, p - 7, 1, p - 9, -2, p - 4]);
        ellipse(x, GLOVE_L, 3, p - 7, 3.5, 1.8);
    }

    // In front of the pipette: four fingers curled around the grip below the finger hook
    function drawHandFront(x) {
        var widths = [30, 29, 27, 24];
        for (var i = 0; i < 4; i++) {
            var fy = 48 + i * 7.5, w = widths[i], left = 16 - w;
            roundRect(x, GLOVE_D, left - 1, fy - 0.5, w + 2, 8.5, 4);
            roundRect(x, i % 2 ? GLOVE_M : GLOVE, left, fy, w, 7, 3.5);
            // finger tip and knuckle crease
            ellipse(x, GLOVE_L, left + 3.5, fy + 2.5, 2.2, 1.4);
            R(x, GLOVE_D, left + 9, fy + 1, 1, 5);
            R(x, GLOVE_D, left + 18, fy + 1, 1, 5);
        }
    }

    function withPose(x, p, recoil, draw) {
        x.save();
        x.translate(p.x + recoil * 1.5, p.y + recoil * 2);
        x.rotate(p.rot);
        x.scale(p.s, p.s);
        draw();
        x.restore();
    }

    function drawPipetteWeapon(x, f) {
        withPose(x, POSE[1], f === 1 ? 1 : 0, function () {
            drawHandBehind(x, f === 1);
            drawPipetteBody(x, f === 1, f === 2);
            drawPipetteShaft(x, f !== 2);
            drawHandFront(x);
            if (f === 1) drawSpray(x, [0], TIP_Y + 48);
        });
    }

    function drawMultiWeapon(x, f) {
        withPose(x, POSE[2], f === 1 ? 1 : 0, function () {
            drawHandBehind(x, f === 1);
            drawPipetteBody(x, f === 1, f === 2);
            drawManifold(x, f !== 2);
            drawHandFront(x);
            if (f === 1) drawSpray(x, MULTI_X, 139);
        });
    }

    function drawLN2Weapon(x, f) {
        var dy = f === 1 ? 4 : f === 2 ? 2 : 0;
        poly(x, '#6b7479', [58, 82, 112, 82, 80, 36 + dy, 60, 40 + dy]);
        poly(x, '#c9d1d6', [62, 82, 104, 82, 78, 38 + dy, 62, 42 + dy]);
        poly(x, '#eef3f6', [66, 82, 78, 82, 70, 40 + dy, 65, 42 + dy]);
        for (var i = 0; i < 10; i++) R(x, '#ffffff', 68 + (i * 13) % 28, 50 + (i * 7) % 28, 3, 1);
        R(x, '#1f5fbf', 64, 58 + dy, 30, 5);
        ellipse(x, '#2a2f33', 70, 38 + dy, 8, 3);
        ellipse(x, '#0f1316', 70, 38 + dy, 5, 2);
        line(x, '#1f5fbf', 3, [98, 80, 110, 64, 118, 70]);
        ellipse(x, GLOVE_D, 50, 72, 14, 10); ellipse(x, GLOVE, 50, 71, 13, 9); ellipse(x, GLOVE_L, 46, 67, 5, 2);
        if (f === 1) {
            ellipse(x, 'rgba(230,245,255,0.95)', 70, 26, 14, 9);
            ellipse(x, 'rgba(200,230,255,0.95)', 64, 18, 10, 7);
            ellipse(x, '#ffffff', 72, 30, 7, 4);
        }
        if (f === 2) {
            ellipse(x, 'rgba(220,240,255,0.9)', 58, 16, 16, 9);
            ellipse(x, 'rgba(200,230,255,0.9)', 80, 12, 14, 8);
            ellipse(x, 'rgba(240,250,255,0.9)', 70, 22, 10, 6);
        }
    }

    function drawNotebook(x, bx, by) {
        R(x, '#111', bx, by, 36, 44);
        for (var i = 0; i < 60; i++) R(x, '#e0e0e0', bx + (i * 17) % 34 + 1, by + (i * 29) % 42 + 1, (i % 3) + 1, 1);
        R(x, '#1a1a1a', bx, by, 5, 44);
        R(x, '#f4f1e8', bx + 9, by + 10, 22, 12);
        drawText(x, 'LAB', bx + 20, by + 13, '#111', 1, 'center');
    }

    function drawNotebookWeapon(x, f) {
        var ox = f === 1 ? 14 : f === 2 ? -30 : 0, oy = f === 1 ? -12 : f === 2 ? -18 : 0;
        var bx = 76 + ox, by = 38 + oy;
        drawNotebook(x, bx, by);
        ellipse(x, GLOVE_D, bx + 4, by + 34, 11, 12); ellipse(x, GLOVE, bx + 4, by + 33, 10, 11);
        ellipse(x, GLOVE_L, bx + 1, by + 28, 3, 2);
        R(x, '#f2f2f2', bx - 8, by + 42, 26, 10);
        if (f === 2) {
            line(x, 'rgba(255,255,255,0.8)', 1, [bx + 40, by + 4, bx + 56, by]);
            line(x, 'rgba(255,255,255,0.8)', 1, [bx + 40, by + 16, bx + 60, by + 14]);
            line(x, 'rgba(255,255,255,0.8)', 1, [bx + 40, by + 28, bx + 56, by + 30]);
        }
    }

    function buildWeapons() {
        var draws = [drawNotebookWeapon, drawPipetteWeapon, drawMultiWeapon, drawLN2Weapon];
        for (var w = 0; w < draws.length; w++) {
            weaponFrames[w] = [];
            for (var f = 0; f < 3; f++) {
                var c = makeCanvas(WPN_W, WPN_H), x = c.getContext('2d');
                // Notebook and LN2 are laid out on 128x80; anchor them bottom-centre
                if (w === W.NOTEBOOK || w === W.LN2) x.translate((WPN_W - 128) / 2, WPN_H - 80);
                draws[w](x, f);
                weaponFrames[w][f] = c;
            }
        }
        // Where spent tips leave the pipette, in canvas coordinates
        weaponNozzles[W.PIPETTE] = [posePoint(POSE[1], 0, TIP_Y)];
        weaponNozzles[W.MULTI] = MULTI_X.map(function (cx) { return posePoint(POSE[2], cx, 107); });
        tipSprite = makeCanvas(14, 52);
        drawTip(tipSprite.getContext('2d'), 7, 2, 46, 5.5);
    }

    // Status bar icons: just the weapon, no hand (48x24)
    function buildWeaponIcons() {
        for (var w = 0; w < 4; w++) {
            var c = makeCanvas(48, 24), x = c.getContext('2d');
            if (w === W.PIPETTE || w === W.MULTI) {
                var s = w === W.MULTI ? 0.26 : 0.27;
                x.save();
                x.translate(3, w === W.MULTI ? 12 : 11);
                x.rotate(-Math.PI / 2);
                x.scale(s, s);
                drawPipetteBody(x, false, false);
                if (w === W.PIPETTE) drawPipetteShaft(x, true); else drawManifold(x, true);
                x.restore();
            } else if (w === W.NOTEBOOK) {
                x.save(); x.translate(15, 1); x.scale(0.5, 0.5); drawNotebook(x, 0, 0); x.restore();
            } else {
                x.save(); x.translate(2, 21); x.rotate(-Math.PI / 2); x.scale(0.5, 0.5);
                R(x, '#6b7479', 0, 0, 20, 88); R(x, '#c9d1d6', 2, 0, 16, 86); R(x, '#eef3f6', 4, 0, 4, 86);
                R(x, '#1f5fbf', 2, 40, 16, 8); R(x, '#2a2f33', 4, 86, 12, 6);
                x.restore();
            }
            weaponIcons[w] = c;
        }
    }

    // Multichannel pickup lying on the floor
    function drawMultiPickup(x) {
        shadow(x, 22);
        x.save();
        x.translate(5, 49);
        x.rotate(-Math.PI / 2 + 0.12);
        x.scale(0.38, 0.38);
        drawPipetteBody(x, false, false);
        drawManifold(x, true);
        x.restore();
    }

    // =================================================================
    //  STATUS BAR FACE — the scientist gets progressively more frazzled
    // =================================================================
    var faces = [], faceGrin, faceDead;

    function drawFace(x, level, look, mode) {
        var skin = mode === 'dead' ? '#9aa39e' : '#e7b98f', skinD = mode === 'dead' ? '#79817c' : '#c9976b';
        var fx = look === 1 ? -1 : look === 2 ? 1 : 0;
        R(x, '#f2f2f2', 2, 26, 20, 6); R(x, '#cfcfcf', 11, 26, 2, 6);
        R(x, skinD, 4, 5, 16, 22); R(x, skin, 5, 5, 14, 21);
        R(x, skin, 3, 12, 2, 5); R(x, skin, 19, 12, 2, 5);
        // hair (messier as health drops)
        R(x, '#4a2f1b', 4, 1, 16, 6);
        R(x, '#4a2f1b', 3, 3, 2, 8); R(x, '#4a2f1b', 19, 3, 2, 8);
        if (level >= 3) { R(x, '#4a2f1b', 2, 0, 3, 2); R(x, '#4a2f1b', 16, 0, 4, 1); R(x, '#4a2f1b', 20, 2, 2, 2); }
        // safety goggles pushed up on forehead
        var gy = level >= 3 ? 6 : 5, tilt = level >= 3 ? 1 : 0;
        R(x, '#2a6fd6', 3, gy + 1, 18, 2);
        R(x, '#1b3f73', 6 + fx, gy, 5, 4 + tilt); R(x, '#1b3f73', 13 + fx, gy - tilt, 5, 4 + tilt);
        R(x, '#cfe8ff', 7 + fx, gy + 1, 3, 2); R(x, '#cfe8ff', 14 + fx, gy + 1 - tilt, 3, 2);
        if (level >= 5) line(x, '#1b3f73', 1, [14 + fx, gy - tilt, 17 + fx, gy + 3]);
        // eyes
        if (mode === 'dead') {
            line(x, '#222', 1, [7, 12, 10, 15]); line(x, '#222', 1, [10, 12, 7, 15]);
            line(x, '#222', 1, [14, 12, 17, 15]); line(x, '#222', 1, [17, 12, 14, 15]);
        } else {
            var lid = level >= 6 ? 1 : 0;
            R(x, '#fff', 7 + fx, 12 + lid, 3, 3 - lid); R(x, '#fff', 14 + fx, 12 + lid, 3, 3 - lid);
            R(x, '#222', 8 + fx * 2, 13, 1, 2); R(x, '#222', 15 + fx * 2, 13, 1, 2);
            R(x, '#4a2f1b', 6 + fx, 11 - (level >= 4 ? 0 : 1), 5, 1); R(x, '#4a2f1b', 13 + fx, 11 - (level >= 4 ? 0 : 1), 5, 1);
        }
        R(x, skinD, 11 + fx, 15, 2, 4);
        // mouth
        if (mode === 'grin') {
            R(x, '#5a1a1a', 7 + fx, 20, 10, 3); R(x, '#fff', 8 + fx, 20, 8, 1);
        } else if (mode === 'dead') {
            R(x, '#444', 8, 22, 8, 1);
        } else if (level <= 1) {
            R(x, '#8a3b2b', 8 + fx, 21, 8, 1); R(x, '#8a3b2b', 7 + fx, 20, 1, 1); R(x, '#8a3b2b', 16 + fx, 20, 1, 1);
        } else if (level <= 3) {
            R(x, '#8a3b2b', 8 + fx, 21, 8, 1);
        } else {
            R(x, '#5a1a1a', 9 + fx, 20, 6, 3);
        }
        // accumulated lab damage
        if (level >= 1 && mode !== 'dead') R(x, '#9fd0ff', 18, 9, 1, 2);
        if (level >= 2) { R(x, 'rgba(40,40,40,0.55)', 5, 17, 4, 2); }
        if (level >= 4) { R(x, '#6fcf3a', 15, 17, 3, 3); R(x, '#f4f1e8', 3, 7, 3, 5); R(x, '#d9c9a0', 3, 9, 3, 1); }
        if (level >= 5) { R(x, 'rgba(40,40,40,0.6)', 12, 23, 6, 2); R(x, 'rgba(40,40,40,0.5)', 6, 6, 5, 2); }
        if (level >= 6) { R(x, '#b03a2e', 17, 13, 2, 3); R(x, 'rgba(40,40,40,0.5)', 14, 3, 4, 3); }
    }

    function buildFaces() {
        for (var lv = 0; lv < 7; lv++) {
            faces[lv] = [];
            for (var lk = 0; lk < 3; lk++) {
                var c = makeCanvas(24, 32);
                drawFace(c.getContext('2d'), lv, lk, 'normal');
                faces[lv][lk] = c;
            }
        }
        faceGrin = makeCanvas(24, 32); drawFace(faceGrin.getContext('2d'), 0, 0, 'grin');
        faceDead = makeCanvas(24, 32); drawFace(faceDead.getContext('2d'), 6, 0, 'dead');
    }

    var assetsBuilt = false;
    function buildAssets() {
        if (assetsBuilt) return;
        buildTextures();
        buildEnemySprites();
        buildItemSprites();
        buildDecorSprites();
        buildWeapons();
        buildWeaponIcons();
        buildFaces();
        assetsBuilt = true;
    }

    // =================================================================
    //  LEVELS
    //  Walls:   # tile  T periodic poster  B brick  H fume hood  L journals
    //           F -80 freezer  Z biohazard  W whiteboard  X exit switch
    //           S steel  O wood  R framed rejection  N DNA poster
    //           C cinderblock  V window  Q sequencer
    //  Doors:   | door   = BSL-2 locked door (needs keycard)
    //  Player:  ^ v < >  (facing)
    //  Enemies: p phage  e E. coli  q protease  r Reviewer #2
    //  Items:   c coffee  + first aid  a tip box  m multichannel  n LN2 cannon
    //           k keycard  f flask  g grant  j journal cover  o medal  u tenure (1UP)
    //  Decor:   b bench  t plant  y gas cylinder  d waste drum  z centrifuge
    //           h lab coat rack  w desk  * lamp  , broken glassware
    //  Secrets: `push` lists wall cells that slide when used
    // =================================================================
    var LEVELS = [
        {
            name: 'FLOOR 1',
            title: 'THE WET LAB',
            floor: '#6b665f', ceil: '#383838',
            push: [[3, 14]],
            map: [
                '###########HH#HH#HH#HH#HH#HH#HH#',
                '#......#..#...................cV',
                '#.k..p.#..#..............p.....#',
                'T......|..#..bbbb...bbbb..bbb..V',
                '#...p..#*.#....................#',
                '#b.....#..|....*..p.....*....f.T',
                '#.....a#..#....................#',
                '########..#..bbbb...bbbb..bbb..V',
                '########.p#........,........p..#',
                '#t.....#..#.a.........e........#',
                '#......#..#....................V',
                'W.>.*..|..######|###############',
                '#......#.*#d..........zSy.....jS',
                '#....ct#..#............S.......S',
                '###T####..#..p.......p.S..p....S',
                '#....f.#e.#............S.......S',
                'Bg.....#..#....bbb.....S.......S',
                'B+...f.#..|............=...*...X',
                'BBBBBBB#..#............S.......S',
                'C....e.#..#............Z.......S',
                'C.a....|*.#........q...S....p..S',
                'C....a.#..Z.m.a......+.S.......S',
                'C.c....#..#............Syc.....S',
                'CCCCCCC####FZFFZFFZFFZFSSSSSSSSS'
            ]
        },
        {
            name: 'FLOOR 2',
            title: 'THE CORE FACILITY',
            floor: '#555c61', ceil: '#262b2f',
            push: [[15, 3]],
            map: [
                'SSSSSSSSSSSCCCCCCCCCCSSSSSXSSSSS',
                'S.........S..u....o..S........+S',
                'F.k.......Sg........gS.........S',
                'S.......e.SCCCCNCCCCCS.p.......S',
                'S.........Sa.........S.........S',
                'F.........S.p......p.S....q....S',
                'S.....q...|..........S.........S',
                'S.........S..bb..bb..Q.........S',
                'F.........S....*.....Q....*....S',
                'S..p......S....p.....Q.......p.S',
                'S.........S..bb..bb..S.........S',
                'F.......a.S.....e....S.........S',
                'S+........S.........mSj......a.S',
                'SSSSS|SSSSSCCCC|CCCCCSSSS=SSSSSS',
                'Cd..........................e..C',
                'C....*..p......*.........*.....C',
                'C.....................p........C',
                'C..e...............,..........dC',
                'CCCCCC|CCCCCCCC|CCCCCCCCC|CCCCCC',
                'Cy.a.......dCt....tC.z.z...z.z.C',
                'C........e..C..*...C...........C',
                'C...e.......C..^...C..p.....q..C',
                'Cy......f.c.Cc.....Ca....j....+C',
                'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
            ]
        },
        {
            name: 'FLOOR 3',
            title: 'THE JOURNAL STACKS',
            floor: '#5a4632', ceil: '#2b221a',
            push: [[15, 15]],
            map: [
                'BBBNBBBBBBBNBBBBBBBBBBBNBBBBBNBB',
                'B......Bt...........tB........nB',
                'L......B....p........B....q....B',
                'N.>....|...*.....*...|.........V',
                'L......B..........e..B..w...w..B',
                'B.....cB.............B.........B',
                'BBBBBBBBLL.LLL.LLL.LLB....e....B',
                'B....p...............B..w...w..B',
                'B.LL.LL.LL..LL..LL..LB....*....N',
                'B.LL.LL.LLe.LL..LL..LB.p.....p.B',
                'LaLL.LL.LL..LL..LL..LBa.......+B',
                'B.LL.LL.LL..LL.pLL..LBBBBB=BBBBB',
                'B.........*.........cBa........B',
                'B.LL.LL.LL..LL.LLLLL.B.......p.B',
                'N.LLeLL.LL..LL.Lo.gL.B.........B',
                'B.LL.LL.LL..LL.N..fL.B.........B',
                'B.LL.LL.LL..LL.Lj.jL.B..q......B',
                'B......q.......LLLLL.B....*....B',
                'B.LL+LL.LL..LL..LL..LB.........B',
                'B.LL.LL.LLp.LL..LL..LB......q..B',
                'L.LL.LL.LL..LLa.LL..LB.........X',
                'B.LL.LL.LL..LL..LLe.LB.p.......B',
                'Bk..........,......p.Bj...+...oB',
                'BBBBBBBBBBBNBBBBBBBBBBBBBBBBBBBB'
            ]
        },
        {
            name: 'FLOOR 4',
            title: 'STUDY SECTION',
            floor: '#4a1f1f', ceil: '#2a1a12',
            push: [],
            boss: true,
            map: [
                'OOOOORRROOOOOOOORRROOOOO',
                'O+....................+O',
                'R..p................p..R',
                'O....w.....r......w....O',
                'O....a............a....O',
                'R.......*......*.......R',
                'O....w............w....O',
                'O..........e...........O',
                'Oa....................aO',
                'OOOOOOOOOOO|OOOOOOOOOOOO',
                'O.......hO....Ot.......O',
                'O.n....a.O.*.pO.....c.mO',
                'O.....q..O....O...q....O',
                'R....w...|....|........R',
                'O..e.....Op...O........O',
                'O.+.a....O..*.O.a....p.O',
                'O........O..+.O........O',
                'OOOOOOOOOOO|OOOOOOOOOOOO',
                'Ot....................tO',
                'O...e......*.......e...O',
                'R.....a..........a.....R',
                'O..........^...........O',
                'O.c..................+.O',
                'OOOOOOOOOOOOOOOOOOOOOOOO'
            ]
        }
    ];

    // Object definitions keyed by map character
    var ENEMY_DEFS = {
        p: { type: 'PHAGE',    hp: 25,   speed: 1.3, ranged: true,  dmg: [4, 12],  range: 10, cooldown: [1.0, 2.2], score: 100,  drop: 'a', alert: 'alertPhage',    reaction: 0.45 },
        e: { type: 'ECOLI',    hp: 18,   speed: 3.1, ranged: false, dmg: [5, 11],  range: 1.1, cooldown: [0.55, 0.9], score: 200, drop: null, alert: 'alertEcoli',   reaction: 0.25 },
        q: { type: 'PROTEASE', hp: 70,   speed: 1.7, ranged: false, dmg: [10, 22], range: 1.2, cooldown: [0.9, 1.3], score: 400, drop: 'a', alert: 'alertProtease', reaction: 0.35 },
        r: { type: 'REVIEWER', hp: 650,  speed: 1.4, ranged: true,  dmg: [4, 9],   range: 14, cooldown: [1.1, 1.8], score: 5000, drop: null, alert: 'alertReviewer', reaction: 0.35, boss: true, burst: 3, accuracy: 0.7 }
    };

    var ITEM_DEFS = {
        'c': { sprite: 'COFFEE',   kind: 'health', amount: 10, msg: 'COFFEE +10' },
        '+': { sprite: 'FIRSTAID', kind: 'health', amount: 25, msg: 'FIRST AID KIT +25' },
        'a': { sprite: 'TIPS',     kind: 'ammo',   amount: 8,  msg: 'BOX OF TIPS +8' },
        'm': { sprite: 'MULTI',    kind: 'weapon', weapon: 2,  msg: 'MULTICHANNEL PIPETTE!' },
        'n': { sprite: 'LN2',      kind: 'weapon', weapon: 3,  msg: 'LIQUID N2 CANNON!' },
        'k': { sprite: 'KEY',      kind: 'key',                msg: 'BSL-2 KEYCARD' },
        'f': { sprite: 'FLASK',    kind: 'treasure', amount: 100,  msg: 'FLASK OF PURE PRODUCT +100' },
        'g': { sprite: 'GRANT',    kind: 'treasure', amount: 500,  msg: 'FUNDED GRANT +500' },
        'j': { sprite: 'COVER',    kind: 'treasure', amount: 1000, msg: 'JOURNAL COVER +1000' },
        'o': { sprite: 'MEDAL',    kind: 'treasure', amount: 5000, msg: 'GOLD MEDAL +5000' },
        'u': { sprite: 'TENURE',   kind: 'oneup',              msg: 'TENURE! EXTRA LIFE' }
    };

    var DECOR_DEFS = {
        'b': { sprite: 'BENCH', block: true },     't': { sprite: 'PLANT', block: true },
        'y': { sprite: 'CYLINDER', block: true },  'd': { sprite: 'DRUM', block: true },
        'z': { sprite: 'CENTRIFUGE', block: true },'h': { sprite: 'COATRACK', block: true },
        'w': { sprite: 'DESK', block: true },      '*': { sprite: 'LAMP', block: false },
        ',': { sprite: 'GLASS', block: false }
    };

    var DEATH_MSGS = [
        'CONTAMINATED. THE EXPERIMENT CONTINUES WITHOUT YOU.',
        'YOUR LAB NOTEBOOK WILL BE ENTERED INTO EVIDENCE.',
        'THE PHAGE HAVE EVOLVED PAST YOU.',
        'SAMPLE SIZE: ONE. RESULT: NEGATIVE.',
        'REVIEWER #2 WILL HEAR ABOUT THIS.',
        'NEGATIVE CONTROL: YOU.',
        'SHOULD HAVE WORN THE LAB COAT.',
        'P-VALUE OF SURVIVAL: NOT SIGNIFICANT.'
    ];

    // =================================================================
    //  GAME STATE
    // =================================================================
    var CELL_FLOOR = 0, CELL_WALL = 1, CELL_DOOR = 2;

    var mapW = 0, mapH = 0;
    var cells, wallTex, doorIndex, pushIndex, blockMap, seen;
    var doors = [], pushwalls = [], movingPush = null, objects = [], enemies = [];
    var level = null, levelIndex = 0;
    var player = null, stats = null;
    var distField = null, distCell = -1, distTimer = 0;
    var exitPressed = false;

    // 'title' | 'playing' | 'dying' | 'levelEnd' | 'gameOver' | 'victory'
    var gameState = 'title';
    var msgText = '', msgTimer = 0, bannerTimer = 0;
    var damageFlash = 0, pickupFlash = 0, grinTimer = 0, faceLookTimer = 0, faceLook = 0;
    var deathTimer = 0, levelTime = 0, victoryTimer = 0;
    var bossDefeated = false;

    var keys = {};
    var mouseDX = 0, fireHeld = false, pointerLocked = false, showMap = false;
    var touchMove = { x: 0, y: 0 }, touchTurn = 0, touchFire = false;
    var hiScore = 0;
    var ejects = [];   // spent pipette tips flying off screen

    function idx(x, y) { return y * mapW + x; }

    function inBounds(x, y) { return x >= 0 && y >= 0 && x < mapW && y < mapH; }

    function isSolidWall(x, y) { return !inBounds(x, y) || cells[idx(x, y)] === CELL_WALL; }

    function newPlayer() {
        return {
            x: 0, y: 0, a: 0,
            health: 100, lives: 3, score: 0, ammo: 8,
            weapons: [true, true, false, false], weapon: W.PIPETTE, pendingWeapon: -1,
            hasKey: false,
            fireT: 0, fireAnim: 0, bob: 0, moving: false,
            nextLifeScore: 40000
        };
    }

    // =================================================================
    //  LEVEL LOADING
    // =================================================================
    function loadLevel(n) {
        levelIndex = n;
        level = LEVELS[n];
        var rows = level.map;
        mapH = rows.length; mapW = rows[0].length;
        var size = mapW * mapH;
        cells = new Uint8Array(size);
        wallTex = new Uint8Array(size);
        doorIndex = new Int16Array(size).fill(-1);
        pushIndex = new Int16Array(size).fill(-1);
        blockMap = new Uint8Array(size);
        seen = new Uint8Array(size);
        doors = []; pushwalls = []; movingPush = null; objects = []; enemies = [];
        stats = { kills: 0, totalKills: 0, secrets: 0, totalSecrets: level.push.length, treasure: 0, totalTreasure: 0 };
        bossDefeated = false; exitPressed = false;

        for (var y = 0; y < mapH; y++) {
            for (var x = 0; x < mapW; x++) {
                var ch = rows[y][x], i = idx(x, y), cx = x + 0.5, cy = y + 0.5;
                if (WALL_CHARS[ch] !== undefined) {
                    cells[i] = CELL_WALL; wallTex[i] = WALL_CHARS[ch];
                } else if (ch === '|' || ch === '=') {
                    cells[i] = CELL_DOOR;
                    doorIndex[i] = doors.length;
                    doors.push({ x: x, y: y, locked: ch === '=', open: 0, state: 0, timer: 0, axisX: false });
                } else if (ch === '^' || ch === 'v' || ch === '<' || ch === '>') {
                    player.x = cx; player.y = cy;
                    player.a = { '^': -Math.PI / 2, 'v': Math.PI / 2, '<': Math.PI, '>': 0 }[ch];
                } else if (ENEMY_DEFS[ch]) {
                    var d = ENEMY_DEFS[ch];
                    enemies.push({
                        x: cx, y: cy, def: d, base: SP[d.type], hp: d.hp,
                        state: 'idle', stateT: 0, animT: Math.random() * 2,
                        cooldown: rnd(0.4, 1.2), alertT: -1, shots: 0, losT: Math.random() * 0.2, hasLos: false
                    });
                    stats.totalKills++;
                } else if (ITEM_DEFS[ch]) {
                    var it = ITEM_DEFS[ch];
                    objects.push({ x: cx, y: cy, sprite: SP[it.sprite], item: it, taken: false });
                    if (it.kind === 'treasure') stats.totalTreasure++;
                } else if (DECOR_DEFS[ch]) {
                    var dc = DECOR_DEFS[ch];
                    objects.push({ x: cx, y: cy, sprite: SP[dc.sprite], block: dc.block });
                    if (dc.block) blockMap[i] = 1;
                }
            }
        }
        // Door orientation: walls north+south means you walk through along X
        doors.forEach(function (d) { d.axisX = isSolidWall(d.x, d.y - 1) && isSolidWall(d.x, d.y + 1); });
        level.push.forEach(function (p) {
            var i = idx(p[0], p[1]);
            pushIndex[i] = pushwalls.length;
            pushwalls.push({ x: p[0], y: p[1], tex: wallTex[i], used: false });
        });

        player.hasKey = false;
        player.fireT = 0; player.fireAnim = 0; player.ejectPending = false;
        ejects.length = 0;
        distCell = -1;
        bannerTimer = 3.2; levelTime = 0;
        msgText = ''; msgTimer = 0;
        damageFlash = 0; pickupFlash = 0;
    }

    // Debug-only sanity checks (enable with #p3d-debug in the URL)
    function validateLevels() {
        var problems = [];
        LEVELS.forEach(function (L, n) {
            var w = L.map[0].length, starts = 0, exits = 0;
            L.map.forEach(function (row, y) {
                if (row.length !== w) problems.push('L' + (n + 1) + ' row ' + y + ' has length ' + row.length + ' (expected ' + w + ')');
                for (var x = 0; x < row.length; x++) {
                    var ch = row[x];
                    var known = ch === '.' || ch === '|' || ch === '=' || '^v<>'.indexOf(ch) >= 0 ||
                        WALL_CHARS[ch] !== undefined || ENEMY_DEFS[ch] || ITEM_DEFS[ch] || DECOR_DEFS[ch];
                    if (!known) problems.push('L' + (n + 1) + ' unknown char "' + ch + '" at ' + x + ',' + y);
                    if ('^v<>'.indexOf(ch) >= 0) starts++;
                    if (ch === 'X') exits++;
                    if (ch === '|' || ch === '=') {
                        var wall = function (xx, yy) { return WALL_CHARS[(L.map[yy] || '')[xx]] !== undefined; };
                        var ns = wall(x, y - 1) && wall(x, y + 1), ew = wall(x - 1, y) && wall(x + 1, y);
                        if (!ns && !ew) problems.push('L' + (n + 1) + ' door at ' + x + ',' + y + ' lacks walls on opposite sides');
                    }
                }
            });
            if (starts !== 1) problems.push('L' + (n + 1) + ' has ' + starts + ' player starts');
            if (!L.boss && exits < 1) problems.push('L' + (n + 1) + ' has no exit switch');
        });
        return problems;
    }

    // =================================================================
    //  INPUT
    // =================================================================
    var GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Space', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyM', 'KeyP'];

    function isFireKey(code) {
        return code === 'Space' || code === 'ControlLeft' || code === 'ControlRight' || code === 'KeyF';
    }

    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (active) {
            if (GAME_KEYS.indexOf(e.code) >= 0) e.preventDefault();
            if (e.code === 'Escape') {
                if (gameState === 'playing' && !paused) setPaused(true);
                else if (paused) setPaused(false);
                else if (gameState === 'title') exitGame();
                return;
            }
            if (e.repeat) return;
            keys[e.code] = true;
            if (gameState !== 'playing' || paused) {
                if (e.code === 'KeyP' && paused) setPaused(false);
                return;
            }
            if (e.code === 'KeyE' || e.code === 'Enter') useAction();
            if (isFireKey(e.code)) fireHeld = true;
            if (e.code === 'Digit1') selectWeapon(W.NOTEBOOK);
            if (e.code === 'Digit2') selectWeapon(W.PIPETTE);
            if (e.code === 'Digit3') selectWeapon(W.MULTI);
            if (e.code === 'Digit4') selectWeapon(W.LN2);
            if (e.code === 'Tab') showMap = true;
            if (e.code === 'KeyM') { muted = !muted; showMsg(muted ? 'SOUND OFF' : 'SOUND ON'); }
            if (e.code === 'KeyP') setPaused(true);
            return;
        }

        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var key = e.key.toUpperCase();
        if (key.length === 1 && /[A-Z]/.test(key)) {
            codeBuffer += key;
            if (codeBuffer.length > SECRET.length) codeBuffer = codeBuffer.slice(-SECRET.length);
            if (codeBuffer === SECRET && !unlocked) { unlocked = true; playAccess(); }
        }
    });

    document.addEventListener('keyup', function (e) {
        if (!active) return;
        keys[e.code] = false;
        if (isFireKey(e.code)) fireHeld = false;
        if (e.code === 'Tab') showMap = false;
    });

    function onMouseMove(e) {
        if (pointerLocked && gameState === 'playing' && !paused) mouseDX += e.movementX || 0;
    }

    function onMouseDown(e) {
        if (gameState !== 'playing' || paused) return;
        if (!pointerLocked && !mobile) requestLock();
        if (e.button === 0) fireHeld = true;
    }

    function onMouseUp(e) { if (e.button === 0) fireHeld = false; }

    function requestLock() {
        try {
            var p = screenCanvas.requestPointerLock && screenCanvas.requestPointerLock();
            if (p && p.catch) p.catch(function () {});
        } catch (err) { /* pointer lock unavailable: keyboard turning still works */ }
    }

    function onPointerLockChange() {
        pointerLocked = document.pointerLockElement === screenCanvas;
        // Browsers swallow the Escape that releases the lock, so treat unlock as pause
        if (!pointerLocked && gameState === 'playing' && !paused && active) setPaused(true);
    }

    function onBlur() {
        keys = {}; fireHeld = false;
        if (gameState === 'playing' && !paused) setPaused(true);
    }

    // =================================================================
    //  COLLISION
    // =================================================================
    function cellBlocks(x, y, forEnemy) {
        if (!inBounds(x, y)) return true;
        var i = idx(x, y), c = cells[i];
        if (c === CELL_WALL) return true;
        if (c === CELL_DOOR) {
            var d = doors[doorIndex[i]];
            if (forEnemy && d.locked) return true;
            return d.open < 0.85;
        }
        if (blockMap[i]) return true;
        if (movingPush && (i === movingPush.cellA || i === movingPush.cellB)) return true;
        return false;
    }

    function canOccupy(x, y, r, forEnemy) {
        return !cellBlocks(Math.floor(x - r), Math.floor(y - r), forEnemy) &&
               !cellBlocks(Math.floor(x + r), Math.floor(y - r), forEnemy) &&
               !cellBlocks(Math.floor(x - r), Math.floor(y + r), forEnemy) &&
               !cellBlocks(Math.floor(x + r), Math.floor(y + r), forEnemy);
    }

    function livingEnemyNear(x, y, r, except) {
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (e === except || e.state === 'dying' || e.state === 'dead') continue;
            var dx = e.x - x, dy = e.y - y;
            if (dx * dx + dy * dy < r * r) return e;
        }
        return null;
    }

    // Samples along the segment; closed doors, walls and the moving push wall block sight
    function lineOfSight(ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
        var steps = Math.ceil(len / 0.1);
        for (var s = 1; s < steps; s++) {
            var t = s / steps, cx = Math.floor(ax + dx * t), cy = Math.floor(ay + dy * t);
            if (!inBounds(cx, cy)) return false;
            var i = idx(cx, cy), c = cells[i];
            if (c === CELL_WALL) return false;
            if (c === CELL_DOOR && doors[doorIndex[i]].open < 0.5) return false;
            if (movingPush && (i === movingPush.cellA || i === movingPush.cellB)) return false;
        }
        return true;
    }

    // =================================================================
    //  RAYCAST — shared by the renderer and hitscan weapons
    //  Returns perpendicular distance when (rdx, rdy) is a camera ray.
    // =================================================================
    var rayHit = { dist: 0, tex: 0, u: 0, side: 0, cell: -1 };

    function pushBlockHit(ox, oy, rdx, rdy) {
        if (!movingPush) return Infinity;
        var bx = movingPush.x, by = movingPush.y;
        var tx1 = rdx !== 0 ? (bx - ox) / rdx : -Infinity, tx2 = rdx !== 0 ? (bx + 1 - ox) / rdx : Infinity;
        var ty1 = rdy !== 0 ? (by - oy) / rdy : -Infinity, ty2 = rdy !== 0 ? (by + 1 - oy) / rdy : Infinity;
        if (rdx === 0 && (ox < bx || ox > bx + 1)) return Infinity;
        if (rdy === 0 && (oy < by || oy > by + 1)) return Infinity;
        var tminX = Math.min(tx1, tx2), tmaxX = Math.max(tx1, tx2);
        var tminY = Math.min(ty1, ty2), tmaxY = Math.max(ty1, ty2);
        var tmin = Math.max(tminX, tminY), tmax = Math.min(tmaxX, tmaxY);
        if (tmax < tmin || tmin <= 0.001) return Infinity;
        movingPush.hitSide = tminX > tminY ? 0 : 1;
        return tmin;
    }

    function castRay(ox, oy, rdx, rdy, markSeen) {
        var mx = Math.floor(ox), my = Math.floor(oy);
        var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
        var stepX, stepY, sdx, sdy, side = 0;
        if (rdx < 0) { stepX = -1; sdx = (ox - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - ox) * ddx; }
        if (rdy < 0) { stepY = -1; sdy = (oy - my) * ddy; } else { stepY = 1; sdy = (my + 1 - oy) * ddy; }
        var tBlock = pushBlockHit(ox, oy, rdx, rdy);

        for (var n = 0; n < 200; n++) {
            var fromDoor = inBounds(mx, my) && cells[idx(mx, my)] === CELL_DOOR;
            if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
            var dist = side === 0 ? sdx - ddx : sdy - ddy;

            if (tBlock < dist) {
                var hx = ox + rdx * tBlock, hy = oy + rdy * tBlock;
                rayHit.dist = tBlock; rayHit.tex = movingPush.tex; rayHit.side = movingPush.hitSide;
                rayHit.u = movingPush.hitSide === 0 ? hy - movingPush.y : hx - movingPush.x;
                rayHit.cell = -1;
                return rayHit;
            }
            if (!inBounds(mx, my)) {
                rayHit.dist = dist; rayHit.tex = T.TILE; rayHit.u = 0; rayHit.side = side; rayHit.cell = -1;
                return rayHit;
            }
            var i = idx(mx, my), c = cells[i];
            if (markSeen) seen[i] = 1;

            if (c === CELL_WALL) {
                var hit = side === 0 ? oy + dist * rdy : ox + dist * rdx;
                rayHit.dist = dist; rayHit.u = hit - Math.floor(hit); rayHit.side = side; rayHit.cell = i;
                rayHit.tex = fromDoor ? T.JAMB : wallTex[i];
                return rayHit;
            }
            if (c === CELL_DOOR) {
                var d = doors[doorIndex[i]], t, u;
                if (d.axisX) {
                    if (rdx === 0) continue;
                    t = (mx + 0.5 - ox) / rdx;
                    var py = oy + t * rdy;
                    if (t <= 0 || Math.floor(py) !== my) continue;
                    u = py - my;
                } else {
                    if (rdy === 0) continue;
                    t = (my + 0.5 - oy) / rdy;
                    var px = ox + t * rdx;
                    if (t <= 0 || Math.floor(px) !== mx) continue;
                    u = px - mx;
                }
                if (u < d.open) continue; // ray passes through the opened gap
                if (tBlock < t) continue;
                rayHit.dist = t; rayHit.u = u - d.open; rayHit.side = d.axisX ? 0 : 1; rayHit.cell = i;
                rayHit.tex = d.locked ? T.LOCKED : T.DOOR;
                return rayHit;
            }
        }
        rayHit.dist = 1e9; rayHit.tex = T.TILE; rayHit.u = 0; rayHit.side = 0; rayHit.cell = -1;
        return rayHit;
    }

    // =================================================================
    //  MESSAGES / SCORE
    // =================================================================
    function showMsg(text, time) { msgText = text; msgTimer = time || 2.2; }

    function addScore(n) {
        player.score += n;
        while (player.score >= player.nextLifeScore) {
            player.lives++;
            player.nextLifeScore += 40000;
            sfx('oneup');
            showMsg('40000 POINTS! EXTRA LIFE');
        }
    }

    // =================================================================
    //  DOORS & PUSH WALLS
    // =================================================================
    function doorOccupied(d) {
        var r = PLAYER_RADIUS;
        if (player.x + r > d.x && player.x - r < d.x + 1 && player.y + r > d.y && player.y - r < d.y + 1) return true;
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (e.state === 'dead' || e.state === 'dying') continue;
            if (e.x + 0.3 > d.x && e.x - 0.3 < d.x + 1 && e.y + 0.3 > d.y && e.y - 0.3 < d.y + 1) return true;
        }
        return false;
    }

    function nearPlayer(x, y, r) {
        var dx = x - player.x, dy = y - player.y;
        return dx * dx + dy * dy < r * r;
    }

    function openDoor(d, byEnemy) {
        if (d.locked) {
            if (byEnemy) return;
            if (!player.hasKey) { sfx('locked', 400); showMsg('BSL-2 KEYCARD REQUIRED'); return; }
            d.locked = false;
            showMsg('BSL-2 ACCESS GRANTED');
        }
        if (d.state === 0 || d.state === 3) {
            d.state = 1;
            if (nearPlayer(d.x + 0.5, d.y + 0.5, 12)) sfx('door', 150);
        } else if (d.state === 2) {
            d.timer = DOOR_HOLD;
        }
    }

    function updateDoors(dt) {
        for (var i = 0; i < doors.length; i++) {
            var d = doors[i];
            if (d.state === 1) {
                d.open += DOOR_SPEED * dt;
                if (d.open >= 1) { d.open = 1; d.state = 2; d.timer = DOOR_HOLD; }
            } else if (d.state === 2) {
                d.timer -= dt;
                if (d.timer <= 0) {
                    if (doorOccupied(d)) d.timer = 0.5;
                    else { d.state = 3; if (nearPlayer(d.x + 0.5, d.y + 0.5, 12)) sfx('door', 150); }
                }
            } else if (d.state === 3) {
                if (doorOccupied(d)) { d.state = 1; continue; }
                d.open -= DOOR_SPEED * dt;
                if (d.open <= 0) { d.open = 0; d.state = 0; }
            }
        }
    }

    function startPush(pw, dx, dy) {
        var dist = 0;
        for (var k = 1; k <= 2; k++) {
            var nx = pw.x + dx * k, ny = pw.y + dy * k;
            if (!inBounds(nx, ny)) break;
            var ni = idx(nx, ny);
            if (cells[ni] !== CELL_FLOOR || blockMap[ni] || livingEnemyNear(nx + 0.5, ny + 0.5, 0.7)) break;
            dist = k;
        }
        if (dist === 0) { sfx('noway', 300); return; }
        var i = idx(pw.x, pw.y);
        cells[i] = CELL_FLOOR;
        pushIndex[i] = -1;
        pw.used = true;
        stats.secrets++;
        sfx('push'); sfx('secret');
        showMsg('YOU FOUND A SECRET LAB!');
        movingPush = { tex: pw.tex, sx: pw.x, sy: pw.y, dx: dx, dy: dy, dist: dist, t: 0, x: pw.x, y: pw.y, cellA: i, cellB: idx(pw.x + dx, pw.y + dy), hitSide: 0 };
    }

    function updatePush(dt) {
        var m = movingPush;
        if (!m) return;
        m.t += PUSH_SPEED * dt;
        if (m.t >= m.dist) {
            var fi = idx(m.sx + m.dx * m.dist, m.sy + m.dy * m.dist);
            cells[fi] = CELL_WALL;
            wallTex[fi] = m.tex;
            movingPush = null;
            distCell = -1;
            return;
        }
        var step = Math.floor(m.t);
        m.x = m.sx + m.dx * m.t;
        m.y = m.sy + m.dy * m.t;
        m.cellA = idx(m.sx + m.dx * step, m.sy + m.dy * step);
        m.cellB = idx(m.sx + m.dx * Math.min(m.dist, step + 1), m.sy + m.dy * Math.min(m.dist, step + 1));
    }

    function useAction() {
        var dx = Math.cos(player.a), dy = Math.sin(player.a);
        var pcx = Math.floor(player.x), pcy = Math.floor(player.y);
        for (var s = 0.2; s <= 1.3; s += 0.1) {
            var cx = Math.floor(player.x + dx * s), cy = Math.floor(player.y + dy * s);
            if ((cx === pcx && cy === pcy) || !inBounds(cx, cy)) continue;
            var i = idx(cx, cy);
            if (cells[i] === CELL_DOOR) { openDoor(doors[doorIndex[i]], false); return; }
            if (cells[i] === CELL_WALL) {
                if (wallTex[i] === T.ELEVATOR) { pressExit(i); return; }
                if (pushIndex[i] >= 0 && !movingPush) {
                    var ax = Math.abs(dx) > Math.abs(dy);
                    startPush(pushwalls[pushIndex[i]], ax ? (dx > 0 ? 1 : -1) : 0, ax ? 0 : (dy > 0 ? 1 : -1));
                    return;
                }
                sfx('noway', 300);
                return;
            }
            if (blockMap[i]) { sfx('noway', 300); return; }
        }
    }

    function pressExit(i) {
        if (exitPressed) return;
        exitPressed = true;
        wallTex[i] = T.ELEVATOR_ON;
        sfx('exit');
        gameState = 'exiting';
        setTimeout(function () { if (active) showLevelEnd(); }, 1300);
    }

    // =================================================================
    //  WEAPONS
    // =================================================================
    var WEAPON_DEFS = [
        { name: 'LAB NOTEBOOK',  rate: 0.42, dmg: [10, 22], melee: true, ammo: false, sfx: 'notebook' },
        { name: 'P1000 PIPETTE', rate: 0.34, dmg: [9, 22],  ammo: true, sfx: 'pipette', ejects: true },
        { name: 'MULTICHANNEL',  rate: 0.16, dmg: [8, 17],  ammo: true, sfx: 'multi', ejects: true },
        { name: 'LN2 CANNON',    rate: 0.085, dmg: [10, 19], ammo: true, sfx: 'ln2' }
    ];

    function bestGun() {
        for (var w = 3; w >= 1; w--) if (player.weapons[w]) return w;
        return W.NOTEBOOK;
    }

    function selectWeapon(w) {
        if (!player.weapons[w]) return;
        if (w !== W.NOTEBOOK && player.ammo <= 0) { showMsg('NO PIPETTE TIPS'); sfx('empty', 200); return; }
        player.weapon = w;
    }

    function weaponBob() {
        return { x: Math.round(Math.sin(player.bob) * 4), y: Math.round(Math.abs(Math.cos(player.bob)) * 3) };
    }

    // Spent tips pop off the nozzle(s) halfway through the shot animation
    function spawnEjects() {
        var noz = weaponNozzles[player.weapon];
        if (!noz) return;
        var pose = POSE[player.weapon], bob = weaponBob();
        var ox = Math.round(RW / 2 - WPN_W / 2) + bob.x, oy = VIEW_H - WPN_H + 2 + bob.y;
        var ax = -Math.sin(pose.rot), ay = Math.cos(pose.rot);
        var many = noz.length > 1;
        // The multichannel alternates between odd and even channels so rapid fire stays readable
        player.ejectFlip = !player.ejectFlip;
        for (var i = 0; i < noz.length; i++) {
            if (many && (i % 2 === 0) === player.ejectFlip) continue;
            if (ejects.length >= 28) ejects.shift();
            ejects.push({
                x: ox + noz[i].x, y: oy + noz[i].y,
                vx: ax * 40 + rnd(160, 230) + (many ? (i - 3.5) * 10 : 0),
                vy: ay * 40 - rnd(190, 250),
                rot: pose.rot, vr: (Math.random() < 0.5 ? -1 : 1) * rnd(20, 32),
                s: pose.s * (many ? 0.62 : 1), life: 0.9
            });
        }
        sfx('eject', 60);
    }

    function updateEjects(dt) {
        if (player.ejectPending && player.fireAnim <= player.fireAnimDur / 2) {
            player.ejectPending = false;
            spawnEjects();
        }
        for (var i = ejects.length - 1; i >= 0; i--) {
            var e = ejects[i];
            e.vy += 1300 * dt;
            e.x += e.vx * dt; e.y += e.vy * dt;
            e.rot += e.vr * dt;
            e.life -= dt;
            if (e.life <= 0 || e.y > VIEW_H + 30) ejects.splice(i, 1);
        }
    }

    function updateWeapon(dt) {
        player.fireT -= dt;
        if (player.fireAnim > 0) player.fireAnim -= dt;
        updateEjects(dt);
        if (!(fireHeld || touchFire) || player.fireT > 0) return;

        var wd = WEAPON_DEFS[player.weapon];
        if (wd.ammo && player.ammo <= 0) {
            sfx('empty', 250);
            player.weapon = W.NOTEBOOK;
            showMsg('OUT OF TIPS! GRAB THE NOTEBOOK');
            return;
        }
        player.fireT = wd.rate;
        player.fireAnimDur = Math.min(wd.rate * 0.9, 0.22);
        player.fireAnim = player.fireAnimDur;
        if (wd.ammo) player.ammo--;
        player.ejectPending = !!wd.ejects;
        sfx(wd.sfx);
        if (!wd.melee) alertBySound();
        fireHitscan(wd);
    }

    function fireHitscan(wd) {
        var dx = Math.cos(player.a), dy = Math.sin(player.a);
        var wall = castRay(player.x, player.y, dx, dy, false).dist;
        var best = null, bestD = Infinity;
        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (e.state === 'dying' || e.state === 'dead') continue;
            var rx = e.x - player.x, ry = e.y - player.y;
            var depth = rx * dx + ry * dy;
            if (depth <= 0.05) continue;
            var lateral = Math.abs(rx * dy - ry * dx);
            var width = wd.melee ? 0.6 : (e.def.boss ? 0.48 : 0.38);
            if (lateral > width) continue;
            if (wd.melee && depth > 1.5) continue;
            if (depth > wall + 0.3) continue;
            if (!lineOfSight(player.x, player.y, e.x, e.y)) continue;
            if (depth < bestD) { bestD = depth; best = e; }
        }
        if (!best) return;
        var dmg = irnd(wd.dmg[0], wd.dmg[1]);
        if (!wd.melee && bestD > 3) dmg = Math.round(dmg * clamp(1.3 - bestD / 12, 0.45, 1));
        damageEnemy(best, dmg);
    }

    // Gunfire wakes enemies that can hear it through open space and open doors
    function alertBySound() {
        var start = idx(Math.floor(player.x), Math.floor(player.y));
        var dist = new Int16Array(mapW * mapH).fill(-1);
        var queue = [start], head = 0;
        dist[start] = 0;
        while (head < queue.length) {
            var i = queue[head++], x = i % mapW, y = (i / mapW) | 0;
            if (dist[i] >= 20) continue;
            var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var k = 0; k < 4; k++) {
                var nx = x + nb[k][0], ny = y + nb[k][1];
                if (!inBounds(nx, ny)) continue;
                var ni = idx(nx, ny);
                if (dist[ni] >= 0 || cells[ni] === CELL_WALL) continue;
                if (cells[ni] === CELL_DOOR && doors[doorIndex[ni]].open <= 0.05) continue;
                dist[ni] = dist[i] + 1;
                queue.push(ni);
            }
        }
        for (var j = 0; j < enemies.length; j++) {
            var e = enemies[j];
            if (e.state !== 'idle' || e.alertT >= 0) continue;
            if (dist[idx(Math.floor(e.x), Math.floor(e.y))] >= 0) e.alertT = rnd(0.05, 0.4);
        }
    }

    // =================================================================
    //  PICKUPS
    // =================================================================
    function updatePickups() {
        for (var i = 0; i < objects.length; i++) {
            var o = objects[i];
            if (!o.item || o.taken) continue;
            if (Math.abs(o.x - player.x) < 0.55 && Math.abs(o.y - player.y) < 0.55) tryPickup(o);
        }
    }

    function tryPickup(o) {
        var it = o.item;
        switch (it.kind) {
            case 'health':
                if (player.health >= 100) return;
                player.health = Math.min(100, player.health + it.amount); sfx('health'); break;
            case 'ammo':
                if (player.ammo >= MAX_AMMO) return;
                var wasEmpty = player.ammo === 0;
                player.ammo = Math.min(MAX_AMMO, player.ammo + it.amount); sfx('ammo');
                if (wasEmpty && player.weapon === W.NOTEBOOK) player.weapon = bestGun();
                break;
            case 'weapon':
                player.weapons[it.weapon] = true;
                player.ammo = Math.min(MAX_AMMO, player.ammo + 6);
                if (it.weapon > player.weapon || player.weapon === W.NOTEBOOK) player.weapon = it.weapon;
                grinTimer = 2; sfx('weapon'); break;
            case 'key':
                player.hasKey = true; sfx('key'); break;
            case 'treasure':
                addScore(it.amount); stats.treasure++; sfx('treasure'); break;
            case 'oneup':
                player.lives++; player.health = 100; player.ammo = Math.min(MAX_AMMO, player.ammo + 25);
                grinTimer = 2; sfx('oneup'); break;
        }
        o.taken = true;
        pickupFlash = 0.25;
        showMsg(it.msg);
    }

    // =================================================================
    //  PLAYER
    // =================================================================
    function updatePlayer(dt) {
        var run = keys.ShiftLeft || keys.ShiftRight;
        var turn = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
        player.a += turn * TURN_SPEED * dt + mouseDX * 0.0026 + touchTurn;
        mouseDX = 0; touchTurn = 0;

        var fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - touchMove.y;
        var str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
        fwd = clamp(fwd, -1, 1); str = clamp(str, -1, 1);
        var mag = Math.sqrt(fwd * fwd + str * str);
        if (mag > 1) { fwd /= mag; str /= mag; }

        var sp = MOVE_SPEED * (run ? RUN_MULT : 1) * dt;
        var dx = Math.cos(player.a), dy = Math.sin(player.a);
        var mx = (dx * fwd - dy * str) * sp, my = (dy * fwd + dx * str) * sp;
        player.moving = mag > 0.05;

        var r = PLAYER_RADIUS;
        if (mx && canOccupy(player.x + mx, player.y, r, false) && !livingEnemyNear(player.x + mx, player.y, 0.55)) player.x += mx;
        if (my && canOccupy(player.x, player.y + my, r, false) && !livingEnemyNear(player.x, player.y + my, 0.55)) player.y += my;

        // Walking into an unlocked door opens it
        if (fwd > 0.3) {
            var fx = Math.floor(player.x + dx * 0.7), fy = Math.floor(player.y + dy * 0.7);
            if (inBounds(fx, fy) && cells[idx(fx, fy)] === CELL_DOOR) {
                var d = doors[doorIndex[idx(fx, fy)]];
                if (d.state === 0 && (!d.locked || player.hasKey)) openDoor(d, false);
                else if (d.locked && !player.hasKey && msgTimer <= 0) openDoor(d, false);
            }
        }

        player.bob = player.moving ? player.bob + dt * (run ? 13 : 9) : player.bob * 0.85;
    }

    function hurtPlayer(dmg, src) {
        if (gameState !== 'playing' || debug && window.__p3dGod) return;
        player.health -= dmg;
        damageFlash = Math.min(0.7, damageFlash + 0.15 + dmg / 50);
        sfx('hurt', 150);
        if (src) {
            var ang = Math.atan2(src.y - player.y, src.x - player.x) - player.a;
            ang = Math.atan2(Math.sin(ang), Math.cos(ang));
            faceLook = ang < -0.4 ? 1 : ang > 0.4 ? 2 : 0;
            faceLookTimer = 0.8;
        }
        if (player.health <= 0) {
            player.health = 0;
            gameState = 'dying';
            deathTimer = 0;
            player.lives--;
            sfx('die');
        }
    }

    // =================================================================
    //  ENEMIES
    // =================================================================
    var NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

    // Breadth-first distance from the player; enemies walk downhill on it
    function updateDistField(dt) {
        distTimer -= dt;
        var pc = idx(Math.floor(player.x), Math.floor(player.y));
        if (pc === distCell && distTimer > 0) return;
        distCell = pc; distTimer = 0.5;
        if (!distField || distField.length !== mapW * mapH) distField = new Int16Array(mapW * mapH);
        distField.fill(-1);
        var queue = [pc], head = 0;
        distField[pc] = 0;
        while (head < queue.length) {
            var i = queue[head++], x = i % mapW, y = (i / mapW) | 0;
            for (var k = 0; k < 4; k++) {
                var nx = x + NB8[k][0], ny = y + NB8[k][1];
                if (!inBounds(nx, ny)) continue;
                var ni = idx(nx, ny);
                if (distField[ni] >= 0 || !enemyPassable(nx, ny)) continue;
                distField[ni] = distField[i] + 1;
                queue.push(ni);
            }
        }
    }

    function enemyPassable(x, y) {
        if (!inBounds(x, y)) return false;
        var i = idx(x, y), c = cells[i];
        if (c === CELL_WALL || blockMap[i]) return false;
        if (c === CELL_DOOR && doors[doorIndex[i]].locked) return false;
        if (movingPush && (i === movingPush.cellA || i === movingPush.cellB)) return false;
        return true;
    }

    function wakeEnemy(e) {
        if (e.state !== 'idle') return;
        e.state = 'chase';
        e.cooldown = rnd(0.3, 0.9);
        if (nearPlayer(e.x, e.y, 16)) sfx(e.def.alert, e.def.boss ? 0 : 350);
        if (e.def.boss) showMsg('REVIEWER #2 HAS REQUESTED MAJOR REVISIONS', 3);
    }

    function damageEnemy(e, dmg) {
        if (e.state === 'idle') wakeEnemy(e);
        e.hp -= dmg;
        if (e.hp <= 0) { killEnemy(e); return; }
        if (!e.def.boss || Math.random() < 0.25) { e.state = 'pain'; e.stateT = 0.16; }
    }

    function killEnemy(e) {
        e.state = 'dying'; e.stateT = 0;
        stats.kills++;
        addScore(e.def.score);
        sfx(e.def.type === 'ECOLI' ? 'splat' : 'enemyDie');
        if (e.def.drop) {
            objects.push({ x: e.x, y: e.y, sprite: SP.TIPS, item: { kind: 'ammo', amount: 4, msg: 'DROPPED TIPS +4' }, taken: false });
        }
        if (e.def.boss) {
            bossDefeated = true;
            victoryTimer = 3;
            showMsg('MANUSCRIPT ACCEPTED!', 4);
        }
    }

    function enemyShoot(e, dist) {
        if (nearPlayer(e.x, e.y, 18)) sfx('enemyShot', 70);
        if (!e.hasLos) return;
        var chance = clamp(1.05 - dist / 14, 0.22, 0.9);
        if (player.moving) chance *= 0.72;
        chance *= e.def.accuracy || 1;
        if (Math.random() < chance) {
            var d = e.def, dmg = irnd(d.dmg[0], d.dmg[1]);
            if (dist > 5) dmg = Math.round(dmg * clamp(1.3 - dist / 12, 0.4, 1));
            hurtPlayer(dmg, e);
        }
    }

    function moveEnemy(e, dt) {
        var cx = Math.floor(e.x), cy = Math.floor(e.y), ci = idx(cx, cy);
        var best = distField[ci], bx = -1, by = -1;
        if (best < 0) best = 9999;
        for (var k = 0; k < 8; k++) {
            var ox = NB8[k][0], oy = NB8[k][1], nx = cx + ox, ny = cy + oy;
            if (!enemyPassable(nx, ny)) continue;
            if (k >= 4 && (!enemyPassable(cx + ox, cy) || !enemyPassable(cx, cy + oy))) continue;
            var ni = idx(nx, ny);
            if (cells[ni] === CELL_DOOR && k >= 4) continue;
            var v = distField[ni];
            if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
        }
        var tx, ty;
        if (bx < 0) {
            if (distField[ci] !== 0) return;
            tx = player.x; ty = player.y;
        } else {
            var nci = idx(bx, by);
            if (cells[nci] === CELL_DOOR) {
                var door = doors[doorIndex[nci]];
                if (door.open < 0.9) { openDoor(door, true); return; }
            }
            tx = bx + 0.5; ty = by + 0.5;
        }
        var vx = tx - e.x, vy = ty - e.y, len = Math.sqrt(vx * vx + vy * vy);
        if (len < 0.001) return;
        var sp = Math.min(len, e.def.speed * dt);
        var nx2 = e.x + vx / len * sp, ny2 = e.y + vy / len * sp;
        if (nearPlayer(nx2, ny2, 0.6)) return;
        var other = livingEnemyNear(nx2, ny2, 0.55, e);
        if (other && (other.x - nx2) * (other.x - nx2) + (other.y - ny2) * (other.y - ny2) < (other.x - e.x) * (other.x - e.x) + (other.y - e.y) * (other.y - e.y)) return;
        if (canOccupy(nx2, e.y, 0.22, true)) e.x = nx2;
        if (canOccupy(e.x, ny2, 0.22, true)) e.y = ny2;
    }

    function updateEnemy(e, dt) {
        e.animT += dt;
        if (e.state === 'dead') return;
        if (e.state === 'dying') { e.stateT += dt; if (e.stateT > 0.34) e.state = 'dead'; return; }

        var dx = player.x - e.x, dy = player.y - e.y, dist = Math.sqrt(dx * dx + dy * dy);
        var d = e.def;
        e.losT -= dt;
        if (e.losT <= 0) { e.losT = 0.12; e.hasLos = dist < 24 && lineOfSight(e.x, e.y, player.x, player.y); }
        if (gameState !== 'playing') return;

        if (e.state === 'idle') {
            if (e.alertT >= 0) { e.alertT -= dt; if (e.alertT < 0) wakeEnemy(e); }
            else if (e.hasLos && dist < 14) e.alertT = d.reaction * rnd(0.6, 1.4);
            return;
        }
        if (e.state === 'pain') { e.stateT -= dt; if (e.stateT <= 0) e.state = 'chase'; return; }
        if (e.state === 'attack') {
            e.stateT += dt;
            if (d.ranged) {
                var times = d.burst ? [0.12, 0.26, 0.4] : [0.2];
                while (e.shots < times.length && e.stateT >= times[e.shots]) { e.shots++; enemyShoot(e, dist); }
                if (e.stateT >= times[times.length - 1] + 0.2) { e.state = 'chase'; e.cooldown = rnd(d.cooldown[0], d.cooldown[1]); }
            } else {
                if (e.shots === 0 && e.stateT >= 0.18) {
                    e.shots = 1;
                    if (dist < d.range + 0.4) { sfx('bite', 100); hurtPlayer(irnd(d.dmg[0], d.dmg[1]), e); }
                }
                if (e.stateT >= 0.42) { e.state = 'chase'; e.cooldown = rnd(d.cooldown[0], d.cooldown[1]); }
            }
            return;
        }

        e.cooldown -= dt;
        if (d.ranged ? (e.hasLos && dist < d.range && e.cooldown <= 0) : (dist < d.range + 0.2 && e.cooldown <= 0)) {
            e.state = 'attack'; e.stateT = 0; e.shots = 0;
            return;
        }
        var hold = d.ranged ? (e.hasLos && dist < 2.8) : dist < 0.75;
        if (!hold) moveEnemy(e, dt);
    }

    function enemyFrame(e) {
        switch (e.state) {
            case 'idle': return FR.STAND;
            case 'attack': return FR.ATTACK;
            case 'pain': return FR.PAIN;
            case 'dying': return e.stateT < 0.17 ? FR.DIE1 : FR.DIE2;
            case 'dead': return FR.DEAD;
            default: return Math.floor(e.animT * e.def.speed * 2.4) % 2 ? FR.WALK1 : FR.WALK2;
        }
    }

    // =================================================================
    //  MAIN UPDATE
    // =================================================================
    function update(dt) {
        if (msgTimer > 0) msgTimer -= dt;
        if (bannerTimer > 0) bannerTimer -= dt;
        if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 1.2);
        if (pickupFlash > 0) pickupFlash -= dt;
        if (grinTimer > 0) grinTimer -= dt;
        if (faceLookTimer > 0) faceLookTimer -= dt;
        else {
            faceLookTimer = rnd(0.8, 2.2);
            faceLook = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 1 : 2;
        }

        if (gameState === 'playing') {
            levelTime += dt;
            updatePlayer(dt);
            updateWeapon(dt);
            updatePickups();
        } else if (gameState === 'dying') {
            deathTimer += dt;
            if (deathTimer > 2.2) onDeathFinished();
        }
        if (player.fireAnim > 0 && gameState !== 'playing') player.fireAnim -= dt;

        updateDoors(dt);
        updatePush(dt);
        updateDistField(dt);
        for (var i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt);

        if (bossDefeated && victoryTimer > 0) {
            victoryTimer -= dt;
            if (victoryTimer <= 0 && gameState === 'playing') showVictory();
        }
    }

    // =================================================================
    //  RENDERING
    // =================================================================
    var ceilRows, floorRows, visible = [];

    function resize() {
        if (!screenCanvas) return;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var cw = window.innerWidth, ch = window.innerHeight;
        screenCanvas.width = Math.round(cw * dpr);
        screenCanvas.height = Math.round(ch * dpr);
        var newRW = clamp(Math.round(BASE_H * (cw / ch) / 2) * 2, 320, 426);
        if (newRW !== RW || !fb) {
            RW = newRW;
            fb = makeCanvas(RW, BASE_H);
            fbCtx = fb.getContext('2d');
            fbImage = fbCtx.createImageData(RW, VIEW_H);
            fbData = new Uint32Array(fbImage.data.buffer);
            zbuf = new Float32Array(RW);
        }
        buildShadeRows();
    }

    // Ceiling and floor fade toward the horizon for a bit of depth
    function buildShadeRows() {
        if (!level) return;
        var c = hexToRgb(level.ceil), f = hexToRgb(level.floor), half = VIEW_H / 2;
        ceilRows = new Uint32Array(VIEW_H);
        floorRows = new Uint32Array(VIEW_H);
        for (var y = 0; y < VIEW_H; y++) {
            var t = Math.abs(y - half) / half;
            var k = 0.45 + 0.55 * t;
            ceilRows[y] = rgba(c[0] * k | 0, c[1] * k | 0, c[2] * k | 0);
            floorRows[y] = rgba(f[0] * k | 0, f[1] * k | 0, f[2] * k | 0);
        }
    }

    function renderWalls(dirX, dirY, planeX, planeY) {
        var half = VIEW_H / 2, y, x;
        for (y = 0; y < VIEW_H; y++) fbData.fill(y < half ? ceilRows[y] : floorRows[y], y * RW, (y + 1) * RW);

        for (x = 0; x < RW; x++) {
            var camX = 2 * x / RW - 1;
            var rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
            var h = castRay(player.x, player.y, rdx, rdy, true);
            var dist = Math.max(h.dist, 0.0001);
            zbuf[x] = dist;
            var u = h.u;
            if (h.tex !== T.DOOR && h.tex !== T.LOCKED) {
                if ((h.side === 0 && rdx < 0) || (h.side === 1 && rdy > 0)) u = 1 - u;
            }
            var tex = h.side ? textures[h.tex].dark : textures[h.tex].data;
            var tx = clamp((u * TEX) | 0, 0, TEX - 1);
            var lineH = PROJ / dist, top = half - lineH / 2;
            var y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VIEW_H, Math.ceil(top + lineH));
            var step = TEX / lineH, tp = (y0 - top) * step;
            for (y = y0; y < y1; y++) {
                var ty = tp | 0;
                fbData[y * RW + x] = tex[(ty > 63 ? 63 : ty) * TEX + tx];
                tp += step;
            }
        }
    }

    function renderSprites(dirX, dirY, planeX, planeY) {
        var i, n = 0, half = VIEW_H / 2;
        visible.length = 0;
        for (i = 0; i < objects.length; i++) {
            var o = objects[i];
            if (!o.taken) visible.push({ x: o.x, y: o.y, spr: o.sprite });
        }
        for (i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            visible.push({ x: e.x, y: e.y, spr: e.base + enemyFrame(e), dead: e.state === 'dead' });
        }
        var invDet = 1 / (planeX * dirY - dirX * planeY);
        for (i = 0; i < visible.length; i++) {
            var s = visible[i], sx = s.x - player.x, sy = s.y - player.y;
            s.tx = invDet * (dirY * sx - dirX * sy);
            s.ty = invDet * (-planeY * sx + planeX * sy);
            // corpses sort behind anything standing at the same spot
            s.sort = s.ty + (s.dead ? 0.05 : 0);
        }
        visible.sort(function (a, b) { return b.sort - a.sort; });

        for (i = 0; i < visible.length; i++) {
            var v = visible[i];
            if (v.ty <= 0.08) continue;
            var size = PROJ / v.ty;
            var screenX = (RW / 2) * (1 + v.tx / v.ty);
            var left = screenX - size / 2, top = half - size / 2;
            var x0 = Math.max(0, Math.floor(left)), x1 = Math.min(RW, Math.ceil(left + size));
            if (x1 <= 0 || x0 >= RW) continue;
            var y0 = Math.max(0, Math.floor(top)), y1 = Math.min(VIEW_H, Math.ceil(top + size));
            var data = sprites[v.spr].data, scale = TEX / size;
            for (var x = x0; x < x1; x++) {
                if (v.ty >= zbuf[x]) continue;
                var tx = ((x - left) * scale) | 0;
                if (tx < 0 || tx > 63) continue;
                for (var y = y0; y < y1; y++) {
                    var ty = ((y - top) * scale) | 0;
                    if (ty < 0 || ty > 63) continue;
                    var p = data[ty * TEX + tx];
                    if ((p >>> 24) > 127) fbData[y * RW + x] = p;
                }
            }
            n++;
        }
        return n;
    }

    function renderWeapon() {
        var frame = 0;
        if (player.fireAnim > 0) frame = player.fireAnim > player.fireAnimDur / 2 ? 1 : 2;
        var bob = weaponBob();
        var drop = gameState === 'dying' ? Math.min(WPN_H, deathTimer * 110) : 0;
        fbCtx.drawImage(weaponFrames[player.weapon][frame], Math.round(RW / 2 - WPN_W / 2 + bob.x), VIEW_H - WPN_H + 2 + bob.y + drop);
        for (var i = 0; i < ejects.length; i++) {
            var e = ejects[i];
            fbCtx.save();
            fbCtx.globalAlpha = Math.min(1, e.life * 2);
            fbCtx.translate(e.x, e.y);
            fbCtx.rotate(e.rot);
            fbCtx.scale(e.s, e.s);
            fbCtx.drawImage(tipSprite, -7, -2);
            fbCtx.restore();
        }
    }

    function statBox(x, w, label, value, labelColor) {
        fbCtx.fillStyle = '#2a0000'; fbCtx.fillRect(x, 163, w, 35);
        fbCtx.fillStyle = '#140000'; fbCtx.fillRect(x, 163, w, 1); fbCtx.fillRect(x, 163, 1, 35);
        fbCtx.fillStyle = '#a33'; fbCtx.fillRect(x, 197, w, 1); fbCtx.fillRect(x + w - 1, 163, 1, 35);
        if (label) drawText(fbCtx, label, x + w / 2, 166, labelColor || '#d9b45a', 1, 'center');
        if (value !== null && value !== undefined) drawText(fbCtx, String(value), x + w / 2 + 1, 179, '#ffffff', 2, 'center', '#000');
    }

    function renderStatusBar() {
        var y0 = VIEW_H;
        fbCtx.fillStyle = MAROON; fbCtx.fillRect(0, y0, RW, STATUS_H);
        fbCtx.fillStyle = '#b02a2a'; fbCtx.fillRect(0, y0, RW, 1);
        fbCtx.fillStyle = '#4a0000'; fbCtx.fillRect(0, y0 + 1, RW, 1);
        var ox = Math.floor((RW - 320) / 2);
        fbCtx.save();
        fbCtx.translate(ox, 0);
        statBox(2, 30, 'FLOOR', levelIndex + 1);
        statBox(35, 72, 'SCORE', player.score);
        statBox(110, 30, 'LIVES', Math.max(0, player.lives));
        statBox(143, 28, null, null);
        var face;
        if (gameState === 'dying' || gameState === 'gameOver') face = faceDead;
        else if (grinTimer > 0) face = faceGrin;
        else face = faces[clamp(Math.floor((100 - player.health) / 15), 0, 6)][faceLook];
        fbCtx.drawImage(face, 145, 165);
        var hpColor = player.health > 50 ? '#d9b45a' : player.health > 25 ? '#f0a030' : '#ff5a4a';
        statBox(174, 50, 'HEALTH', player.health + '%', hpColor);
        statBox(227, 30, 'TIPS', player.weapon === W.NOTEBOOK && player.ammo === 0 ? '--' : player.ammo);
        statBox(260, 13, null, null);
        if (player.hasKey) {
            fbCtx.fillStyle = '#e0b73a'; fbCtx.fillRect(262, 172, 9, 13);
            fbCtx.fillStyle = '#4a3a0a'; fbCtx.fillRect(263, 176, 3, 4);
            fbCtx.fillStyle = MAROON; fbCtx.fillRect(265, 167, 3, 5);
        }
        statBox(276, 43, null, null);
        fbCtx.drawImage(weaponIcons[player.weapon], 274, 168, 48, 24);
        fbCtx.restore();
    }

    function renderAutomap() {
        var cs = Math.max(2, Math.min(Math.floor((RW - 16) / mapW), Math.floor((VIEW_H - 20) / mapH)));
        var mw = cs * mapW, mh = cs * mapH, ox = Math.floor((RW - mw) / 2), oy = Math.floor((VIEW_H - mh) / 2) + 4;
        fbCtx.fillStyle = 'rgba(8,6,6,0.88)'; fbCtx.fillRect(0, 0, RW, VIEW_H);
        drawText(fbCtx, level.name + ': ' + level.title, RW / 2, 2, '#d9b45a', 1, 'center');
        for (var y = 0; y < mapH; y++) {
            for (var x = 0; x < mapW; x++) {
                var i = idx(x, y);
                if (!seen[i] && !(debug && window.__p3dMap)) continue;
                var c = cells[i], col = '#2c2626';
                if (c === CELL_WALL) col = wallTex[i] === T.ELEVATOR || wallTex[i] === T.ELEVATOR_ON ? '#39d353' : '#8a7f78';
                else if (c === CELL_DOOR) col = doors[doorIndex[i]].locked ? '#e0453a' : '#d9b45a';
                fbCtx.fillStyle = col;
                fbCtx.fillRect(ox + x * cs, oy + y * cs, cs - (c === CELL_WALL ? 0 : 1), cs - (c === CELL_WALL ? 0 : 1));
            }
        }
        var px = ox + player.x * cs, py = oy + player.y * cs;
        fbCtx.strokeStyle = '#5ad0da'; fbCtx.lineWidth = 1;
        fbCtx.beginPath(); fbCtx.moveTo(px, py); fbCtx.lineTo(px + Math.cos(player.a) * cs * 1.6, py + Math.sin(player.a) * cs * 1.6); fbCtx.stroke();
        fbCtx.fillStyle = '#5ad0da'; fbCtx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
    }

    function renderOverlays() {
        if (damageFlash > 0) { fbCtx.fillStyle = 'rgba(200,0,0,' + (damageFlash * 0.55).toFixed(3) + ')'; fbCtx.fillRect(0, 0, RW, VIEW_H); }
        if (pickupFlash > 0) { fbCtx.fillStyle = 'rgba(255,215,90,' + (pickupFlash * 0.9).toFixed(3) + ')'; fbCtx.fillRect(0, 0, RW, VIEW_H); }
        if (gameState === 'dying') {
            fbCtx.fillStyle = 'rgba(130,0,0,' + Math.min(0.85, deathTimer * 0.5).toFixed(3) + ')';
            fbCtx.fillRect(0, 0, RW, VIEW_H);
        }
        if (gameState === 'exiting') {
            fbCtx.fillStyle = 'rgba(0,0,0,0.35)'; fbCtx.fillRect(0, 0, RW, VIEW_H);
            drawText(fbCtx, 'EXPERIMENT COMPLETE', RW / 2, VIEW_H / 2 - 8, '#39d353', 2, 'center', '#000');
        }
        if (showMap && gameState === 'playing') renderAutomap();

        if (gameState === 'playing' && !showMap) {
            fbCtx.fillStyle = 'rgba(255,255,255,0.55)';
            fbCtx.fillRect(RW / 2 - 3, VIEW_H / 2, 2, 1); fbCtx.fillRect(RW / 2 + 2, VIEW_H / 2, 2, 1);
            fbCtx.fillRect(RW / 2, VIEW_H / 2 - 3, 1, 2); fbCtx.fillRect(RW / 2, VIEW_H / 2 + 2, 1, 2);
        }
        if (msgTimer > 0 && gameState !== 'title') drawText(fbCtx, msgText, 4, 4, '#ffffff', 1, 'left', '#000');
        if (bannerTimer > 0 && gameState === 'playing') {
            var a = Math.min(1, bannerTimer / 0.6);
            fbCtx.globalAlpha = a;
            fbCtx.fillStyle = 'rgba(0,0,0,0.6)'; fbCtx.fillRect(0, VIEW_H / 2 - 30, RW, 36);
            drawText(fbCtx, level.name, RW / 2, VIEW_H / 2 - 26, '#d9b45a', 1, 'center', '#000');
            drawText(fbCtx, level.title, RW / 2, VIEW_H / 2 - 15, '#ffffff', 2, 'center', '#000');
            fbCtx.globalAlpha = 1;
        }
        if (gameState === 'playing' && !pointerLocked && !mobile && msgTimer <= 0 && bannerTimer <= 0) {
            drawText(fbCtx, 'CLICK FOR MOUSE LOOK', RW - 4, 4, 'rgba(255,255,255,0.45)', 1, 'right');
        }
    }

    function render() {
        if (!fb || !level) return;
        var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
        var planeLen = (RW / 2) / PROJ;
        var planeX = -dirY * planeLen, planeY = dirX * planeLen;

        renderWalls(dirX, dirY, planeX, planeY);
        renderSprites(dirX, dirY, planeX, planeY);
        fbCtx.putImageData(fbImage, 0, 0);
        if (gameState !== 'title') renderWeapon();
        renderOverlays();
        renderStatusBar();

        var sw = screenCanvas.width, sh = screenCanvas.height;
        var scale = Math.min(sw / RW, sh / BASE_H);
        var dw = Math.round(RW * scale), dh = Math.round(BASE_H * scale);
        screenCtx.imageSmoothingEnabled = false;
        screenCtx.fillStyle = '#000';
        screenCtx.fillRect(0, 0, sw, sh);
        screenCtx.drawImage(fb, Math.floor((sw - dw) / 2), Math.floor((sh - dh) / 2), dw, dh);
    }

    // =================================================================
    //  SCREENS & FLOW
    // =================================================================
    function $(id) { return document.getElementById(id); }

    var SCREENS = ['game-start-screen', 'game-pause-screen', 'game-level-screen', 'game-over-screen'];

    function showScreen(id) {
        SCREENS.forEach(function (s) { var el = $(s); if (el) el.hidden = s !== id; });
        updateTouchVisibility();
    }

    function exitLock() {
        if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    }

    function playAccess() {
        var ov = $('access-granted-overlay');
        ov.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(function () { ov.style.display = 'none'; launch(); }, 2200);
    }

    function launch() {
        $('game-overlay').style.display = 'block';
        document.body.style.overflow = 'hidden';
        active = true; paused = false;
        screenCanvas = $('game-canvas');
        screenCtx = screenCanvas.getContext('2d');
        mobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        try { hiScore = parseInt(localStorage.getItem('pipettenstein_highscore') || '0', 10) || 0; } catch (e) { hiScore = 0; }

        buildAssets();
        bindUI();

        // Title backdrop: floor 1, camera slowly panning
        player = newPlayer();
        loadLevel(0);
        gameState = 'title';
        resize();

        window.addEventListener('resize', resize);
        window.addEventListener('blur', onBlur);
        document.addEventListener('pointerlockchange', onPointerLockChange);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        screenCanvas.addEventListener('mousedown', onMouseDown);

        $('game-highscore').textContent = hiScore > 0 ? 'HIGH SCORE: ' + hiScore : '';
        showScreen('game-start-screen');

        if (debug) exposeDebug();

        lastTime = performance.now();
        if (animId) cancelAnimationFrame(animId);
        animId = requestAnimationFrame(loop);
    }

    function loop(ts) {
        if (!active) return;
        var dt = Math.min(0.05, Math.max(0, (ts - lastTime) / 1000));
        lastTime = ts;
        if (gameState === 'title') player.a += dt * 0.12;
        else if (!paused && !frozen && (gameState === 'playing' || gameState === 'dying' || gameState === 'exiting')) update(dt);
        render();
        animId = requestAnimationFrame(loop);
    }

    function beginPlay() {
        gameState = 'playing';
        paused = false;
        keys = {}; fireHeld = false; touchFire = false; showMap = false;
        buildShadeRows();
        showScreen(null);
        // Don't leave the clicked button focused, or Space could re-trigger it
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (!mobile) requestLock();
    }

    function startGame() {
        audio();
        player = newPlayer();
        player.levelStartScore = 0;
        loadLevel(0);
        beginPlay();
    }

    function nextLevel() {
        player.levelStartScore = player.score;
        loadLevel(levelIndex + 1);
        beginPlay();
    }

    function formatTime(t) {
        var m = Math.floor(t / 60), s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function showLevelEnd() {
        gameState = 'levelEnd';
        exitLock();
        var pct = function (a, b) { return b ? Math.round(a * 100 / b) : 100; };
        var k = pct(stats.kills, stats.totalKills), s = pct(stats.secrets, stats.totalSecrets), t = pct(stats.treasure, stats.totalTreasure);
        var bonus = (k === 100 ? 10000 : 0) + (s === 100 ? 10000 : 0) + (t === 100 ? 10000 : 0);
        var par = 150 + levelIndex * 30;
        if (levelTime < par) bonus += Math.round(par - levelTime) * 50;
        addScore(bonus);

        $('game-level-title').textContent = level.name + ' COMPLETE';
        $('game-stat-kills').textContent = k + '%';
        $('game-stat-secrets').textContent = s + '%';
        $('game-stat-treasure').textContent = t + '%';
        $('game-stat-time').textContent = formatTime(levelTime);
        $('game-stat-bonus').textContent = bonus;
        $('game-next-btn').textContent = 'NEXT: ' + LEVELS[levelIndex + 1].title;
        showScreen('game-level-screen');
    }

    function onDeathFinished() {
        if (player.lives < 0) { showGameOver(false); return; }
        var p = newPlayer();
        p.lives = player.lives;
        p.score = player.levelStartScore || 0;
        p.levelStartScore = p.score;
        p.nextLifeScore = player.nextLifeScore;
        // Keep collected weapons (and enough tips to use them) after dying
        p.weapons = player.weapons.slice();
        p.ammo = Math.max(player.ammo, 25);
        p.weapon = player.weapon;
        if (p.weapon === W.NOTEBOOK) {
            for (var w = 3; w >= 1; w--) if (p.weapons[w]) { p.weapon = w; break; }
        }
        player = p;
        loadLevel(levelIndex);
        buildShadeRows();
        gameState = 'playing';
        showMsg('BACK TO THE BENCH. LIVES LEFT: ' + player.lives, 3);
    }

    function showGameOver(win) {
        gameState = win ? 'victory' : 'gameOver';
        exitLock();
        var score = player.score, best = score > hiScore;
        if (best) {
            hiScore = score;
            try { localStorage.setItem('pipettenstein_highscore', String(score)); } catch (e) { /* storage blocked */ }
        }
        var title = $('game-over-title');
        title.textContent = win ? 'MANUSCRIPT ACCEPTED' : 'EXPERIMENT FAILED';
        title.classList.toggle('game-title-bad', !win);
        $('game-over-message').textContent = win
            ? 'Reviewer #2 has been satisfied. Your paper is headed to press.'
            : DEATH_MSGS[Math.floor(Math.random() * DEATH_MSGS.length)];
        $('game-final-score').textContent = score;
        $('game-final-floor').textContent = levelIndex + 1;
        var hs = $('game-over-highscore');
        hs.textContent = best && score > 0 ? 'NEW HIGH SCORE!' : 'HIGH SCORE: ' + hiScore;
        hs.style.color = best && score > 0 ? GOLD : '';
        $('game-restart-btn').textContent = win ? 'PLAY AGAIN' : 'TRY AGAIN';
        showScreen('game-over-screen');
    }

    function showVictory() {
        sfx('oneup');
        showGameOver(true);
    }

    function setPaused(p) {
        if (p && gameState !== 'playing') return;
        paused = p;
        keys = {}; fireHeld = false; touchFire = false; showMap = false;
        if (p) {
            exitLock();
            $('game-mute-btn').textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
            showScreen('game-pause-screen');
        } else {
            showScreen(null);
            if (!mobile) requestLock();
            lastTime = performance.now();
        }
    }

    function exitGame() {
        active = false; paused = false; unlocked = false; codeBuffer = '';
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        exitLock();
        keys = {}; fireHeld = false; touchFire = false;
        $('game-overlay').style.display = 'none';
        document.body.style.overflow = '';
        window.removeEventListener('resize', resize);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (screenCanvas) screenCanvas.removeEventListener('mousedown', onMouseDown);
    }

    // =================================================================
    //  BUTTONS & TOUCH CONTROLS
    // =================================================================
    var uiBound = false;
    var frozen = false; // debug only: stops the live loop so frames can be inspected

    function bindUI() {
        if (uiBound) return;
        uiBound = true;
        $('game-start-btn').addEventListener('click', startGame);
        $('game-restart-btn').addEventListener('click', startGame);
        $('game-resume-btn').addEventListener('click', function () { setPaused(false); });
        $('game-next-btn').addEventListener('click', nextLevel);
        $('game-mute-btn').addEventListener('click', function () {
            muted = !muted;
            this.textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON');
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-game-exit]'), function (b) {
            b.addEventListener('click', exitGame);
        });
        bindTouch();
    }

    function updateTouchVisibility() {
        var el = $('game-touch');
        if (el) el.hidden = !(mobile && active && gameState === 'playing' && !paused);
    }

    function bindTouch() {
        var stick = $('touch-stick'), knob = $('touch-knob'), look = $('touch-look');
        var stickId = null, sx = 0, sy = 0, lookId = null, lx = 0;

        stick.addEventListener('touchstart', function (e) {
            e.preventDefault();
            var t = e.changedTouches[0], r = stick.getBoundingClientRect();
            stickId = t.identifier; sx = r.left + r.width / 2; sy = r.top + r.height / 2;
            moveStick(t);
        }, { passive: false });
        stick.addEventListener('touchmove', function (e) {
            e.preventDefault();
            for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === stickId) moveStick(e.changedTouches[i]);
        }, { passive: false });
        var endStick = function (e) {
            for (var i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === stickId) {
                    stickId = null; touchMove.x = 0; touchMove.y = 0;
                    knob.style.transform = 'translate(-50%, -50%)';
                }
            }
        };
        stick.addEventListener('touchend', endStick);
        stick.addEventListener('touchcancel', endStick);

        function moveStick(t) {
            var dx = clamp(t.clientX - sx, -50, 50), dy = clamp(t.clientY - sy, -50, 50);
            touchMove.x = Math.abs(dx) < 8 ? 0 : dx / 50;
            touchMove.y = Math.abs(dy) < 8 ? 0 : dy / 50;
            knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
        }

        look.addEventListener('touchstart', function (e) {
            e.preventDefault();
            var t = e.changedTouches[0];
            lookId = t.identifier; lx = t.clientX;
        }, { passive: false });
        look.addEventListener('touchmove', function (e) {
            e.preventDefault();
            for (var i = 0; i < e.changedTouches.length; i++) {
                var t = e.changedTouches[i];
                if (t.identifier === lookId) { touchTurn += (t.clientX - lx) * 0.008; lx = t.clientX; }
            }
        }, { passive: false });
        look.addEventListener('touchend', function () { lookId = null; });

        var fire = $('touch-fire');
        fire.addEventListener('touchstart', function (e) { e.preventDefault(); audio(); touchFire = true; }, { passive: false });
        fire.addEventListener('touchend', function (e) { e.preventDefault(); touchFire = false; }, { passive: false });
        fire.addEventListener('touchcancel', function () { touchFire = false; });
        $('touch-use').addEventListener('touchstart', function (e) { e.preventDefault(); if (gameState === 'playing') useAction(); }, { passive: false });
        $('touch-weapon').addEventListener('touchstart', function (e) {
            e.preventDefault();
            for (var k = 1; k <= 4; k++) {
                var w = (player.weapon + k) % 4;
                if (player.weapons[w] && (w === W.NOTEBOOK || player.ammo > 0)) { player.weapon = w; break; }
            }
        }, { passive: false });
        $('touch-pause').addEventListener('touchstart', function (e) { e.preventDefault(); setPaused(true); }, { passive: false });
    }

    // =================================================================
    //  DEBUG HOOKS (only with #p3d-debug in the URL)
    // =================================================================
    function exposeDebug() {
        var problems = validateLevels();
        if (problems.length) console.warn('[p3d] level problems:', problems);
        window.__p3d = {
            validate: validateLevels,
            start: startGame,
            warp: function (n) { if (!player) player = newPlayer(); player.levelStartScore = player.score; loadLevel(n); beginPlay(); },
            give: function () { player.weapons = [true, true, true, true]; player.ammo = 99; player.hasKey = true; player.weapon = W.LN2; },
            tp: function (x, y, a) { player.x = x; player.y = y; if (a !== undefined) player.a = a; },
            killAll: function () { enemies.forEach(function (e) { if (e.state !== 'dead' && e.state !== 'dying') killEnemy(e); }); },
            use: useAction,
            art: function () { return { weapons: weaponFrames, icons: weaponIcons, tip: tipSprite, multiPickup: sprites[SP.MULTI].canvas }; },
            fire: function (on) { fireHeld = on; },
            key: function (code, on) { keys[code] = on; },
            hurt: function (n) { hurtPlayer(n); },
            freeze: function (on) { frozen = on; render(); },
            // Advance the simulation without waiting on requestAnimationFrame
            step: function (seconds, dt) {
                dt = dt || 1 / 60;
                for (var t = 0; t < seconds; t += dt) { if (!paused) update(dt); }
                render();
            },
            bench: function (n) {
                var t0 = performance.now();
                for (var i = 0; i < n; i++) render();
                return (performance.now() - t0) / n;
            },
            get state() {
                return {
                    gameState: gameState, paused: paused, level: levelIndex, x: player.x, y: player.y, a: player.a,
                    health: player.health, ammo: player.ammo, score: player.score, lives: player.lives, weapon: player.weapon,
                    hasKey: player.hasKey, stats: stats, RW: RW,
                    alive: enemies.filter(function (e) { return e.state !== 'dead' && e.state !== 'dying'; }).length
                };
            },
            get enemies() { return enemies; },
            get doors() { return doors; },
            reachable: function (n) { return reachability(n); }
        };
    }

    // Flood fill from the start (doors passable, locked doors only if the key is reachable first)
    function reachability(n) {
        var L = LEVELS[n], rows = L.map, H = rows.length, Wd = rows[0].length;
        var start = null;
        rows.forEach(function (r, y) { for (var x = 0; x < Wd; x++) if ('^v<>'.indexOf(r[x]) >= 0) start = [x, y]; });
        function fill(allowLocked) {
            var seenCells = {}, q = [start], found = { key: false, exit: false, enemies: 0, items: 0 };
            seenCells[start.join()] = true;
            while (q.length) {
                var c = q.shift(), ch = rows[c[1]][c[0]];
                if (ch === 'k') found.key = true;
                if (ENEMY_DEFS[ch]) found.enemies++;
                if (ITEM_DEFS[ch]) found.items++;
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
                    var nx = c[0] + d[0], ny = c[1] + d[1], key = nx + ',' + ny;
                    if (nx < 0 || ny < 0 || nx >= Wd || ny >= H || seenCells[key]) return;
                    var nc = rows[ny][nx];
                    if (nc === 'X') { found.exit = true; return; }
                    if (WALL_CHARS[nc] !== undefined) return;
                    if (DECOR_DEFS[nc] && DECOR_DEFS[nc].block) return;
                    if (nc === '=' && !allowLocked) return;
                    seenCells[key] = true;
                    q.push([nx, ny]);
                });
            }
            return found;
        }
        var before = fill(false), after = fill(true);
        return { keyBeforeLock: before.key, exitReachable: after.exit, exitWithoutKey: before.exit, enemiesReachable: after.enemies, itemsReachable: after.items };
    }
})();
