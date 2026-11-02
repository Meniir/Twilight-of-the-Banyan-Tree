// SUMMARY: Custom Severe State Situations (SSS) difficulty node-tree.
// Unlocks after winning on Historical. Pressing the custom difficulty button pops up a dedicated Win95
// window containing a 2448x1478 2D drag-to-pan board (vertical & horizontal cursor dragging).
// Root cards in Column 0 are open immediately; downstream cards unlock when a connected prerequisite card is active.
// Hovering over any card highlights the exact prerequisite path from a Root card to the hovered card.
// Winning with every card at Rank III (20) grants the 'ucn_6am' ("Bragging Rights") achievement; Rank II+ (10) grants 'dials_ten'.
// Load order: after game.js and achievements.js. Texts live in data/language/*/interface/gameplay.json (ucn.*).

(function () {
    'use strict';

    const CUSTOM_KEY = 'habibie_ucn_custom';
    const MAX_LEVEL = 20;
    const DEFAULT_LEVEL = 10;
    const ACH_ID = 'ucn_6am';
    const UNLOCK_ACH = 'win_historical';
    const PLACEHOLDER_IMG = 'photo/placeholder.jpg';

    // Contract Ranks mapped to internal 0-20 levels so achievements (10 and 20) and lerp() anchors stay 100% compatible.
    const RANKS = [0, 5, 10, 20];

    // Spread-out board geometry (6 columns x 4 rows) for spacious 2D vertical + horizontal panning.
    const PAD_X = 72;
    const PAD_Y = 86;
    const CARD_W = 264;
    const CARD_H = 258;
    const GAP_X = 144;
    const GAP_Y = 96;
    const COLS = 6;
    const ROWS = 4;
    const BOARD_W = PAD_X * 2 + COLS * CARD_W + (COLS - 1) * GAP_X; // 2448px
    const BOARD_H = PAD_Y + ROWS * CARD_H + (ROWS - 1) * GAP_Y + 72; // 1478px
    const ZOOM_SCALE = 0.75;

    // Election drama at the three anchor levels (0, 10, 20): Medium, Historical and the extreme end.
    const DRAMA = {
        n: { moodSwing: 8,  wildcardChance: 0.35, wildcardMin: 15, wildcardMax: 35, crossoverRate: 0.20 },
        h: { moodSwing: 12, wildcardChance: 1.5,  wildcardMin: 25, wildcardMax: 50, crossoverRate: 0.55 },
        m: { moodSwing: 16, wildcardChance: 1.8,  wildcardMin: 28, wildcardMax: 53, crossoverRate: 0.67 }
    };

    // Value at a contract level: n at 0, h at 10 (Historical), m at 20.
    function lerp(level, n, h, m) {
        const l = Math.max(0, Math.min(MAX_LEVEL, level));
        return l <= DEFAULT_LEVEL ? n + (h - n) * (l / DEFAULT_LEVEL) : h + (m - h) * ((l - DEFAULT_LEVEL) / DEFAULT_LEVEL);
    }
    const r1 = v => Math.round(v * 10) / 10;
    const r2 = v => Math.round(v * 100) / 100;
    const sgn = v => (v > 0 ? '+' : '') + v;

    // Safe localization helper with fallback text for newly added UI keys.
    function locOr(key, fallback, vars) {
        return (typeof LOC === 'function' && LOC.has && LOC.has(key)) ? LOC(key, vars) : fallback;
    }

    // Start-value cards: delta to the opening value of one metric (+5 at 0, -1 at 10, -7 at 20).
    function startCard(id, key, base, group, col, row, prereqs) {
        return {
            id, group, col, row, prereqs: prereqs || [],
            n: 5, h: -1, m: -7,
            apply: (d, v) => { d.startMods[key] = Math.round(v); },
            fmt: v => ({ V: base + Math.round(v) })
        };
    }

    // The 24 Situation cards arranged across 4 horizontal tracks (rows 0..3) and 6 columns (cols 0..5).
    // Every prerequisite connects from (col - 1) in the same or adjacent row, so connector lines never cross over a card.
    const SLIDERS = [
        // ---- ROW 0: Track I — Executive & Palace Paralysis ----
        { id: 'pc', group: 'run', col: 0, row: 0, prereqs: [], n: 50, h: 20, m: 8,
          apply: (d, v) => { d.pc = Math.round(v); }, fmt: v => ({ V: Math.round(v) }) },
        { id: 'passive', group: 'run', col: 1, row: 0, prereqs: ['pc'], n: 1, h: 0, m: -1.2,
          apply: (d, v) => { d.passivePCMod = Math.round(v); }, fmt: v => ({ V: sgn(Math.round(v)) }) },
        { id: 'cost', group: 'run', col: 2, row: 0, prereqs: ['passive', 's_intl'], n: 0, h: 1, m: 2.33,
          apply: () => {}, custom: true },
        { id: 'cooldown', group: 'run', col: 3, row: 0, prereqs: ['cost', 's_pop'], n: 0, h: 1, m: 2.2,
          apply: (d, v) => { d.cooldownBonus = Math.round(v); }, fmt: v => ({ V: Math.round(v) }) },
        { id: 'malus', group: 'run', col: 4, row: 0, prereqs: ['cooldown'], n: 0.35, h: 3.25, m: 4.85,
          apply: (d, v) => { d.malusCap = r2(v); }, fmt: v => ({ V: r1(Math.min(5, v)) }) },
        { id: 'bad', group: 'politics', col: 5, row: 0, prereqs: ['malus', 'good'], n: 1, h: 1.1, m: 1.33,
          apply: (d, v) => { d.eventNegMult = r2(v); }, fmt: v => ({ V: r2(v) }) },

        // ---- ROW 1: Track II — The May 1998 Inheritance ----
        startCard('s_econ', 'econ', 20, 'start', 0, 1, []),
        startCard('s_intl', 'intl', 30, 'start', 1, 1, ['pc', 's_econ']),
        startCard('s_pop',  'pop',  30, 'start', 2, 1, ['passive', 's_intl']),
        startCard('s_ref',  'ref',  40, 'start', 3, 1, ['s_pop', 'regen']),
        { id: 'good', group: 'politics', col: 4, row: 1, prereqs: ['cooldown', 's_ref'], n: 1, h: 0.95, m: 0.78,
          apply: (d, v) => { d.eventPosMult = r2(v); }, fmt: v => ({ V: r2(v) }) },
        { id: 'erosion', group: 'politics', col: 5, row: 1, prereqs: ['good', 'favor'], n: 0, h: 0.4, m: 1.04,
          apply: (d, v) => { d.factionDrift = r2(v); }, fmt: v => ({ V: r2(v) }) },

        // ---- ROW 2: Track III — Cendana & Senayan Patronage ----
        { id: 's_cendana', group: 'start', col: 0, row: 2, prereqs: [], n: 60, h: 95, m: 98,
          apply: (d, v) => { d.cendana = Math.round(v); }, fmt: v => ({ V: Math.round(v) }) },
        { id: 's_goodwill', group: 'start', col: 1, row: 2, prereqs: ['s_econ', 's_cendana'], n: 5, h: -1, m: -7,
          apply: (d, v) => { d.affinityMod = Math.round(v); }, fmt: v => ({ V: sgn(Math.round(v)) }) },
        { id: 'regen', group: 'politics', col: 2, row: 2, prereqs: ['s_goodwill', 's_mil'], n: 0, h: 1, m: 2.16,
          apply: (d, v) => { d.cendanaRegen = r2(v); }, fmt: v => ({ V: r2(v) }) },
        { id: 'yield', group: 'politics', col: 3, row: 2, prereqs: ['s_pop', 'regen'], n: 1, h: 0.95, m: 0.75,
          apply: (d, v) => { d.gainMult = r2(v); }, fmt: v => ({ V: r2(v) }) },
        { id: 'favor', group: 'politics', col: 4, row: 2, prereqs: ['yield', 'pdip'], n: 3, h: 2, m: 0.8,
          apply: (d, v) => { d.maxFavor = Math.round(v); }, fmt: v => ({ V: Math.round(v) }) },
        { id: 'defect', group: 'opposition', col: 5, row: 2, prereqs: ['favor', 'chaos'], n: 1, h: 1.3, m: 1.82,
          apply: (d, v) => { d.opposition.defectionMult = r2(v); }, fmt: v => ({ V: r2(v) }) },

        // ---- ROW 3: Track IV — Streets & Barracks (Dual Front) ----
        startCard('s_stab', 'stab', 25, 'start', 0, 3, []),
        startCard('s_mil',  'mil',  50, 'start', 1, 3, ['s_cendana', 's_stab']),
        { id: 'army', group: 'opposition', col: 2, row: 3, prereqs: ['s_goodwill', 's_mil'], n: 0.6, h: 1.0, m: 1.29,
          apply: (d, v) => { d.opposition.scale = r2(v); }, fmt: v => ({ V: r2(v) }) },
        { id: 'pdip', group: 'opposition', col: 3, row: 3, prereqs: ['army'], n: 10, h: 20, m: 50, custom: true },
        { id: 'chaos', group: 'opposition', col: 4, row: 3, prereqs: ['yield', 'pdip'], n: 0, h: 1, m: 2, custom: true },
        { id: 'military', group: 'opposition', col: 5, row: 3, prereqs: ['chaos'], n: 0.10, h: 0.50, m: 0.75, custom: true }
    ];

    const SLIDER_MAP = {};
    SLIDERS.forEach(s => { SLIDER_MAP[s.id] = s; });
    const BY_COL = [...SLIDERS].sort((a, b) => (a.col - b.col) || (a.row - b.row));

    // Card value at a level.
    function valueOf(s, level) { return lerp(level, s.n, s.h, s.m); }

    // Cost card: faction cost %, decree cost %, flat PC (Medium -> Historical -> extreme).
    function costNumbers(level) {
        return {
            C: Math.round(lerp(level, 0, 15, 27)),
            D: Math.round(lerp(level, 0, 8, 14)),
            F: Math.round(lerp(level, 0, 2, 4))
        };
    }
    // Chaos card: election drama block, field by field.
    function dramaAt(level) {
        const out = {};
        Object.keys(DRAMA.h).forEach(k => {
            const v = lerp(level, DRAMA.n[k], DRAMA.h[k], DRAMA.m[k]);
            out[k] = (k === 'wildcardMin' || k === 'wildcardMax' || k === 'moodSwing') ? Math.round(v) : r2(v);
        });
        return out;
    }

    // Military card: the meter's numbers at a level (Medium -> Historical -> extreme).
    function militaryAt(level) {
        return {
            milCeiling: r2(lerp(level, 0.10, 0.50, 0.75)),
            milPatienceDecay: r1(lerp(level, 4, 6, 9)),
            milAngerRise: r1(lerp(level, 8, 10, 14)),
            milStubborn: r2(lerp(level, 0.35, 0.50, 0.92)),
            milCalm: r1(lerp(level, 9, 7, 2))
        };
    }

    // PDI-P card: the Street Mobilization bar's numbers at a level (Medium -> Historical -> extreme).
    function pdipAt(level) {
        return {
            pdipStart: Math.round(lerp(level, 10, 20, 50)),
            pdipRise: r1(lerp(level, 2.2, 3.8, 5.4)),
            pdipCostMax: r1(lerp(level, 5, 8, 12)),
            pdipCut: r2(lerp(level, 0.06, 0.10, 0.15)),
            pdipMustGo: r2(lerp(level, 0.06, 0.10, 0.16))
        };
    }

    // Snap any saved number to the nearest Contract Rank (0, 5, 10, 20).
    function snapRank(v) {
        const n = Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(v) || 0)));
        if (n <= 2) return 0;
        if (n <= 7) return 5;
        if (n <= 14) return 10;
        return 20;
    }

    // Rank index (0 = Off, 1 = Rank I, 2 = Rank II, 3 = Rank III).
    function rankOf(level) {
        const l = snapRank(level);
        return Math.max(0, RANKS.indexOf(l));
    }

    // True when a card is unlocked: root cards (col 0) are always unlocked; others require at least one active parent.
    function isCardUnlocked(s, levels) {
        if (!s.prereqs || s.prereqs.length === 0) return true;
        const lv = levels || settings.levels;
        return s.prereqs.some(pid => (lv[pid] || 0) > 0);
    }

    // Sweeps left-to-right (col 0..5) and powers down any card whose prerequisites are all inactive.
    function enforcePrerequisites(levels) {
        const lv = levels || settings.levels;
        BY_COL.forEach(s => {
            if (!isCardUnlocked(s, lv) && lv[s.id] > 0) {
                lv[s.id] = 0;
            }
        });
    }

    // ---- Player settings (saved in the browser) ----
    function defaults() {
        const levels = {};
        SLIDERS.forEach(s => { levels[s.id] = DEFAULT_LEVEL; });
        return { levels, hideForecast: true, zoomOut: false };
    }
    function sanitize(obj) {
        const base = defaults();
        if (obj && typeof obj === 'object') {
            if (obj.levels && typeof obj.levels === 'object') {
                SLIDERS.forEach(s => {
                    const v = Number(obj.levels[s.id]);
                    if (!isNaN(v)) base.levels[s.id] = snapRank(v);
                });
            }
            if (typeof obj.hideForecast === 'boolean') base.hideForecast = obj.hideForecast;
            if (typeof obj.zoomOut === 'boolean') base.zoomOut = obj.zoomOut;
        }
        enforcePrerequisites(base.levels);
        return base;
    }
    function load() {
        try { return sanitize(JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null')); } catch (e) { return defaults(); }
    }
    function save() {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(settings)); } catch (e) { console.warn(e); }
    }
    let settings = load();

    // Viewport pan state, hover path state & modal popup state
    let savedScrollLeft = 0;
    let savedScrollTop = 0;
    let suppressNextCardClick = false;
    let openModalRequested = false;
    let hoveredCardId = null;

    // ---- Unlock and difficulty definition ----
    function unlocked() {
        return typeof unlockedAchievements !== 'undefined' && unlockedAchievements.indexOf(UNLOCK_ACH) >= 0;
    }
    function levelsAllMax(levels) {
        return !!levels && SLIDERS.every(s => Number(levels[s.id]) >= MAX_LEVEL);
    }

    function modeDisplayName() {
        return locOr('difficulty.ucn.name', 'Severe State Situations');
    }

    // Builds a full difficulty definition (same shape as config.json entries) from card levels.
    function buildDef(levels) {
        const cfgDef = (gameConfig.difficultySettings && gameConfig.difficultySettings.ucn) || {};
        const d = {
            name: modeDisplayName(),
            image: cfgDef.image,
            description: '',
            pc: 20, statMod: 0, cendana: 95, malusCap: 3.25, passivePCMod: 0,
            actionCostMod: 0, costPct: 0, decreeCostPct: 0,
            eventNegMult: 1, eventPosMult: 1, gainMult: 1, maxFavor: 2,
            factionDrift: 0, cendanaRegen: 0, cooldownBonus: 0,
            startMods: {},
            opposition: { scale: 1, defectionMult: 1, drama: {} }
        };
        SLIDERS.forEach(s => {
            const lv = (levels && levels[s.id] !== undefined) ? Number(levels[s.id]) : DEFAULT_LEVEL;
            if (s.id === 'cost') {
                const c = costNumbers(lv);
                d.costPct = c.C; d.decreeCostPct = c.D; d.actionCostMod = c.F;
            } else if (s.id === 'chaos') {
                d.opposition.drama = dramaAt(lv);
            } else if (s.id === 'military') {
                Object.assign(d.opposition, militaryAt(lv));
            } else if (s.id === 'pdip') {
                Object.assign(d.opposition, pdipAt(lv));
            } else {
                s.apply(d, valueOf(s, lv));
            }
        });
        const sm = d.startMods;
        d.statMod = Math.round((sm.pop + sm.ref + sm.econ + sm.intl + sm.stab) / 5);
        return d;
    }

    // Makes sure config has a "ucn" entry with an empty description and no legacy FNAF title.
    function ensureDef() {
        if (!gameConfig.difficultySettings) gameConfig.difficultySettings = {};
        if (!gameConfig.difficultySettings.ucn) {
            gameConfig.difficultySettings.ucn = { name: modeDisplayName(), description: '' };
        }
        const live = window.sssActive ? window.sssActive.levels : settings.levels;
        const keep = gameConfig.difficultySettings.ucn;
        const def = buildDef(live);
        def.image = keep.image;
        def.name = (keep.name && !/ultimate custom night/i.test(keep.name)) ? keep.name : modeDisplayName();
        def.description = '';
        gameConfig.difficultySettings.ucn = def;
        return def;
    }

    // Called when a campaign starts on this difficulty: freezes the current settings for the whole run.
    function startRun() {
        closeModal();
        enforcePrerequisites(settings.levels);
        window.sssActive = { levels: Object.assign({}, settings.levels), hideForecast: settings.hideForecast };
        ensureDef();
        if (settings.hideForecast) showOptionEffects = false;
    }

    // Called when a saved campaign is restored.
    function restoreRun(saved) {
        if (saved && saved.levels) {
            window.sssActive = sanitize(saved);
            ensureDef();
        }
    }

    // True if the running campaign has every card at or above the given level.
    function runAtLeast(level) {
        return selectedDifficulty === 'ucn' && !!window.sssActive && !!window.sssActive.levels &&
            SLIDERS.every(s => Number(window.sssActive.levels[s.id]) >= level);
    }

    // True if the running campaign has every card at the maximum.
    function runMaxed() {
        return selectedDifficulty === 'ucn' && !!window.sssActive && levelsAllMax(window.sssActive.levels);
    }

    // ---- Card Effect & Prerequisite Text ----
    function effectTextForLevel(s, lv) {
        if (s.id === 'cost') return LOC('ucn.slider.cost.value', costNumbers(lv));
        if (s.id === 'chaos') {
            const x = dramaAt(lv);
            return LOC('ucn.slider.chaos.value', {
                M: x.moodSwing,
                W: Math.min(100, Math.round(x.wildcardChance * 100)),
                X: Math.round(x.crossoverRate * 100)
            });
        }
        if (s.id === 'military') {
            const x = militaryAt(lv);
            return LOC('ucn.slider.military.value', {
                C: Math.round(x.milCeiling * 100), D: x.milPatienceDecay, R: x.milAngerRise,
                S: Math.round(x.milStubborn * 100), K: x.milCalm
            });
        }
        if (s.id === 'pdip') {
            const x = pdipAt(lv);
            return LOC('ucn.slider.pdip.value', {
                S: x.pdipStart, R: x.pdipRise, C: Math.round(x.pdipCut * 100),
                G: Math.round(x.pdipMustGo * 100), M: x.pdipCostMax + 1
            });
        }
        return LOC('ucn.slider.' + s.id + '.value', s.fmt(valueOf(s, lv)));
    }

    function effectText(s) {
        return effectTextForLevel(s, settings.levels[s.id] || 0);
    }

    function bannerHTML() {
        return LOC(levelsAllMax(settings.levels) ? 'ucn.banner.maxed' : 'ucn.banner.hint');
    }

    // Pixel position of a card's top-left corner on the board.
    function cardPos(s) {
        return {
            x: PAD_X + s.col * (CARD_W + GAP_X),
            y: PAD_Y + s.row * (CARD_H + GAP_Y)
        };
    }

    // Builds the SVG path between parent and child cards in adjacent columns.
    function buildEdgePath(parent, child) {
        const p1 = cardPos(parent);
        const p2 = cardPos(child);
        const x1 = p1.x + CARD_W;
        const y1 = p1.y + Math.round(CARD_H / 2);
        const x2 = p2.x;
        const y2 = p2.y + Math.round(CARD_H / 2);

        // Same row: one straight horizontal line.
        if (y1 === y2) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }
        // Different rows: horizontal out of the parent, one vertical line in the middle
        // of the inter-column corridor, then horizontal into the child.
        const midX = x1 + Math.round((x2 - x1) / 2);
        return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    }

    function edgeStateClass(parent, child) {
        const pLv = settings.levels[parent.id] || 0;
        const cLv = settings.levels[child.id] || 0;
        if (pLv > 0 && cLv > 0) {
            return (pLv >= 20 && cLv >= 20) ? 'ucn-edge is-max' : 'ucn-edge is-active';
        }
        if (pLv > 0) return 'ucn-edge is-unlocked';
        return 'ucn-edge is-locked';
    }

    function renderEdgesSVG() {
        let paths = '';
        let dots = '';
        SLIDERS.forEach(child => {
            (child.prereqs || []).forEach(pid => {
                const parent = SLIDER_MAP[pid];
                if (!parent) return;
                const d = buildEdgePath(parent, child);
                const cls = edgeStateClass(parent, child);
                const p1 = cardPos(parent);
                const p2 = cardPos(child);
                const x1 = p1.x + CARD_W, y1 = p1.y + Math.round(CARD_H / 2);
                const x2 = p2.x, y2 = p2.y + Math.round(CARD_H / 2);
                paths += `<path id="ucn-edge-${parent.id}-${child.id}" class="${cls}" d="${d}" fill="none" />`;
                dots += `<circle id="ucn-dot-out-${parent.id}-${child.id}" class="${cls}-dot" cx="${x1}" cy="${y1}" r="4" />`;
                dots += `<polygon id="ucn-arrow-${parent.id}-${child.id}" class="${cls}-arrow" points="${x2},${y2} ${x2 - 8},${y2 - 5} ${x2 - 8},${y2 + 5}" />`;
            });
        });
        return `<svg id="ucn-cc-svg" class="ucn-cc-svg" width="${BOARD_W}" height="${BOARD_H}" viewBox="0 0 ${BOARD_W} ${BOARD_H}" aria-hidden="true">${paths}${dots}</svg>`;
    }

    // ---- Prerequisite Path Finder & Hover Highlighting ----
    // Finds the optimal prerequisite chain [rootId, ..., targetId] from Column 0 to targetId.
    // Prioritizes ancestors that are already active (cost 0 to activate) and breaks ties by staying on the same horizontal row.
    function findRequiredPath(targetId) {
        const target = SLIDER_MAP[targetId];
        if (!target) return [];
        const lv = settings.levels || {};
        const memo = {};

        function solve(uid) {
            if (memo[uid]) return memo[uid];
            const u = SLIDER_MAP[uid];
            const isTarget = (uid === targetId);
            const nodeCost = (isTarget || (lv[uid] || 0) > 0) ? 0 : 100;

            if (!u.prereqs || u.prereqs.length === 0) {
                const res = { cost: nodeCost + Math.abs(u.row - target.row) * 2, path: [uid] };
                memo[uid] = res;
                return res;
            }

            let best = null;
            u.prereqs.forEach(pid => {
                const p = SLIDER_MAP[pid];
                if (!p) return;
                const sub = solve(pid);
                const turnPenalty = Math.abs(p.row - u.row) * 5 + Math.abs(p.row - target.row) * 2 - ((lv[pid] || 0) * 0.05);
                const total = sub.cost + nodeCost + turnPenalty;
                if (!best || total < best.cost) {
                    best = { cost: total, path: sub.path.concat([uid]) };
                }
            });
            memo[uid] = best || { cost: nodeCost, path: [uid] };
            return memo[uid];
        }

        return solve(targetId).path;
    }

    // Applies or clears the hovered prerequisite path classes across all cards and connector lines.
    function applyHoverPathDOM() {
        const canvas = document.getElementById('ucn-cc-canvas');
        if (!canvas) return;

        if (!hoveredCardId || !SLIDER_MAP[hoveredCardId]) {
            canvas.classList.remove('has-hover-path');
            canvas.querySelectorAll('.is-path-node, .is-path-target, .is-path-met, .is-path-needed').forEach(el => {
                el.classList.remove('is-path-node', 'is-path-target', 'is-path-met', 'is-path-needed');
            });
            canvas.querySelectorAll('.is-path-edge, .is-path-edge-dot, .is-path-edge-arrow').forEach(el => {
                el.classList.remove('is-path-edge', 'is-path-edge-dot', 'is-path-edge-arrow');
            });
            return;
        }

        const pathIds = findRequiredPath(hoveredCardId);
        const nodeSet = new Set(pathIds);
        const edgeSet = new Set();
        for (let i = 0; i < pathIds.length - 1; i++) {
            edgeSet.add(pathIds[i] + '->' + pathIds[i + 1]);
        }

        canvas.classList.add('has-hover-path');

        SLIDERS.forEach(s => {
            const cardEl = document.getElementById('ucn-card-' + s.id);
            if (!cardEl) return;
            const onPath = nodeSet.has(s.id);
            const isTarget = (s.id === hoveredCardId);
            const isActive = (settings.levels[s.id] || 0) > 0;

            cardEl.classList.toggle('is-path-node', onPath);
            cardEl.classList.toggle('is-path-target', isTarget);
            cardEl.classList.toggle('is-path-met', onPath && !isTarget && isActive);
            cardEl.classList.toggle('is-path-needed', onPath && !isTarget && !isActive);

            (s.prereqs || []).forEach(pid => {
                const isPathEdge = edgeSet.has(pid + '->' + s.id);
                const edgeEl = document.getElementById(`ucn-edge-${pid}-${s.id}`);
                const dotEl = document.getElementById(`ucn-dot-out-${pid}-${s.id}`);
                const arrEl = document.getElementById(`ucn-arrow-${pid}-${s.id}`);
                if (edgeEl) edgeEl.classList.toggle('is-path-edge', isPathEdge);
                if (dotEl) dotEl.classList.toggle('is-path-edge-dot', isPathEdge);
                if (arrEl) arrEl.classList.toggle('is-path-edge-arrow', isPathEdge);
            });
        });
    }

    function hoverCard(id) {
        if (activeDragState && activeDragState.moved) return;
        if (hoveredCardId === id) return;
        hoveredCardId = id;
        applyHoverPathDOM();
    }

    function unhoverCard(id) {
        if (hoveredCardId !== id) return;
        hoveredCardId = null;
        applyHoverPathDOM();
    }

    function rankBadgeText(rk, isOpen) {
        if (!isOpen) return '&#128274; ' + locOr('ucn.cc.locked_badge', 'LOCKED');
        if (rk === 0) return locOr('ucn.cc.rank_0', 'INACTIVE');
        if (rk === 1) return '&#9650; ' + locOr('ucn.cc.rank_1', 'SSS I');
        if (rk === 2) return '&#9650;&#9650; ' + locOr('ucn.cc.rank_2', 'SSS II');
        return '&#9650;&#9650;&#9650; ' + locOr('ucn.cc.rank_3', 'MAX SSS');
    }

    function prereqLineHTML(s, isOpen) {
        if (!s.prereqs || s.prereqs.length === 0) {
            return `<span class="ucn-cc-prereq is-root">&#9670; ${locOr('ucn.cc.root_node', 'Root Situation')}</span>`;
        }
        const names = s.prereqs.map(pid => LOC('ucn.slider.' + pid + '.name')).join(' / ');
        const prefix = isOpen
            ? locOr('ucn.cc.linked_from', 'Linked:')
            : ('&#128274; ' + locOr('ucn.cc.requires', 'Requires:'));
        return `<span class="ucn-cc-prereq ${isOpen ? 'is-met' : 'is-unmet'}" title="${prefix.replace(/<[^>]*>/g, '')} ${names.replace(/"/g, '&quot;')}">${prefix} <b>${names}</b></span>`;
    }

    function renderCardHTML(s) {
        const pos = cardPos(s);
        const lv = settings.levels[s.id] || 0;
        const rk = rankOf(lv);
        const isOpen = isCardUnlocked(s);
        const title = LOC('ucn.slider.' + s.id + '.name');
        const desc = LOC('ucn.slider.' + s.id + '.desc');
        const stateCls = !isOpen ? 'is-locked' : (rk === 0 ? 'is-off' : `is-active rank-${rk}`);
        const imgSrc = s.image || PLACEHOLDER_IMG;
        const placeholderText = `[ ${title.toUpperCase()} ]`;

        const rankBtns = [
            { r: 0, lv: 0,  lbl: locOr('ucn.cc.btn_off', 'OFF') },
            { r: 1, lv: 5,  lbl: 'I' },
            { r: 2, lv: 10, lbl: 'II' },
            { r: 3, lv: 20, lbl: 'III' }
        ].map(b => {
            const sel = (rk === b.r && isOpen) ? 'is-selected' : '';
            const dis = !isOpen ? 'disabled' : '';
            return `<button type="button" class="ucn-cc-rank-btn rank-btn-${b.r} ${sel}" ${dis} onclick="SSS.pickRank('${s.id}', ${b.lv}, event)">${b.lbl}</button>`;
        }).join('');

        return `<div id="ucn-card-${s.id}" class="ucn-cc-card ${stateCls}" style="left:${pos.x}px; top:${pos.y}px; width:${CARD_W}px; height:${CARD_H}px;" onmouseenter="SSS.hoverCard('${s.id}')" onmouseleave="SSS.unhoverCard('${s.id}')" onclick="SSS.cardClick('${s.id}', event)">
            <div class="ucn-cc-card-titlebar">
                <span class="ucn-cc-card-code">SSS-${String(SLIDERS.indexOf(s) + 1).padStart(2, '0')}</span>
                <span id="ucn-badge-${s.id}" class="ucn-cc-card-badge">${rankBadgeText(rk, isOpen)}</span>
            </div>
            <div class="ucn-cc-card-img glass-frame">
                <span class="ucn-cc-img-placeholder">${placeholderText}</span>
                <img src="${imgSrc}" alt="${title.replace(/"/g, '&quot;')}" draggable="false" onerror="this.style.display='none'">
            </div>
            <div class="ucn-cc-card-body">
                <div class="ucn-cc-card-name">${title}</div>
                <div class="ucn-cc-card-desc">${desc}</div>
                <div id="ucn-eff-${s.id}" class="ucn-cc-card-effect">${effectText(s)}</div>
            </div>
            <div class="ucn-cc-card-footer">
                <div id="ucn-req-${s.id}" class="ucn-cc-prereq-wrap">${prereqLineHTML(s, isOpen)}</div>
                <div id="ucn-rbtns-${s.id}" class="ucn-cc-rank-bar">${rankBtns}</div>
            </div>
        </div>`;
    }

    function renderTrackHeadersHTML() {
        const tracks = [
            { col: 0, label: locOr('ucn.cc.col.0', 'TIER I') },
            { col: 1, label: locOr('ucn.cc.col.1', 'TIER II') },
            { col: 2, label: locOr('ucn.cc.col.2', 'TIER III') },
            { col: 3, label: locOr('ucn.cc.col.3', 'TIER IV') },
            { col: 4, label: locOr('ucn.cc.col.4', 'TIER V') },
            { col: 5, label: locOr('ucn.cc.col.5', 'TIER VI') }
        ];
        return tracks.map(t => {
            const x = PAD_X + t.col * (CARD_W + GAP_X);
            return `<div class="ucn-cc-col-header" style="left:${x}px; top:24px; width:${CARD_W}px;">${t.label}</div>`;
        }).join('');
    }

    // Updates both the popup board and the Difficulty menu summary card in-place without resetting scroll/pan coordinates.
    function refreshBoardDOM() {
        enforcePrerequisites(settings.levels);
        save();

        const maxed = levelsAllMax(settings.levels);
        ['ucn-banner', 'ucn-inline-banner'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = bannerHTML();
                el.classList.toggle('is-maxed', maxed);
            }
        });

        SLIDERS.forEach(s => {
            const lv = settings.levels[s.id] || 0;
            const rk = rankOf(lv);
            const isOpen = isCardUnlocked(s);
            const cardEl = document.getElementById('ucn-card-' + s.id);
            if (cardEl) {
                cardEl.className = 'ucn-cc-card ' + (!isOpen ? 'is-locked' : (rk === 0 ? 'is-off' : `is-active rank-${rk}`));
            }
            const badgeEl = document.getElementById('ucn-badge-' + s.id);
            if (badgeEl) badgeEl.innerHTML = rankBadgeText(rk, isOpen);
            const effEl = document.getElementById('ucn-eff-' + s.id);
            if (effEl) effEl.innerHTML = effectText(s);
            const reqEl = document.getElementById('ucn-req-' + s.id);
            if (reqEl) reqEl.innerHTML = prereqLineHTML(s, isOpen);
            const rbtnsEl = document.getElementById('ucn-rbtns-' + s.id);
            if (rbtnsEl) {
                const btns = rbtnsEl.querySelectorAll('.ucn-cc-rank-btn');
                btns.forEach((btn, idx) => {
                    btn.disabled = !isOpen;
                    btn.classList.toggle('is-selected', isOpen && rk === idx);
                });
            }

            (s.prereqs || []).forEach(pid => {
                const parent = SLIDER_MAP[pid];
                if (!parent) return;
                const cls = edgeStateClass(parent, s);
                const edgeEl = document.getElementById(`ucn-edge-${parent.id}-${s.id}`);
                const dotEl = document.getElementById(`ucn-dot-out-${parent.id}-${s.id}`);
                const arrEl = document.getElementById(`ucn-arrow-${parent.id}-${s.id}`);
                if (edgeEl) edgeEl.setAttribute('class', cls);
                if (dotEl) dotEl.setAttribute('class', cls + '-dot');
                if (arrEl) arrEl.setAttribute('class', cls + '-arrow');
            });
        });

        applyHoverPathDOM();
    }

    // Briefly flashes the required prerequisite path when the player clicks a locked card.
    function flashPrereqs(s) {
        if (typeof window.playBlockedSfx === 'function') window.playBlockedSfx();
        const pathIds = findRequiredPath(s.id);
        pathIds.forEach(pid => {
            if (pid === s.id) return;
            const pEl = document.getElementById('ucn-card-' + pid);
            if (!pEl) return;
            pEl.classList.remove('ucn-prereq-flash');
            void pEl.offsetWidth;
            pEl.classList.add('ucn-prereq-flash');
            setTimeout(() => { if (pEl) pEl.classList.remove('ucn-prereq-flash'); }, 900);
        });
    }

    // Clicking the card body cycles: OFF (0) -> Rank II (10, Historical) -> Rank III (20, Max) -> OFF (0)
    // (or if currently at Rank I (5), steps up to Rank II (10)).
    function cardClick(id, evt) {
        if (suppressNextCardClick) {
            if (evt) evt.stopPropagation();
            return;
        }
        const s = SLIDER_MAP[id];
        if (!s) return;
        if (!isCardUnlocked(s)) {
            flashPrereqs(s);
            return;
        }
        const cur = snapRank(settings.levels[id] || 0);
        let next = 10;
        if (cur === 0) next = 10;
        else if (cur === 5) next = 10;
        else if (cur === 10) next = 20;
        else next = 0;

        settings.levels[id] = next;
        refreshBoardDOM();
    }

    // Clicking one of the [OFF] [I] [II] [III] buttons on a card footer.
    function pickRank(id, level, evt) {
        if (evt) evt.stopPropagation();
        if (suppressNextCardClick) return;
        const s = SLIDER_MAP[id];
        if (!s) return;
        if (!isCardUnlocked(s)) {
            flashPrereqs(s);
            return;
        }
        settings.levels[id] = snapRank(level);
        refreshBoardDOM();
    }

    // Direct level setter kept for console/API compatibility.
    function setLevel(id, value) {
        const s = SLIDER_MAP[id];
        if (!s) return;
        settings.levels[id] = snapRank(value);
        refreshBoardDOM();
    }

    // Preset: 0 = Clear All, 10 = Historical (All Rank II), 20 = Max Risk (All Rank III), -1 = Random valid tree.
    function preset(level) {
        if (level < 0) {
            BY_COL.forEach(s => {
                if (!isCardUnlocked(s, settings.levels)) {
                    settings.levels[s.id] = 0;
                } else {
                    const roll = Math.random();
                    const activeChance = s.col === 0 ? 0.80 : 0.65;
                    if (roll > activeChance) settings.levels[s.id] = 0;
                    else settings.levels[s.id] = RANKS[1 + Math.floor(Math.random() * 3)];
                }
            });
            if (SLIDERS.every(s => settings.levels[s.id] === 0)) {
                settings.levels.pc = 10;
                settings.levels.s_econ = 10;
            }
        } else {
            const snapped = snapRank(level);
            SLIDERS.forEach(s => { settings.levels[s.id] = snapped; });
        }
        refreshBoardDOM();
    }

    function applyZoomDOM() {
        const scale = settings.zoomOut ? ZOOM_SCALE : 1;
        const sizer = document.getElementById('ucn-cc-sizer');
        const canvas = document.getElementById('ucn-cc-canvas');
        const btn = document.getElementById('ucn-zoom-btn');
        if (sizer) {
            sizer.style.width = Math.round(BOARD_W * scale) + 'px';
            sizer.style.height = Math.round(BOARD_H * scale) + 'px';
        }
        if (canvas) {
            canvas.classList.toggle('is-zoomed-out', settings.zoomOut);
        }
        if (btn) {
            btn.classList.toggle('is-selected', settings.zoomOut);
        }
    }

    function toggleZoom() {
        settings.zoomOut = !settings.zoomOut;
        save();
        applyZoomDOM();
    }

    function resetView() {
        const vp = document.getElementById('ucn-cc-viewport');
        if (vp) {
            vp.scrollLeft = 0;
            vp.scrollTop = 0;
            savedScrollLeft = 0;
            savedScrollTop = 0;
        }
    }

    function toggleForecast(on) {
        settings.hideForecast = !!on;
        save();
        ['ucn-hide-forecast', 'ucn-inline-hide-forecast'].forEach(id => {
            const cb = document.getElementById(id);
            if (cb) cb.checked = settings.hideForecast;
        });
    }

    // ---- 2D Cursor Drag-to-Pan (Vertical + Horizontal) ----
    let activeDragState = null;

    function wireViewportDrag() {
        const vp = document.getElementById('ucn-cc-viewport');
        if (!vp || vp.__dragWired) return;
        vp.__dragWired = true;

        vp.scrollLeft = savedScrollLeft;
        vp.scrollTop = savedScrollTop;

        // Prevent native browser image/text drag from stealing mousemove events
        vp.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });

        vp.addEventListener('scroll', () => {
            savedScrollLeft = vp.scrollLeft;
            savedScrollTop = vp.scrollTop;
        }, { passive: true });

        vp.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            activeDragState = {
                vp: vp,
                moved: false,
                startX: e.clientX,
                startY: e.clientY,
                startSL: vp.scrollLeft,
                startST: vp.scrollTop
            };
        });
    }

    window.addEventListener('mousemove', (e) => {
        if (!activeDragState) return;
        const stDrag = activeDragState;
        const vp = stDrag.vp;
        if (!vp || !vp.isConnected) {
            activeDragState = null;
            return;
        }
        const dx = e.clientX - stDrag.startX;
        const dy = e.clientY - stDrag.startY;
        if (!stDrag.moved && Math.hypot(dx, dy) > 5) {
            stDrag.moved = true;
            vp.classList.add('is-grabbing');
        }
        if (stDrag.moved) {
            e.preventDefault();
            vp.scrollLeft = stDrag.startSL - dx;
            vp.scrollTop = stDrag.startST - dy;
            savedScrollLeft = vp.scrollLeft;
            savedScrollTop = vp.scrollTop;
        }
    }, { passive: false });

    window.addEventListener('mouseup', () => {
        if (!activeDragState) return;
        const wasMoved = activeDragState.moved;
        if (activeDragState.vp) activeDragState.vp.classList.remove('is-grabbing');
        activeDragState = null;
        if (wasMoved) {
            suppressNextCardClick = true;
            setTimeout(() => { suppressNextCardClick = false; }, 80);
        }
    });

    // ---- Full-Screen Severe State Situations Popup Window / Tab ----
    function buildModalWindowHTML() {
        const scale = settings.zoomOut ? ZOOM_SCALE : 1;
        const sizerW = Math.round(BOARD_W * scale);
        const sizerH = Math.round(BOARD_H * scale);
        const zoomCls = settings.zoomOut ? ' is-zoomed-out' : '';
        const dragHint = locOr('ucn.cc.drag_hint', '&#9995; Hold &amp; drag anywhere inside the board to pan vertically and horizontally &bull; Hover any Card to trace its required path');
        const confirmLbl = locOr('ucn.cc.confirm_close', 'Confirm Situations');
        const continueLbl = LOC('common.continue');

        let h = '<div class="ucn-cc-window" onclick="event.stopPropagation()">';
        h += '<div class="ucn-cc-window-titlebar">';
        h += '<span>' + LOC('ucn.panel.title') + '</span>';
        h += '<button type="button" class="win95-close-btn" onclick="SSS.closeModal()" title="Close">&#10005;</button>';
        h += '</div>';

        h += '<div class="ucn-cc-window-top">';
        h += '<div class="ucn-presets">';
        h += '<button type="button" onclick="SSS.preset(0)">' + LOC('ucn.preset.zero') + '</button>';
        h += '<button type="button" onclick="SSS.preset(10)">' + LOC('ucn.preset.historical') + '</button>';
        h += '<button type="button" class="ucn-preset-max" onclick="SSS.preset(20)">' + LOC('ucn.preset.max') + '</button>';
        h += '<button type="button" onclick="SSS.preset(-1)">' + LOC('ucn.preset.random') + '</button>';
        h += '<button type="button" id="ucn-zoom-btn" class="' + (settings.zoomOut ? 'is-selected' : '') + '" onclick="SSS.toggleZoom()">' + locOr('ucn.cc.zoom_btn', 'Overview (75%)') + '</button>';
        h += '<button type="button" onclick="SSS.resetView()">' + locOr('ucn.cc.reset_view', 'Reset View') + '</button>';
        h += '</div>';
        h += '<div id="ucn-banner" class="ucn-banner' + (levelsAllMax(settings.levels) ? ' is-maxed' : '') + '">' + bannerHTML() + '</div>';
        h += '<div class="ucn-cc-toolbar-hint">' + dragHint + '</div>';
        h += '</div>';

        h += '<div id="ucn-cc-viewport" class="ucn-cc-viewport">';
        h += `<div id="ucn-cc-sizer" class="ucn-cc-sizer" style="width:${sizerW}px; height:${sizerH}px;">`;
        h += `<div id="ucn-cc-canvas" class="ucn-cc-canvas${zoomCls}" style="width:${BOARD_W}px; height:${BOARD_H}px;">`;
        h += renderTrackHeadersHTML();
        h += renderEdgesSVG();
        SLIDERS.forEach(s => { h += renderCardHTML(s); });
        h += '</div></div></div>';

        h += '<div class="ucn-cc-window-footer">';
        h += '<label class="ucn-cc-forecast-label"><input type="checkbox" id="ucn-hide-forecast" ' +
            (settings.hideForecast ? 'checked' : '') + ' onchange="SSS.toggleForecast(this.checked)"> ' + LOC('ucn.hide_forecast') + '</label>';
        h += '<div class="ucn-cc-footer-btns">';
        h += '<button type="button" class="ucn-cc-confirm-btn" onclick="SSS.closeModal()">' + confirmLbl + '</button>';
        h += '<button type="button" class="ucn-cc-proceed-btn" onclick="SSS.proceedToSituation()">' + continueLbl + '</button>';
        h += '</div>';
        h += '</div>';
        h += '</div>';
        return h;
    }

    function openModal() {
        enforcePrerequisites(settings.levels);
        hoveredCardId = null;
        let overlay = document.getElementById('ucn-cc-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ucn-cc-modal-overlay';
            overlay.className = 'ucn-cc-modal-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = buildModalWindowHTML();
        overlay.style.display = 'flex';
        wireViewportDrag();
    }

    function closeModal() {
        hoveredCardId = null;
        const overlay = document.getElementById('ucn-cc-modal-overlay');
        if (overlay) overlay.style.display = 'none';
        refreshBoardDOM();
    }

    function proceedToSituation() {
        closeModal();
        if (typeof window.showSituation === 'function') window.showSituation();
    }

    // Intercept clicks on the SSS button in .difficulty-row so pressing it pops open the board window.
    document.addEventListener('click', (e) => {
        if (!e.target || !e.target.closest) return;
        const btn = e.target.closest('.difficulty-row button.ucn-diff-btn:not(.is-locked)');
        if (btn) {
            openModalRequested = true;
        }
    }, true);

    // Close the window on Escape when open.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('ucn-cc-modal-overlay');
            if (overlay && overlay.style.display === 'flex') {
                e.preventDefault();
                closeModal();
            }
        }
    });

    // Renders the compact launcher on the Difficulty Menu (with no description or rating box) and opens the popup tab when requested.
    function renderPanel() {
        enforcePrerequisites(settings.levels);
        const openBtnLbl = locOr('ucn.cc.open_board', 'OPEN SEVERE STATE SITUATIONS');

        let h = '<div class="ucn-panel ucn-cc-inline-summary">';
        h += '<div id="ucn-inline-banner" class="ucn-banner' + (levelsAllMax(settings.levels) ? ' is-maxed' : '') + '">' + bannerHTML() + '</div>';
        h += '<center><button type="button" class="ucn-open-board-btn" onclick="SSS.openModal()">' + openBtnLbl + '</button></center>';
        h += '<div class="ucn-forecast"><label style="cursor:pointer;"><input type="checkbox" id="ucn-inline-hide-forecast" ' +
            (settings.hideForecast ? 'checked' : '') + ' onchange="SSS.toggleForecast(this.checked)"> ' + LOC('ucn.hide_forecast') + '</label></div>';
        h += '</div>';

        if (openModalRequested) {
            openModalRequested = false;
            setTimeout(openModal, 0);
        }
        return h;
    }

    function lockedHint() { showCustomAlert(LOC('ucn.locked.hint'), null); }

    window.SSS = {
        sliders: SLIDERS, settings: () => settings,
        unlocked, buildDef, ensureDef, startRun, restoreRun, runMaxed, runAtLeast, levelsAllMax,
        lockedHint, renderPanel, openModal, closeModal, proceedToSituation,
        hoverCard, unhoverCard,
        set: setLevel, cardClick, pickRank, preset, toggleZoom, resetView, toggleForecast,
        isForecastHidden: () => settings.hideForecast,
        ACH_ID
    };
})();