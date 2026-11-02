// SUMMARY: Core game logic. Holds the game state (stats, factions, turn, decrees, cooldowns), loads and localizes all data files and images,
// builds the main menus (title, difficulty, situation, history, tutorial, credits), runs the event and action phases, decrees and faction actions,
// the whip count and parliament hemicycle, horse-trading, end-of-turn economy, appearance helpers and the music player.

// National metrics that give each faction its leverage over the president
const FACTION_LEVERAGE_METRICS = {
    'pdip': ['pop', 'ref'],
    'golkar_akbar': ['econ', 'stab', 'cendana'],
    'golkar_habibie': ['ref', 'econ', 'intl'],
    'poros_tengah': ['ref', 'pop'],
    'ppp': ['stab', 'pop'],
    'pkb': ['pop', 'ref'],
    'abri': ['mil', 'stab'],
    'utusan_daerah': ['econ', 'stab'],
    'utusan_golongan': ['ref', 'intl'],
    'other_parties': ['pop', 'stab']
};

// NIGHT OF THE LONG KNIVES: HORSE-TRADING COSTS (tweak these)
const HORSE_TRADE_SINGLE_COST = 1;
const HORSE_TRADE_BLOC_COST = 3;
const HORSE_TRADE_BLOC_OVERTURES = 5;

// PC cost of one overture, or of a whole bloc of overtures
function getHorseTradeCost(overtures) {
    return overtures >= HORSE_TRADE_BLOC_OVERTURES ? HORSE_TRADE_BLOC_COST : overtures * HORSE_TRADE_SINGLE_COST;
}

// PC cost of horse-trading with one faction (PDI-P's price climbs with the street mobilization)
function horseCostFor(factionKey, overtures) {
    const base = getHorseTradeCost(overtures);
    if (factionKey !== 'pdip' || !window.OppositionEngine) return base;
    return Math.max(base, Math.round(base * OppositionEngine.getPdipCostMult()));
}

// Horse-trading gain per overture = BASE x nationalMult x stanceMult x fatigue x jitter
const HORSE_TRADE_BASE_GAIN = 0.38;
const HORSE_TRADE_NATIONAL_MIN = 0.50;
const HORSE_TRADE_NATIONAL_RANGE = 1.00;
const HORSE_TRADE_MOOD_PEAK = 0.45;
const HORSE_TRADE_MOOD_FLOOR = 0.35;

// Horse-trading multiplier from Government Stability (average of all national metrics, with Cendana inverted)
function getHorseTradeNationalMult() {
    return HORSE_TRADE_NATIONAL_MIN + (getGovStability() / 100) * HORSE_TRADE_NATIONAL_RANGE;
}

// Horse-trading receptiveness from the faction's own mood tier: middle tiers are most persuadable, the extremes least
function getHorseTradeReceptiveness(factionKey, affinity) {
    const f = factions[factionKey];
    const mood = getMoodData(factionKey, affinity);
    let pos = 0.5;
    if (f && Array.isArray(f.moods) && f.moods.length > 1) {
        const idx = Math.max(0, f.moods.indexOf(mood));
        pos = idx / (f.moods.length - 1);
    }
    const maxDist = Math.max(HORSE_TRADE_MOOD_PEAK, 1 - HORSE_TRADE_MOOD_PEAK);
    const d = (pos - HORSE_TRADE_MOOD_PEAK) / maxDist;
    const mult = HORSE_TRADE_MOOD_FLOOR + (1 - HORSE_TRADE_MOOD_FLOOR) * (1 - d * d);
    return { mult, text: mood.text, color: mood.color };
}

// Factions shown in the portrait strip at the start of a campaign
const INITIAL_PORTRAIT_FACTIONS = [
    'pdip', 'golkar_akbar', 'golkar_habibie', 'poros_tengah', 'abri',
    'ppp', 'pkb', 'utusan_daerah',
    'utusan_golongan', 'other_parties'
];

// Escape & " < > and apostrophes so a string is safe in HTML text and attribute values
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Deep copy an object (structuredClone with a JSON fallback)
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        try { return structuredClone(obj); } catch (e) { console.warn(e); }
    }
    return JSON.parse(JSON.stringify(obj));
}

// Leverage tiers, strongest first (names and descriptions live in data/language: leverage.<id>.name / .desc)
const LEVERAGE_TIERS = [
    { id: 'absolute',    min: 80,        color: '#006400', costMult: 0.75, gainMult: 1.50 },
    { id: 'strong',      min: 60,        color: '#009000', costMult: 0.85, gainMult: 1.25 },
    { id: 'moderate',    min: 40,        color: '#B8860B', costMult: 1.00, gainMult: 1.10 },
    { id: 'weak',        min: 20,        color: '#FF4500', costMult: 1.15, gainMult: 0.90 },
    { id: 'nonexistent', min: -Infinity, color: '#8B0000', costMult: 1.30, gainMult: 0.75 }
];

// Compute a faction's leverage over the president from its metrics
function getFactionLeverage(factionKey) {
    const metrics = FACTION_LEVERAGE_METRICS[factionKey];
    if (!metrics) {
        return {
            val: 50,
            text: LOC('leverage.moderate.name'),
            desc: LOC('leverage.default.desc'),
            color: '#B8860B',
            costMult: 1.0,
            gainMult: 1.0
        };
    }

    let sum = 0;
    for (let i = 0; i < metrics.length; i++) {
        sum += (stats[metrics[i]] || 0);
    }
    const avg = Math.round(sum / metrics.length);

    const tier = LEVERAGE_TIERS.find(t => avg >= t.min);
    // Continuous multipliers: 0 metric = 1.30x cost / 0.75x gain, 100 metric = 0.75x cost / 1.50x gain (tiers only drive the label)
    const t01 = Math.max(0, Math.min(100, avg)) / 100;
    return {
        val: avg,
        text: LOC(`leverage.${tier.id}.name`),
        desc: LOC(`leverage.${tier.id}.desc`),
        color: tier.color,
        costMult: Math.round((1.30 - 0.55 * t01) * 1000) / 1000,
        gainMult: Math.round((0.75 + 0.75 * t01) * 1000) / 1000
    };
}

// Display names of the stats used in effect text (text lives in data/language: effect_name.<key>)
const EFFECT_DISPLAY_NAMES = new Proxy({}, {
    get(_t, key) {
        return (typeof key === 'string' && LOC.has('effect_name.' + key)) ? LOC('effect_name.' + key) : undefined;
    },
    has(_t, key) { return typeof key === 'string' && LOC.has('effect_name.' + key); }
});

// Turn a numeric change into a word (Slightly to Greatly)
function getQualitativeMagnitude(absVal) {
    if (absVal <= 3) return LOC('magnitude.slightly');
    if (absVal <= 8) return LOC('magnitude.moderately');
    if (absVal <= 14) return LOC('magnitude.significantly');
    return LOC('magnitude.greatly');
}

// Look up the descriptive tier name for a stat value
function getPlainStatTierName(statKey, val) {
    const statTiers = dashboardStats[statKey];
    if (!statTiers || statTiers.length === 0) return LOC('stat.tier_fallback');
    for (let i = 0; i < statTiers.length; i++) {
        if (val >= statTiers[i].min) return statTiers[i].text;
    }
    return statTiers[statTiers.length - 1].text;
}

// Asks the opposition engine for a faction's secret-ballot defection rate (0 when it is not loaded).
function getFactionDefectionRate(key, effAff) {
    return window.OppositionEngine ? OppositionEngine.getDefectionRate(key, effAff) : 0;
}
// Estimated vote margin over the majority mark (the real vote's model without variance); null before the Assembly convenes
function getWhipMargin() {
    if (!gameStarted) return null;

    const govStability = getGovStability();
    const cendanaSabotage = Math.round((stats.cendana - 50) / 10);
    const stabilityFloorMod = Math.round((govStability - 50) / 10);

    let estVotes = 0;
    let activeTotalSeats = 0;

    for (let i = 0; i < portraitFactions.length; i++) {
        const key = portraitFactions[i];
        const f = factions[key];
        if (!f || f.seats <= 0 || bannedFactions[key]) continue;

        activeTotalSeats += f.seats;
        if (window.OppositionEngine && OppositionEngine.isVoteLocked(key)) continue;
        const favorBonus = (f.favor || 0) * 8;
        const advAdj = window.OppositionEngine ? OppositionEngine.affinityAdjust(key) : 0;
        const effAff = clampFaction(key, f.affinity + favorBonus + stabilityFloorMod - cendanaSabotage + advAdj);

        let baselineTurnout = 0;
        if (key === 'pdip' || key === 'poros_tengah' || key === 'abri') {
            if (effAff >= 80) baselineTurnout = 0.96;
            else if (effAff >= 65) baselineTurnout = 0.72;
            else if (effAff >= 50) baselineTurnout = 0.42;
            else if (effAff >= 35) baselineTurnout = 0.15;
        } else {
            baselineTurnout = effAff / 100;
        }

        const defectionRate = getFactionDefectionRate(key, effAff);
        const actualVoteRate = Math.max(0, baselineTurnout - defectionRate);

        estVotes += f.seats * actualVoteRate;
        if (window.OppositionEngine) estVotes -= OppositionEngine.taintLoss(key, actualVoteRate);
    }

    const majorityMark = Math.floor(activeTotalSeats / 2) + 1;
    return estVotes - majorityMark;
}

// Qualitative Palace Whip Projection for the MPR Dashboard (No Raw Numbers)
function getVagueWhipProjection() {
    const margin = getWhipMargin();
    if (margin === null) return `<font color=\"#555555\">${LOC('whip.not_convened')}</font>`;

    if (margin >= 65) return `<font color=\"#006400\"><b>${LOC('whip.commanding')}</b></font>`;
    if (margin >= 15) return `<font color=\"#009000\"><b>${LOC('whip.leading')}</b></font>`;
    if (margin >= -20) return `<font color=\"#B8860B\"><b>${LOC('whip.too_close')}</b></font>`;
    if (margin >= -85) return `<font color=\"#FF4500\"><b>${LOC('whip.waning')}</b></font>`;
    return `<font color=\"#8B0000\"><b>${LOC('whip.very_unpopular')}</b></font>`;
}

// Small arrow showing which way the whip projection moved since the last refresh
function getWhipTrendHTML() {
    const m = getWhipMargin();
    let html = '';
    if (m !== null && typeof window.lastWhipMargin === 'number') {
        const d = m - window.lastWhipMargin;
        if (d >= 0.5) html = ' <span title="' + escapeHtml(LOC('whip.trend_up')) + '" style="color:#006400;">&#9650;</span>';
        else if (d <= -0.5) html = ' <span title="' + escapeHtml(LOC('whip.trend_down')) + '" style="color:#8B0000;">&#9660;</span>';
    }
    window.lastWhipMargin = m;
    return html;
}

// Core campaign state: current turn, turn limit, phase flag, game-started flag, global malus, loaded data tables, difficulty, option-effect display and music switch.
let currentTurn = 1;
let MAX_TURNS = 20;
let isActionPhase = false;
let gameStarted = false;
let globalMalus = 0;
let libraryData = [];
let tutorialPages = [];
let creditsData = {};
let gameConfig = {};
let selectedDifficulty = 'historical';
let showOptionEffects = false;
let musicEnabled = true;
// Give an object text properties that are looked up in the language files when read (so they follow the language)
function localizedFields(obj, idPrefix, fields) {
    fields.forEach(f => Object.defineProperty(obj, f, {
        enumerable: true,
        configurable: true,
        get() { return LOC(`${idPrefix}.${f}`); }
    }));
    return obj;
}

// Appearance = three independent settings: window style, color scheme, CRT scanlines
// (display names live in data/language: window_style.<id>.label and color_scheme.<id>.label)
const WINDOW_STYLES = {
    default: localizedFields({ css: null }, 'window_style.default', ['label']),
    win98:   localizedFields({ css: 'css/windows98/styles.css' }, 'window_style.win98', ['label']),
    macos8:  localizedFields({ css: 'css/macos8/styles.css' }, 'window_style.macos8', ['label'])
};
// Available color schemes: [swatch, group]
const COLOR_SCHEME_DEFS = {
    standard: ['#000080', 'light'],
    cherry: ['#F29BB8', 'light'],
    exusiai: ['#A3171F', 'light'],
    mint: ['#6CC3A0', 'light'],
    sky: ['#6FB1E6', 'light'],
    peach: ['#F2A36B', 'light'],
    brick: ['#7A1F1F', 'light'],
    desert: ['#5E5A2B', 'light'],
    lilac: ['#4B3A7A', 'light'],
    marine: ['#003B5C', 'light'],
    rose: ['#7A2646', 'light'],
    slate: ['#2F3E5C', 'light'],
    spruce: ['#1F4D2B', 'light'],
    wheat: ['#6B4A12', 'light'],
    merahputih: ['#A80F1B', 'light'],
    rainbow: ['linear-gradient(135deg, #D7263D, #E8710A, #E8C400, #2E9E4F, #1F7AD1, #4B3FC4, #9B3FC8)', 'light'],
    rainbowswirl: ['conic-gradient(#D7263D, #E8710A, #E8C400, #2E9E4F, #1F7AD1, #4B3FC4, #9B3FC8, #D7263D)', 'light'],
    dark: ['#2B2B2B', 'dark'],
    midnight: ['#0B1E5B', 'dark'],
    obsidian: ['#3A3A52', 'dark'],
    nord: ['#5E81AC', 'dark'],
    amethyst: ['#8A5FD6', 'dark'],
    forest: ['#3E9A66', 'dark'],
    darkcherry: ['#C0507A', 'dark'],
    exusiainight: ['#D17A2A', 'dark'],
    amber: ['#B87800', 'dark'],
    greenterm: ['#1F9940', 'dark'],
    twilight: ['#D9702E', 'dark'],
    solarized: ['#268BD2', 'dark'],
    kopi: ['#9C6B4A', 'dark'],
    contrast: ['#FFFF00', 'dark']
};
const COLOR_SCHEMES = {};
Object.keys(COLOR_SCHEME_DEFS).forEach(id => {
    COLOR_SCHEMES[id] = localizedFields(
        { swatch: COLOR_SCHEME_DEFS[id][0], group: COLOR_SCHEME_DEFS[id][1] }, `color_scheme.${id}`, ['label']);
});
// Current appearance selections
let windowStyle = 'default';
let colorScheme = 'standard';
let crtEnabled = false;
let crtIntensity = 30;

// Effects: independent switches (Settings > Effects). 'crt' is crtEnabled; the rest live in effectsOn.
// (labels and descriptions live in data/language: fx.<id>.label and fx.<id>.desc)
const EFFECTS = ['crt', 'glow', 'flicker', 'curve', 'aberration'].map(id =>
    localizedFields({ id: id }, `fx.${id}`, ['label', 'desc']));
// Current on/off state of each effect
let effectsOn = { glow: false, flicker: false, curve: false, aberration: false };
let textScale = 110;
let currentLang = 'en';
let updatesData = null;

// Turn & Action Economy Tracking
let actionCooldowns = {};
let actionUsageCount = {};
let factionCooldowns = {};
let factionUsageCount = {};
let turnExecutiveUsed = false;
let turnFactionUsed = false;
// Faction engagements held this turn. Before the Accountability Speech they are unlimited but each one raises the cost of the next.
let turnFactionCount = 0;
let prevStatsSnapshot = null;
let lastRenderedPortraitSignature = "";

// Decree Locks, Banned Factions, Limits & JSON Data
let activeDecrees = {};
let bannedFactions = {};
let completedInteractions = {};
let minStats = { pop: 0, mil: 0, ref: 0, econ: 0, intl: 0, stab: 0 };
let maxCendana = 100;
let minFactions = {};
let actionsData = { routine: [], decrees: [] };

// Base stats & Faction snapshots
let stats = { PC: 0, pop: 30, mil: 35, ref: 40, econ: 20, intl: 30, stab: 25, cendana: 75 };
let factions = {};
let initialFactionsSnapshot = {};
let events = [];
let musicTracks = [];
let dashboardStats = {};
let portraitFactions = [...INITIAL_PORTRAIT_FACTIONS];

// Tally Speed, Military Lock & Mobile Touch State
window.tallySpeed = 1;
window.activeTallyInterval = null;
window.mobileSelectedParliamentFaction = null;
window.lastElectionSummary = null;

// Cendana influence at the end of the previous turn (starts at 95; kept in sync by the opposition engine).
window.lastTurnCendana = 95;

// GOVERNMENT STABILITY WORDING (desktop panel + mobile status bar); words live in data/language: gov.<id>
const GOV_TIERS = [
    { id: 'secure',     min: 80,        color: '#006400' },
    { id: 'stable',     min: 60,        color: '#009000' },
    { id: 'precarious', min: 40,        color: '#B8860B' },
    { id: 'unstable',   min: 20,        color: '#FF4500' },
    { id: 'collapsing', min: -Infinity, color: '#8B0000' }
];

// The tier ({ id, color }) of the current Government Stability
function getGovStabilityTier() {
    const g = getGovStability();
    return GOV_TIERS.find(t => g >= t.min);
}

// Word describing the current Government Stability
function getGovStabilityWord() {
    return LOC('gov.' + getGovStabilityTier().id);
}

// Displayed word -> color (mobile.js looks colors up by the word it shows, so this follows the language)
const GOV_WORD_COLORS = new Proxy({}, {
    get(_t, word) {
        const t = GOV_TIERS.find(tier => LOC('gov.' + tier.id) === word);
        return t ? t.color : undefined;
    }
});

// MENU NAVIGATION: one place decides where "Back" goes
window.electionPanelSnapshot = null;

// Call at the top of every full-panel menu; returns false when the menu must not open (vote tally running)
window.enterMenuView = function() {
    if (window.activeTallyInterval) {
        showCustomAlert(LOC('menu.roll_call_in_progress'), null);
        return false;
    }
    const mainPanel = document.getElementById('main-panel');
    if (gameStarted && mainPanel && mainPanel.querySelector('#election-result-container')) {
        window.electionPanelSnapshot = mainPanel.innerHTML;
    }
    return true;
};

// Go back to the view the current menu was opened from
window.returnToPreviousView = function() {
    if (!gameStarted) { showStartMenu(); return; }
    if (currentTurn > events.length) {
        const mainPanel = document.getElementById('main-panel');
        if (window.electionPanelSnapshot && mainPanel) {
            mainPanel.innerHTML = window.electionPanelSnapshot;
            scrollMainPanelToTop();
        } else {
            returnToTitleScreen();
        }
        return;
    }
    if (isActionPhase) showActionMenu(); else renderEventMenu();
};

// Show or hide the side panels to match the game state
function syncSidebarVisibility() {
    const leftPanel = document.getElementById('left-panel');
    const mainPanel = document.getElementById('main-panel');
    const mprDashboard = document.getElementById('mpr-dashboard');
    if (!leftPanel || !mainPanel || !mprDashboard) return;

    if (gameStarted) {
        leftPanel.style.display = '';
        mainPanel.style.width = '';
        mprDashboard.style.display = '';
    } else {
        leftPanel.style.display = 'none';
        mainPanel.style.width = '100%';
        mprDashboard.style.display = 'none';
    }
}

// Return to the main menu after an election without reloading the page
window.returnToTitleScreen = function() {
    clearTallyInterval();
    if (Object.keys(initialFactionsSnapshot).length > 0) {
        factions = deepClone(initialFactionsSnapshot);
    }
    portraitFactions = [...INITIAL_PORTRAIT_FACTIONS];
    bannedFactions = {};
    gameStarted = false;
    prevStatsSnapshot = null;
    lastRenderedPortraitSignature = "";
    window.lastElectionSummary = null;
    window.electionPanelSnapshot = null;
    window.epilogueActive = false;

    syncSidebarVisibility();
    updateUI();
    showStartMenu();
};

// Built-in config used when config.json fails to load
const fallbackConfig = {
    systemModifiers: {
        lowStatThreshold: 40, highStatThreshold: 60,
        malusMultiplier: 0.45, malusDecayNormal: 0.5, malusDecayHigh: 1.5, maxGlobalMalus: 10.0,
        bonusMultiplier: 0.3, maxBonusDrift: 2.0,
        loyalistDrainMitigation: 0.35, routineRepeatDecay: 0.15,
        routineEffectDecay: 0.06, routineEffectFloor: 0.6,
        factionRepeatDecay: 0.2, factionRepeatFloor: 0.5,
        factionEngageSurcharge: 5,
        maxStatFloor: 90, maxFactionFloor: 85,
        floorEnactGrant: 5, factionFloorEnactGrant: 8,
        floorRampStat: 4, floorRampFaction: 5
    },
    difficultySettings: {
        easy: { name: "difficulty.easy.name", pc: 75, statMod: 15, cendana: 40, malusCap: 0.0, actionCostMod: -3, costPct: -10, decreeCostPct: -10, passivePCMod: 2, eventNegMult: 0.75, eventPosMult: 1.1, gainMult: 1.15, maxFavor: 4, factionDrift: 0, cendanaRegen: 0, cooldownBonus: 0, description: "difficulty.easy.desc" },
        medium: { name: "difficulty.medium.name", pc: 50, statMod: 5, cendana: 60, malusCap: 0.35, actionCostMod: 0, costPct: 0, decreeCostPct: 0, passivePCMod: 1, eventNegMult: 1, eventPosMult: 1.08, gainMult: 1.15, maxFavor: 3, factionDrift: 0.1, cendanaRegen: 0, cooldownBonus: 0, description: "difficulty.medium.desc" },
        high: { name: "difficulty.high.name", pc: 35, statMod: 0, cendana: 75, malusCap: 0.75, actionCostMod: 0, costPct: 5, decreeCostPct: 3, passivePCMod: 0, eventNegMult: 1.05, eventPosMult: 1, gainMult: 1, maxFavor: 3, factionDrift: 0.15, cendanaRegen: 0.25, cooldownBonus: 0, description: "difficulty.high.desc" },
        ucn: { name: "Ultimate Custom Night", description: "", pc: 20, statMod: -1, cendana: 95, malusCap: 3.25, actionCostMod: 2, costPct: 15, decreeCostPct: 8, passivePCMod: 0, eventNegMult: 1.1, eventPosMult: 0.95, gainMult: 0.95, maxFavor: 2, factionDrift: 0.4, cendanaRegen: 1, cooldownBonus: 1 },
        historical: { name: "difficulty.historical.name", pc: 20, statMod: -1, cendana: 95, malusCap: 3.25, actionCostMod: 2, costPct: 15, decreeCostPct: 8, passivePCMod: 0, eventNegMult: 1.1, eventPosMult: 0.95, gainMult: 0.95, maxFavor: 2, factionDrift: 0.4, cendanaRegen: 1, cooldownBonus: 1, description: "difficulty.historical.desc" }
    }
};

// Fetches a JSON file and returns the fallback value if it is missing or invalid.
async function fetchJSONSafe(url, fallbackVal = null) {
    try {
        const res = await fetch(url);
        if (!res.ok) return fallbackVal;
        return await res.json();
    } catch (e) {
        console.log(`${url} missing or invalid, using fallback.`);
        return fallbackVal;
    }
}

// Fetch a localized data file. Tries data/language/<current language>/<url>, then the default language's folder,
// then the legacy flat location data/<url>, so files can be moved into the language folders one at a time.
// Returns fallbackVal if none of them exist.
async function fetchLocalizedJSON(url, fallbackVal = null) {
    const candidates = [LOC.root + LOC.folder(currentLang) + '/' + url];
    const defaultPath = LOC.root + LOC.defaultFolder() + '/' + url;
    if (candidates.indexOf(defaultPath) === -1) candidates.push(defaultPath);
    candidates.push('data/' + url);

    for (const path of candidates) {
        try {
            const res = await fetch(path);
            if (res.ok) {
                const data = await res.json();
                // Fall back to default language if a localized JSON file is an empty stub array
                if (Array.isArray(data) && data.length === 0 && path !== candidates[candidates.length - 1]) continue;
                return data;
            }
        } catch (e) {
        }
    }
    console.log(`${url} missing or invalid, using fallback.`);
    return fallbackVal;
}

// Persistent cache so the browser never garbage-collects decoded images mid-campaign
window.__preloadedImages = window.__preloadedImages || [];

// Recursively scans loaded JSON data (including inline HTML <img> tags) for image URLs
function collectAllGameImageUrls(rootObj, urlSet) {
    if (!rootObj) return;
    if (typeof rootObj === 'string') {
        const trimmed = rootObj.trim();
        if (/^[^<>]+\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(trimmed)) {
            urlSet.add(trimmed);
        }
        const imgTagRegex = /src=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))["']/gi;
        let match;
        while ((match = imgTagRegex.exec(trimmed)) !== null) {
            urlSet.add(match[1]);
        }
        return;
    }
    if (Array.isArray(rootObj)) {
        for (let i = 0; i < rootObj.length; i++) {
            collectAllGameImageUrls(rootObj[i], urlSet);
        }
        return;
    }
    if (typeof rootObj === 'object') {
        for (const key in rootObj) {
            if (Object.prototype.hasOwnProperty.call(rootObj, key)) {
                collectAllGameImageUrls(rootObj[key], urlSet);
            }
        }
    }
}

// Preloads and decodes a single image into persistent memory; resolves even on 404
function preloadSingleImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve(img);
        };

        img.onload = () => {
            if (typeof img.decode === 'function') {
                img.decode().then(finish).catch(finish);
            } else {
                finish();
            }
        };
        img.onerror = finish;
        img.src = src;
        window.__preloadedImages.push(img);
    });
}

// Load all localized JSON data with an English fallback
// DATA TEXT: data files (events, decrees, routine actions, ...) keep a language key wherever there is text, e.g.
//   "title": "event.ev_post_election.title"
// and the text itself lives in data/language/<language>/*_text.json. These helpers swap every key for the text in the
// current language when the data is loaded, so the rest of the game only ever sees plain text. Plain text left in a
// data file keeps working (LOC.r leaves anything that is not a key alone).
function resolveTextFields(obj, fields) {
    if (obj) fields.forEach(f => { if (typeof obj[f] === 'string') obj[f] = LOC.r(obj[f]); });
    return obj;
}

// Resolves language keys inside every event of a list into display text.
function resolveEventText(list) {
    list.forEach(ev => {
        resolveTextFields(ev, ['date', 'title', 'desc']);
        (ev.options || []).forEach(opt => resolveTextFields(opt, ['text', 'reaction']));
    });
    return list;
}

// Resolves language keys inside every decree of a list into display text.
function resolveDecreeText(list) {
    list.forEach(dec => resolveTextFields(dec, ['text', 'description', 'alertMsg']));
    return list;
}

// Resolves language keys inside every routine action of a list into display text.
function resolveRoutineText(list) {
    list.forEach(act => {
        resolveTextFields(act, ['text', 'short_name', 'description', 'alertMsg']);
        (act.conditionalEffects || []).forEach(c => resolveTextFields(c, ['alertMsg']));
        resolveTextFields(act.alertMsgs, ['success', 'failure']);
    });
    return list;
}

// Resolves language keys and inline $key$ references in one faction (stance names, summary, biography, interactions).
function resolveFactionText(fac) {
    if (!fac) return fac;
    resolveTextFields(fac, ['summary', 'biography']);
    (fac.moods || []).forEach(m => resolveTextFields(m, ['text']));
    (fac.interactions || []).forEach(i => resolveTextFields(i, ['text', 'description', 'alertMsg']));
    return fac;
}

// Loads the current language and every localized data file in parallel (events, decrees, routines, factions, library, stats, config), reporting progress, and populates the game data tables.
async function loadLocalizedAssets(onStepProgress) {
    if (LOC.lang() !== currentLang) await LOC.load(currentLang);
    const step = (typeof onStepProgress === 'function') ? onStepProgress : () => {};
    const trackedFetch = (url, fallback) => fetchLocalizedJSON(url, fallback).then(res => {
        step();
        return res;
    });

    const [
        cfgData, achvData, evData, routData, decData,
        tutData, libData, persData, presData, stData, credData, updData,
        ...factionResults
    ] = await Promise.all([
        trackedFetch('config.json', fallbackConfig),
        trackedFetch('achievements.json', []),
        trackedFetch('events.json', []),
        trackedFetch('actionphase/routine.json', []),
        trackedFetch('actionphase/decrees.json', []),
        trackedFetch('texts/tutorial.json', []),
        trackedFetch('texts/library.json', []),
        trackedFetch('texts/persons.json', []),
        trackedFetch('texts/presidents.json', []),
        trackedFetch('stats.json', {}),
        trackedFetch('texts/credits.json', {}),
        trackedFetch('updates.json', null),
        ...INITIAL_PORTRAIT_FACTIONS.map(key => trackedFetch(`factions/${key}.json`, null))
    ]);

    gameConfig = cfgData || fallbackConfig;
    gameConfig.systemModifiers = Object.assign({}, fallbackConfig.systemModifiers, gameConfig.systemModifiers || {});
    ACHIEVEMENTS = achvData || [];
    if (window.SSS) SSS.ensureDef();

    const formatFactionNames = (obj) => {
        if (!obj || !obj.name) return;
        const clean = obj.name.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
        obj.portraitName = /<br\s*\/?>/i.test(obj.name)
            ? obj.name
            : clean.replace(/\s+\(/, '<br>(');
        obj.name = clean;
    };

    const loadedFactions = {};
    INITIAL_PORTRAIT_FACTIONS.forEach((key, idx) => {
        if (factionResults[idx]) {
            const fac = factionResults[idx];
            formatFactionNames(fac);
            if (fac.transformed) formatFactionNames(fac.transformed);
            resolveFactionText(fac);
            if (fac.transformed) resolveFactionText(fac.transformed);
            loadedFactions[key] = fac;
        }
    });

    const prevShuffled = events.map(e => e && e.shuffledIndices);
    events = resolveEventText(evData || []);
    events.forEach((ev, idx) => {
        if (prevShuffled[idx] && prevShuffled[idx].length === (ev.options || []).length) {
            ev.shuffledIndices = prevShuffled[idx];
        }
    });
    MAX_TURNS = events.length + 1;
    const maxTurnEl = document.getElementById('max-turn-display');
    if (maxTurnEl) maxTurnEl.innerText = events.length;

    const totalEventTurns = events.length;
    // The final turn is the closing ceremony and has no action phase, so Final Appeals are open from the Accountability Speech up to the turn before it.
    const lastActionTurn = Math.max(1, totalEventTurns - 1);
    const speechTurn = Math.max(1, events.findIndex(e => e.id === 'ev_the_speech') + 1 || lastActionTurn - 1);
    const axisTurnIdx = Math.max(1, events.findIndex(e => e.id === 'ev_central_axis') + 1);

    const fitInteractions = (list, mergedBloc) => {
        list.forEach(inter => {
            if (String(inter.id || '').includes('final')) {
                inter.minTurn = speechTurn;
                inter.maxTurn = lastActionTurn;
            } else if (mergedBloc) {
                inter.minTurn = axisTurnIdx;
                inter.maxTurn = lastActionTurn;
            } else if (inter.maxTurn && inter.maxTurn >= 17) {
                inter.maxTurn = lastActionTurn;
            }
            if (inter.minTurn && inter.minTurn > lastActionTurn) inter.minTurn = Math.max(1, lastActionTurn - 2);
        });
    };
    for (const fk in loadedFactions) {
        const fac = loadedFactions[fk];
        if (fac && Array.isArray(fac.interactions)) fitInteractions(fac.interactions, false);
        if (fac && fac.transformed && Array.isArray(fac.transformed.interactions)) fitInteractions(fac.transformed.interactions, true);
    }

    initialFactionsSnapshot = deepClone(loadedFactions);
    if (!gameStarted) {
        factions = deepClone(loadedFactions);
    } else {
        // Update localized text fields in-place when switching language mid-game without resetting campaign state
        for (const key in loadedFactions) {
            const live = factions[key];
            const fresh = loadedFactions[key];
            if (!live || !fresh) continue;
            const src = (live.hasMerged && fresh.transformed) ? fresh.transformed : fresh;
            live.name = src.name;
            live.portraitName = src.portraitName || src.name;
            if (fresh.short) live.short = fresh.short;
            live.summary = src.summary;
            live.biography = src.biography;
            live.moods = src.moods;
            live.interactions = src.interactions;
            if (fresh.transformed) live.transformed = fresh.transformed;
        }
    }

    actionsData = {
        routine: resolveRoutineText(routData || []),
        decrees: resolveDecreeText(decData || [])
    };
    tutorialPages = tutData || [];
    libraryData = [...(libData || []), ...(persData || []), ...(presData || [])];
    dashboardStats = stData || {};
    Object.keys(dashboardStats).forEach(k => (dashboardStats[k] || []).forEach(t => resolveTextFields(t, ['text'])));
    creditsData = credData || {};
    updatesData = updData || null;
    lastRenderedPortraitSignature = "";
}

// Preload and decode every referenced image behind the loading screen
async function preloadAllAssetsWithWin95Modal(titleOverride) {
    const overlay = document.getElementById('win95-loader-overlay');
    const titleEl = document.getElementById('win95-loader-title');
    const flavorEl = document.getElementById('win95-loader-flavor');
    const pctEl = document.getElementById('win95-loader-pct');
    const barEl = document.getElementById('win95-loader-bar-fill');
    const fileEl = document.getElementById('win95-loader-file');

    if (titleEl) titleEl.innerText = titleOverride || LOC('loader.default_title');
    if (pctEl) pctEl.innerText = '0%';
    if (barEl) barEl.style.width = '0%';
    if (fileEl) fileEl.innerText = LOC('loader.loading');
    if (overlay) overlay.style.display = 'flex';

    const loadingMeta = await fetchLocalizedJSON('loading.json', null);
    const messages = (loadingMeta && loadingMeta.messages && loadingMeta.messages[currentLang])
        || (loadingMeta && loadingMeta.messages && loadingMeta.messages.en)
        || [LOC('loader.loading')];
    const fakeFiles = (loadingMeta && Array.isArray(loadingMeta.files) && loadingMeta.files.length > 0)
        ? loadingMeta.files
        : [LOC('loader.loading')];

    let fileTick = 0;
    const updateModalUI = (fraction) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        const pct = Math.round(clamped * 100);
        if (pctEl) pctEl.innerText = pct + '%';
        if (barEl) barEl.style.width = pct + '%';

        const msgIdx = Math.min(messages.length - 1, Math.floor(clamped * messages.length));
        if (flavorEl && messages[msgIdx]) flavorEl.innerText = messages[msgIdx];

        const fIdx = Math.min(
            fakeFiles.length - 1,
            Math.max(Math.floor(clamped * fakeFiles.length), fileTick % fakeFiles.length)
        );
        fileTick++;
        if (fileEl && fakeFiles[fIdx]) fileEl.innerText = fakeFiles[fIdx];
    };

    const totalJsonCount = 12 + INITIAL_PORTRAIT_FACTIONS.length + 1;
    let loadedJsonCount = 0;
    const onJsonStep = () => {
        loadedJsonCount++;
        updateModalUI((loadedJsonCount / totalJsonCount) * 0.25);
    };

    const [, musData] = await Promise.all([
        loadLocalizedAssets(onJsonStep),
        fetchJSONSafe('audio/music.json', []).then(res => { onJsonStep(); return res; })
    ]);
    musicTracks = musData || [];

    const imageUrlSet = new Set([
        'photo/icon.png',
        'photo/habibi.png',
        'photo/mpr.png',
        'photo/pancasila.png',
        'photo/title_banner.png',
        'photo/routine.png',
        'photo/decree.png',
        'photo/victory.png',
        'photo/defeat.png',
        'photo/icons/book.png',
        'photo/icons/trophy.png',
        'photo/icons/settings.png',
        'photo/icons/info.png'
    ]);

    collectAllGameImageUrls(gameConfig, imageUrlSet);
    collectAllGameImageUrls(events, imageUrlSet);
    collectAllGameImageUrls(actionsData, imageUrlSet);
    collectAllGameImageUrls(tutorialPages, imageUrlSet);
    collectAllGameImageUrls(libraryData, imageUrlSet);
    collectAllGameImageUrls(factions, imageUrlSet);
    collectAllGameImageUrls(updatesData, imageUrlSet);
    collectAllGameImageUrls(musicTracks, imageUrlSet);
;

    const allImages = Array.from(imageUrlSet).filter(Boolean);
    const totalImages = allImages.length;

    if (totalImages > 0) {
        let loadedImages = 0;
        await Promise.all(allImages.map(src =>
            preloadSingleImage(src).then(() => {
                loadedImages++;
                updateModalUI(0.25 + (loadedImages / totalImages) * 0.75);
            })
        ));
    } else {
        updateModalUI(1);
    }

    updateModalUI(1);
    await new Promise(r => setTimeout(r, 180));
    if (overlay) overlay.style.display = 'none';
}

// Start the game: load assets and settings, then show the start menu
async function initGame() {
    try {
        loadUserSettings();
        currentLang = await LOC.load(currentLang);
        setupMobileLeftPanelToggle();
        wireMusicStateEvents();

        await preloadAllAssetsWithWin95Modal();

        if (musicTracks.length > 0) setupMusicPlayer();

        updateUI();
        showStartMenu();
    } catch (error) {
        console.error("Failed to load game assets:", error);
        const overlay = document.getElementById('win95-loader-overlay');
        if (overlay) overlay.style.display = 'none';
        document.getElementById('main-panel').innerHTML =
            `<h3>${LOC('error.fatal_title')}</h3>
             <p style="font-family: MS Sans Serif, sans-serif; font-size: 12px; color: red;">
             ${LOC('error.fatal_body')}
             </p>`;
    }
}

// Run initGame when the page loads
window.addEventListener('load', initGame);

// Clamps Political Capital to the 0-100 range.
function clampPC(val) {
    return Math.max(0, Math.min(100, Math.round(val)));
}

// Clamp a dashboard stat to its allowed range
function clampDashboard(key, val) {
    const rounded = Math.round(val);
    if (key === 'cendana') return Math.max(0, Math.min(maxCendana, rounded));
    const min = minStats[key] || 0;
    return Math.max(min, Math.min(100, rounded));
}

// Clamp a faction affinity to its allowed range
function clampFaction(key, val) {
    const min = minFactions[key] || 0;
    return Math.max(min, Math.min(100, Math.round(val * 10) / 10));
}

// Government Stability: average of all national metrics with Cendana inverted
function getGovStability() {
    return Math.round((stats.pop + stats.mil + stats.ref + stats.econ + stats.intl + stats.stab + (100 - stats.cendana)) / 7);
}

// Extra action cost caused by low or high National Stability
function getStabilityCostModifier() {
    if (stats.stab < 40) {
        return Math.ceil((40 - stats.stab) / 6);
    }
    if (stats.stab >= 75) {
        return -2;
    }
    return 0;
}

// Current difficulty definition and numeric lookups (difficulty value or default; system modifier or default)
function getDiffDef() {
    return (gameConfig.difficultySettings && gameConfig.difficultySettings[selectedDifficulty]) || {};
}
function diffNum(key, dflt) {
    const v = getDiffDef()[key];
    return (typeof v === 'number' && !isNaN(v)) ? v : dflt;
}
function sysMod(key, dflt) {
    const v = gameConfig.systemModifiers ? gameConfig.systemModifiers[key] : undefined;
    return (typeof v === 'number' && !isNaN(v)) ? v : dflt;
}

// Tells whether a numeric change is good for the player (Cendana is the one stat where up is bad)
function isGoodDelta(key, v) {
    return (key === 'cendana') ? (v < 0) : (v > 0);
}

// Scales an already-rolled effects object: good changes by goodMult, bad ones by badMult (favor keys untouched, never shrinks a change below 1)
function scaleEffects(eff, goodMult, badMult) {
    if (!eff) return eff;
    const out = {};
    for (const key in eff) {
        const v = eff[key];
        if (typeof v !== 'number' || v === 0 || key.endsWith('_favor')) { out[key] = v; continue; }
        const m = isGoodDelta(key, v) ? goodMult : badMult;
        out[key] = (m === 1) ? v : Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * m));
    }
    return out;
}

// Final PC cost of a decree after difficulty and stability modifiers
function computeDecreeCost(baseCost) {
    const diffFlat = diffNum('actionCostMod', 0);
    const pct = 1 + diffNum('decreeCostPct', 0) / 100;
    const stabMod = getStabilityCostModifier();
    return Math.max(5, Math.round(baseCost * pct + diffFlat + stabMod));
}

// Final PC cost of a faction action, including leverage
function computeFactionActionCost(factionKey, baseCost) {
    const surcharge = getFactionSurcharge();
    if (baseCost <= 0) return surcharge;
    const diffFlat = diffNum('actionCostMod', 0);
    const pct = 1 + diffNum('costPct', 0) / 100;
    const stabMod = getStabilityCostModifier();
    const leverage = getFactionLeverage(factionKey);
    const streetMult = (factionKey === 'pdip' && window.OppositionEngine) ? OppositionEngine.getPdipCostMult() : 1;
    return Math.max(3, Math.round((baseCost * pct * leverage.costMult + diffFlat + stabMod) * streetMult)) + surcharge;
}

// Builds the readable effect text (with colours) for an effects object, merging military and ABRI changes.
function formatEffectString(effects) {
    if (!effects) return "";
    const parts = [];
    const skipKeys = {};

    const hasBothMilAndAbri = (effects.mil !== undefined && effects.abri !== undefined);

    for (const statKey in effects) {
        if (skipKeys[statKey]) continue;

        if (statKey.endsWith('_favor')) {
            const facKey = statKey.replace('_favor', '');
            const facName = (factions[facKey] && factions[facKey].short) ? factions[facKey].short : (EFFECT_DISPLAY_NAMES[facKey] || facKey);
            parts.push(`<span style="color: #0000FF;">${LOC('outcome.grants_favor', { FACTION: facName })}</span>`);
            continue;
        }

        const rawVal = effects[statKey];
        let numVal = 0;

        if (Array.isArray(rawVal) && rawVal.length === 2) {
            numVal = (Number(rawVal[0]) + Number(rawVal[1])) / 2;
        } else if (typeof rawVal === 'string' && rawVal.includes('..')) {
            const nums = rawVal.split(/\.+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
            if (nums.length === 2) numVal = (nums[0] + nums[1]) / 2;
        } else if (typeof rawVal === 'number') {
            numVal = rawVal;
        }

        if (numVal === 0) continue;

        let label = EFFECT_DISPLAY_NAMES[statKey] || statKey;
        if (hasBothMilAndAbri && (statKey === 'mil' || statKey === 'abri')) {
            label = LOC('effect_name.mil_abri');
            skipKeys['mil'] = true;
            skipKeys['abri'] = true;
        }

        const adverb = getQualitativeMagnitude(Math.abs(numVal));
        const verb = LOC(numVal > 0 ? 'outcome.verb.increases' : 'outcome.verb.reduces');

        const isGood = (statKey === 'cendana') ? (numVal < 0) : (numVal > 0);
        const color = isGood ? "#006400" : "#8B0000";

        parts.push(`<span style="color: ${color};">${LOC('outcome.change', { ADVERB: adverb, VERB: verb, LABEL: label })}</span>`);
    }

    if (parts.length === 0) return "";
    return `<br><span style="font-size: 10px; font-family: MS Sans Serif; font-weight: normal;">[ ${parts.join(" &bull; ")} ]</span>`;
}

// Returns a coloured, vague description of a stat (tier text, no numbers) for the given value.
function getVagueStatText(statKey, val) {
    const statTiers = dashboardStats[statKey];
    let baseHTML = `<font color="#8B0000">${LOC('stat.unknown')}</font>`;
    if (statTiers) {
        for (let i = 0; i < statTiers.length; i++) {
            if (val >= statTiers[i].min) {
                baseHTML = `<font color="${statTiers[i].color}">${statTiers[i].text}</font>`;
                break;
            }
        }
    }

    if (gameStarted && prevStatsSnapshot && prevStatsSnapshot[statKey] !== undefined) {
        const diff = val - prevStatsSnapshot[statKey];
        if (Math.abs(diff) >= 1) {
            const isUp = diff > 0;
            const isGood = (statKey === 'cendana') ? !isUp : isUp;
            const arrowColor = isGood ? "#006400" : "#8B0000";
            const arrowChar = isUp ? "&#9650;" : "&#9660;";
            baseHTML += ` <span style="font-size: 9px; color: ${arrowColor};" title="${escapeHtml(LOC('stat.recent_shift'))}">${arrowChar}</span>`;
        }
    }
    return baseHTML;
}

// Mood tier (text, color, overlay) for a faction's affinity
function getMoodData(factionKey, aff) {
    const f = factions[factionKey];
    if (!f || !f.moods || f.moods.length === 0) {
        return { overlay: "rgba(139, 0, 0, 0.25)", text: LOC('stat.unknown'), color: "#8B0000" };
    }
    for (let i = 0; i < f.moods.length; i++) {
        if (aff >= f.moods[i].min) return f.moods[i];
    }
    return f.moods[f.moods.length - 1];
}

// Which tab of the MPR dashboard is open.
let mprDashboardTab = 'factions';

// Historical party swatch color for each faction
const FACTION_HISTORICAL_COLORS = {
    'pdip':            { fill: '#C0392B', border: '#FF7777' },
    'utusan_golongan': { fill: '#7F8C8D', border: '#BDC3C7' },
    'pkb':             { fill: '#006400', border: '#55CC55' },
    'poros_tengah':    { fill: '#0055A4', border: '#66B2FF' },
    'ppp':             { fill: '#2E8B57', border: '#77DDAA' },
    'other_parties':   { fill: '#00838F', border: '#66E0EB' },
    'utusan_daerah':   { fill: '#6E6E6E', border: '#B0B0B0' },
    'golkar_habibie':  { fill: '#D49B00', border: '#FFE066' },
    'golkar_akbar':    { fill: '#F1C40F', border: '#FFFF99' },
    'abri':            { fill: '#556B2F', border: '#A3C266' }
};

// Party short labels follow the language (data/language: faction_label.<id>)
Object.keys(FACTION_HISTORICAL_COLORS).forEach(k => localizedFields(FACTION_HISTORICAL_COLORS[k], 'faction_label.' + k, []) &&
    Object.defineProperty(FACTION_HISTORICAL_COLORS[k], 'label', {
        enumerable: true, configurable: true, get() { return LOC('faction_label.' + k); }
    }));

// Order in which factions are seated in the hemicycle
const PARLIAMENT_SEATING_ORDER = [
    'pdip', 'poros_tengah', 'pkb', 'ppp', 'golkar_habibie', 'golkar_akbar',
    'other_parties', 'utusan_daerah', 'utusan_golongan', 'abri'
];

// Switch between the MPR dashboard tabs
window.switchMPRTab = function(tabName) {
    if (mprDashboardTab === tabName) return;
    mprDashboardTab = tabName;
    window.mobileSelectedParliamentFaction = null;
    lastRenderedPortraitSignature = "";
    updateUI();
};

let parliamentHoverClearTimer = null;
let currentHoveredParliamentFaction = null;

// Highlight one faction's seats in the hemicycle
window.highlightParliamentFaction = function(factionKey, isMobileTap = false) {
    if (parliamentHoverClearTimer) {
        clearTimeout(parliamentHoverClearTimer);
        parliamentHoverClearTimer = null;
    }
    if (!isMobileTap && currentHoveredParliamentFaction === factionKey) return;
    currentHoveredParliamentFaction = factionKey;

    const f = factions[factionKey];
    if (!f) return;
    const mood = getMoodData(factionKey, f.affinity);
    const infoBar = document.getElementById('mpr-parliament-hover-info');
    if (infoBar) {
        const moodHTML = `<font color="${mood.color}"><b>${mood.text}</b></font>`;
        if (isMobileTap) {
            const negotiateBtn = `<button style="width: auto; display: inline-block; --py: 2px; --px: 8px; margin: 0; font-size: 11px; " onclick="openFactionMenu('${factionKey}')">${LOC('parliament.negotiate')}</button>`;
            infoBar.innerHTML = LOC('parliament.info_mobile', { NAME: f.name, SEATS: f.seats, MOOD: moodHTML, BUTTON: negotiateBtn });
        } else {
            infoBar.innerHTML = LOC('parliament.info_desktop', { NAME: f.name, SEATS: f.seats, MOOD: moodHTML });
        }
    }
    const container = document.getElementById('mpr-dashboard-hemicycle');
    if (!container) return;
    const dots = container.querySelectorAll('.mpr-seat-dot');
    dots.forEach(d => {
        if (d.getAttribute('data-faction') === factionKey) {
            d.classList.add('seat-faction-hover');
            d.classList.remove('seat-faction-dim');
        } else {
            d.classList.add('seat-faction-dim');
            d.classList.remove('seat-faction-hover');
        }
    });
};

// Remove the hemicycle highlight (debounced so moving between adjacent seats never flickers)
window.clearParliamentHighlight = function() {
    if (window.innerWidth <= 820 && window.mobileSelectedParliamentFaction) return;
    if (parliamentHoverClearTimer) clearTimeout(parliamentHoverClearTimer);
    parliamentHoverClearTimer = setTimeout(() => {
        parliamentHoverClearTimer = null;
        currentHoveredParliamentFaction = null;
        const infoBar = document.getElementById('mpr-parliament-hover-info');
        if (infoBar) {
            infoBar.innerHTML = LOC('parliament.hover_default');
        }
        const container = document.getElementById('mpr-dashboard-hemicycle');
        if (!container) return;
        container.querySelectorAll('.mpr-seat-dot').forEach(d => {
            d.classList.remove('seat-faction-hover', 'seat-faction-dim');
        });
    }, 45);
};

// Handle a tap or click on a hemicycle seat
window.handleParliamentSeatClick = function(factionKey) {
    if (window.innerWidth <= 820) {
        if (window.mobileSelectedParliamentFaction !== factionKey) {
            window.mobileSelectedParliamentFaction = factionKey;
            highlightParliamentFaction(factionKey, true);
            return;
        }
    }
    openFactionMenu(factionKey);
};

// Draw the 700-seat hemicycle and the faction legend
function renderParliamentHemicycleTab() {
    const activeOrder = PARLIAMENT_SEATING_ORDER.filter(k => portraitFactions.includes(k));
    let totalSeats = 0;
    activeOrder.forEach(k => {
        const f = factions[k];
        if (f && !bannedFactions[k] && f.seats > 0) {
            totalSeats += f.seats;
        }
    });

    const hemicycleCoords = generateHemicycleLayout(Math.max(1, totalSeats));
    let html = `<div class="mpr-chamber-box" style="margin-top: 6px; margin-bottom: 4px;">`;

    html += `<div id="mpr-parliament-hover-info" class="mpr-parliament-readout">
        ${LOC('parliament.hover_default')}
    </div>`;

    html += `<div id="mpr-dashboard-hemicycle" class="mpr-hemicycle-wrap">`;

    let seatCursor = 0;
    activeOrder.forEach(key => {
        const f = factions[key];
        if (!f || bannedFactions[key] || f.seats <= 0) return;

        const col = getFactionColors(key) || { fill: '#808080', border: '#CCCCCC' };
        const mood = getMoodData(key, f.affinity);
        const seatTitle = escapeHtml(LOC('parliament.seat_title', { NAME: f.name, SEATS: f.seats, MOOD: mood.text }));

        for (let s = 0; s < f.seats && seatCursor < hemicycleCoords.length; s++) {
            const pt = hemicycleCoords[seatCursor++];
            html += `<div class="mpr-seat-dot mpr-interactive-seat"
                data-faction="${key}"
                style="left: ${pt.x.toFixed(2)}%; top: ${pt.y.toFixed(2)}%; background-color: ${col.fill}; border-top-color: ${col.border}; border-left-color: ${col.border};"
                title="${seatTitle}"
                onmouseenter="highlightParliamentFaction('${key}')"
                onmouseleave="clearParliamentHighlight()"
                onclick="handleParliamentSeatClick('${key}')"></div>`;
        }
    });

    html += `<div class="mpr-rostrum">${LOC('parliament.rostrum')}</div>`;
    html += `</div>`;

    html += `<div class="mpr-parliament-legend">`;
    activeOrder.forEach(key => {
        const f = factions[key];
        if (!f) return;
        const col = getFactionColors(key) || { fill: '#808080', border: '#CCCCCC', label: f.short };
        const isBanned = bannedFactions[key] === true || f.seats <= 0;
        const mood = getMoodData(key, f.affinity);

        if (isBanned) {
            html += `<div class="mpr-legend-item mpr-legend-banned" title="${escapeHtml(LOC('parliament.legend_dissolved', { NAME: f.name }))}">
                <span class="mpr-legend-swatch" style="background-color: #555555;"></span>
                <span style="text-decoration: line-through; color: #777;">${f.short} (0)</span>
            </div>`;
        } else {
            html += `<div class="mpr-legend-item"
                onmouseenter="highlightParliamentFaction('${key}')"
                onmouseleave="clearParliamentHighlight()"
                onclick="handleParliamentSeatClick('${key}')"
                title="${escapeHtml(LOC('parliament.legend_click', { NAME: f.name, MOOD: mood.text }))}">
                <span class="mpr-legend-swatch" style="background-color: ${col.fill};"></span>
                <span><b>${f.short}</b> (${f.seats}) &bull; <font color="${mood.color}">${mood.text}</font></span>
            </div>`;
        }
    });
    html += `</div></div>`;

    return html;
}

// Cached lookup of UI elements by id
const _uiElCache = {};
function uiEl(id) {
    let el = _uiElCache[id];
    if (!el || !el.isConnected) {
        el = document.getElementById(id);
        _uiElCache[id] = el;
    }
    return el;
}

// Redraw the status panel, MPR dashboard and portraits
function updateUI() {
    uiEl('val-pc').innerText = stats.PC;

    uiEl('val-pop').innerHTML = getVagueStatText('pop', stats.pop);
    uiEl('val-mil').innerHTML = getVagueStatText('mil', stats.mil);
    uiEl('val-ref').innerHTML = getVagueStatText('ref', stats.ref);
    uiEl('val-econ').innerHTML = getVagueStatText('econ', stats.econ);
    uiEl('val-intl').innerHTML = getVagueStatText('intl', stats.intl);
    uiEl('val-stab').innerHTML = getVagueStatText('stab', stats.stab);
    uiEl('val-cendana').innerHTML = getVagueStatText('cendana', stats.cendana);

    const govStabElement = uiEl('val-gov-stab');
    if (govStabElement) {
        if (gameStarted) {
            const govTier = getGovStabilityTier();
            govStabElement.innerHTML = `<div style="color: ${govTier.color};">${LOC('gov.' + govTier.id)}</div>`;
        } else {
            govStabElement.innerHTML = `<div style="color: #000;">-</div>`;
        }
    }

    updateMobileToggleLabel();
    updateMobileStatusBar();

    const whipElem = uiEl('whip-projection-display');
    if (whipElem) {
        window.whipTrendHTML = getWhipTrendHTML();
        whipElem.innerHTML = getVagueWhipProjection() + window.whipTrendHTML;
    }

    if (gameStarted) {
        uiEl('turn-display').innerText = currentTurn;
        if (currentTurn <= events.length) {
            uiEl('date-display').innerText = events[currentTurn - 1].date;
        } else {
            uiEl('date-display').innerText = LOC('date.general_session');
        }
    } else {
        uiEl('turn-display').innerText = "-";
        uiEl('date-display').innerText = LOC('date.title_screen');
    }

    const isParliamentTab = (mprDashboardTab === 'parliament');
    const currentSignature = `${mprDashboardTab}||` + portraitFactions.map(k => {
        const f = factions[k];
        const banned = bannedFactions[k] === true || !f || f.seats <= 0;
        const moodKey = (isParliamentTab && f && !banned) ? getMoodData(k, f.affinity).text : '';
        return `${k}:${banned ? 'B' : 'A'}:${f ? f.seats : 0}:${f ? f.name : ''}:${moodKey}`;
    }).join('|');

    const portraitsArea = uiEl('portraits-area');

    const sameView = portraitsArea && lastRenderedPortraitSignature === currentSignature && portraitsArea.children.length > 0;

    if (sameView && isParliamentTab) {
    } else if (sameView && mprDashboardTab === 'factions') {
        for (let i = 0; i < portraitFactions.length; i++) {
            const key = portraitFactions[i];
            const f = factions[key];
            if (!f || bannedFactions[key] === true || f.seats <= 0) continue;

            const mood = getMoodData(key, f.affinity);
            const overlayEl = uiEl(`p-overlay-${key}`);
            const seatsEl = uiEl(`p-seats-${key}`);
            const moodEl = uiEl(`p-mood-${key}`);

            if (overlayEl) overlayEl.style.backgroundColor = mood.overlay;
            if (seatsEl) seatsEl.innerText = LOC('dash.delegates', { COUNT: f.seats });
            if (moodEl) moodEl.innerHTML = `<font color="${mood.color}"><b>${mood.text}</b></font>`;
        }
    } else if (portraitsArea) {
        const isFacTab = (mprDashboardTab === 'factions');
        const isParlTab = (mprDashboardTab === 'parliament');

        let pHTML = `<div class="mpr-view-tabs">
            <button class="mpr-tab-btn ${isFacTab ? 'is-selected' : ''}" onclick="switchMPRTab('factions')">
                ${LOC('dash.faction_view')}
            </button>
            <button class="mpr-tab-btn ${isParlTab ? 'is-selected' : ''}" onclick="switchMPRTab('parliament')">
                ${LOC('dash.parliament_view')}
            </button>
        </div>`;

        if (isParlTab) {
            pHTML += renderParliamentHemicycleTab();
        } else {
            const colsPerRow = Math.max(1, Math.ceil(portraitFactions.length / 2));
            const cellWidth = Math.floor(100 / colsPerRow) + '%';

            pHTML += '<table class="portraits-table" cellpadding="5"><tr>';
            for (let i = 0; i < portraitFactions.length; i++) {
                if (i > 0 && i % colsPerRow === 0) pHTML += '</tr><tr>';

                const key = portraitFactions[i];
                const f = factions[key];
                if (!f) continue;

                const isBanned = bannedFactions[key] === true || f.seats <= 0;
                const mood = getMoodData(key, f.affinity);
                const displayPortraitName = f.portraitName || f.name;

                if (isBanned) {
                    pHTML += '<td width="' + cellWidth + '" valign="top" class="portrait-cell portrait-banned" title="' + escapeHtml(LOC('dash.dissolved_tooltip')) + '">';
                    pHTML += '<div class="portrait-container" style="filter: grayscale(100%); opacity: 0.45;">';
                    pHTML += '<span>' + LOC('dash.photo_placeholder', { NAME: f.short.toUpperCase() }) + '</span>';
                    pHTML += '<img src="' + f.image + '" class="portrait-img" alt="[' + f.short + ']">';
                    pHTML += '<div class="portrait-overlay" style="background-color: rgba(40, 40, 40, 0.55); display: flex; align-items: center; justify-content: center;">';
                    pHTML += '<span class="portrait-dissolved-stamp">' + LOC('dash.dissolved_stamp') + '</span>';
                    pHTML += '</div>';
                    pHTML += '</div>';
                    pHTML += '<div class="portrait-name" style="color: #777; text-decoration: line-through;">' + displayPortraitName + '</div>';
                    pHTML += '<div class="portrait-seats" style="color: #888;">' + LOC('dash.delegates', { COUNT: 0 }) + '</div>';
                    pHTML += '<div class="portrait-mood"><font color="#666666"><b>' + LOC('dash.banned_mood') + '</b></font></div>';
                    pHTML += '</td>';
                } else {
                    pHTML += '<td width="' + cellWidth + '" valign="top" class="portrait-cell" onclick="openFactionMenu(\'' + key + '\')">';
                    pHTML += '<div class="portrait-container">';
                    pHTML += '<span>' + LOC('dash.photo_placeholder', { NAME: f.short.toUpperCase() }) + '</span>';
                    pHTML += '<img src="' + f.image + '" class="portrait-img" alt="[' + f.short + ']">';
                    pHTML += '<div id="p-overlay-' + key + '" class="portrait-overlay" style="background-color: ' + mood.overlay + ';"></div>';
                    pHTML += '</div>';
                    pHTML += '<div class="portrait-name">' + displayPortraitName + '</div>';
                    pHTML += '<div id="p-seats-' + key + '" class="portrait-seats">' + LOC('dash.delegates', { COUNT: f.seats }) + '</div>';
                    pHTML += '<div id="p-mood-' + key + '" class="portrait-mood"><font color="' + mood.color + '"><b>' + mood.text + '</b></font></div>';
                    pHTML += '</td>';
                }
            }
            pHTML += '</tr></table>';
        }

        portraitsArea.innerHTML = pHTML;
        lastRenderedPortraitSignature = currentSignature;
    }

    checkAchievements();
    if (typeof updateWin95Taskbar === 'function') updateWin95Taskbar();
}

// Resolve [min, max] effect ranges into random values
function rollEffectRanges(eff) {
    const resolved = {};
    for (const key in eff) {
        const v = eff[key];
        if (Array.isArray(v) && v.length === 2) {
            const lo = Math.min(Number(v[0]), Number(v[1]));
            const hi = Math.max(Number(v[0]), Number(v[1]));
            resolved[key] = Math.floor(Math.random() * (hi - lo + 1)) + lo;
        } else if (typeof v === 'string' && v.includes('..')) {
            const parts = v.split(/\.+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            if (parts.length === 2) {
                const lo = Math.min(parts[0], parts[1]);
                const hi = Math.max(parts[0], parts[1]);
                resolved[key] = Math.floor(Math.random() * (hi - lo + 1)) + lo;
            } else {
                resolved[key] = parseInt(v, 10) || 0;
            }
        } else {
            resolved[key] = Number(v) || 0;
        }
    }
    return resolved;
}

// Political Capital change log and the function that records each change.
window.pcLog = [];
// Record a PC change in the PC log
function logPCChange(delta, reason) {
    if (!delta) return;
    window.pcLog.push({ turn: currentTurn, delta: delta, reason: reason, balanceAfter: stats.PC });
}
// Show the PC income and spend log
window.showPCLog = function() {
    console.log('--- Full PC Ledger ---');
    console.table(window.pcLog);
    const byTurn = {};
    window.pcLog.forEach(e => {
        byTurn[e.turn] = byTurn[e.turn] || { income: 0, spend: 0, net: 0 };
        if (e.delta > 0) byTurn[e.turn].income += e.delta;
        else byTurn[e.turn].spend += -e.delta;
        byTurn[e.turn].net += e.delta;
    });
    console.log('--- Per-Turn Income vs Spend ---');
    console.table(byTurn);
};

// Applies a military-support change through the opposition engine, or directly to ABRI affinity if the engine is not loaded.
function applyMilitaryDelta(delta) {
    if (window.OppositionEngine) {
        OppositionEngine.applyMilitaryDelta(delta);
        return;
    }
    if (!factions['abri'] || !delta) return;
    factions['abri'].affinity = clampFaction('abri', factions['abri'].affinity + delta);
    stats.mil = Math.round(factions['abri'].affinity);
}

// Rounds a positive number up or down at random, so small amounts keep their expected value after being scaled.
function stochRound(x) {
    const f = Math.floor(x);
    return f + (Math.random() < (x - f) ? 1 : 0);
}

// Gain shrinking. While the generals are angry (military meter) every good change from deals, decrees, actions and events shrinks,
// Political Capital included. While the street is mobilized (PDI-P meter) gains of Political Capital, Popularity and Reformasi
// Credibility shrink too, and PDI-P's own loyalty gains shrink further. ABRI's own loyalty is handled separately, and favors are left alone.
function currentMilitaryResistance() {
    return window.OppositionEngine ? OppositionEngine.getMilitaryResistance() : 0;
}
function currentPdipCut() {
    return window.OppositionEngine ? OppositionEngine.getPdipCut() : 0;
}
// Share of a good change that survives for one stat key.
function gainFactor(key) {
    const mil = 1 - currentMilitaryResistance();
    const raw = (key === 'PC' || key === 'pop' || key === 'ref')
        ? mil * (1 - currentPdipCut())
        : mil;
    let f = raw;
    if (key === 'PC' && golkarPillarStands('birokrasi')) f *= 1 - GOLKAR_PILLAR_EFFECTS.pcMalus;
    if (key.startsWith('golkar') && golkarPillarStands('abri')) f *= 1 - GOLKAR_PILLAR_EFFECTS.abriResistance;
    return Math.max(0.40, f);
}

function pcGainFactor() { return gainFactor('PC'); }
function applyMilitaryResistance(eff) {
    if (!eff) return eff;
    if (currentMilitaryResistance() <= 0 && currentPdipCut() <= 0 && !(window.OppositionEngine && OppositionEngine.getPdipTier() > 0)
        && !golkarPillarStands('abri') && !golkarPillarStands('birokrasi')) return eff;
    const out = {};
    for (const key in eff) {
        const v = eff[key];
        if (typeof v !== 'number' || v === 0 || key === 'abri' || key === 'mil' || key.endsWith('_favor') || !isGoodDelta(key, v)) {
            out[key] = v;
            continue;
        }
        let f = gainFactor(key);
        if (key === 'pdip' && window.OppositionEngine) f *= OppositionEngine.getPdipGainMult();
        out[key] = (f >= 1) ? v : Math.sign(v) * stochRound(Math.abs(v) * f);
    }
    return out;
}

// Apply an effects object to stats and factions
function applyEffects(eff, updateSnapshot = true) {
    if (!eff) return;
    if (updateSnapshot) prevStatsSnapshot = { ...stats };
    eff = applyMilitaryResistance(rollEffectRanges(eff));

    if (eff.PC !== undefined) {
        const nextPC = clampPC(stats.PC + eff.PC);
        logPCChange(nextPC - stats.PC, 'effect');
        stats.PC = nextPC;
    }
    if (eff.pop !== undefined) stats.pop = clampDashboard('pop', stats.pop + eff.pop);
    if (eff.ref !== undefined) stats.ref = clampDashboard('ref', stats.ref + eff.ref);
    if (eff.econ !== undefined) stats.econ = clampDashboard('econ', stats.econ + eff.econ);
    if (eff.intl !== undefined) stats.intl = clampDashboard('intl', stats.intl + eff.intl);
    if (eff.stab !== undefined) stats.stab = clampDashboard('stab', stats.stab + eff.stab);
    if (eff.cendana !== undefined) stats.cendana = clampDashboard('cendana', stats.cendana + eff.cendana);

    // 'mil' and 'abri' are the same meter; an effect carrying both applies only the stronger one, not their sum
    const milDelta = Math.abs(eff.mil || 0) > Math.abs(eff.abri || 0) ? (eff.mil || 0) : (eff.abri || 0);
    if (milDelta !== 0) {
        applyMilitaryDelta(milDelta);
    }

    for (const key in eff) {
        if (key === 'abri' || key === 'mil') continue;
        if (key.endsWith('_favor')) {
            const facKey = key.replace('_favor', '');
            if (factions[facKey] && !bannedFactions[facKey]) {
                factions[facKey].favor = Math.min(diffNum('maxFavor', 3), (factions[facKey].favor || 0) + eff[key]);
            }
        } else if (factions[key] && !bannedFactions[key]) {
            const before = factions[key].affinity;
            factions[key].affinity = clampFaction(key, factions[key].affinity + eff[key]);
            if (key === 'pdip' && window.OppositionEngine) OppositionEngine.onPdipDelta(factions[key].affinity - before);
        }
    }

    if (factions['abri']) {
        stats.mil = Math.round(factions['abri'].affinity);
    }
}

// Show the credits screen
window.showCredits = function() {
    if (!enterMenuView()) return;
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('credits.title') + '</h2></center>';
    html += '<div class="faction-summary" style="text-align: center; margin-bottom: 16px;">';

    if (creditsData && creditsData.main) {
        creditsData.main.forEach(line => { html += `<p>${line}</p>`; });
    } else {
        html += '<p>' + LOC('credits.missing') + '</p>';
    }

    html += '</div>';
    html += '<center>';
    html += '<button style="width: 250px; text-align: center; margin-bottom: 8px;" onclick="showMusicCredits()">' + LOC('credits.btn.music') + '</button><br>';
    html += '<button style="width: 250px; text-align: center; margin-bottom: 8px;" onclick="showSfxCredits()">' + LOC('credits.btn.sfx') + '</button><br>';
    html += '<button style="width: 250px; text-align: center; margin-bottom: 8px;" onclick="showImageCredits()">' + LOC('credits.btn.images') + '</button><br>';
    html += '<button style="width: 250px; text-align: center; margin-bottom: 8px;" onclick="showSources()">' + LOC('credits.btn.sources') + '</button><br>';
    html += '</center>';

    const returnFunc = gameStarted ? (isActionPhase ? 'showActionMenu()' : 'renderEventMenu()') : 'showStartMenu()';
    html += `<center><button style="width: 250px; margin-top: 15px; background-color: #ff9999; text-align: center;" onclick="${returnFunc}">${gameStarted ? LOC('credits.btn.back_to_game') : LOC('common.back')}</button></center>`;
    document.getElementById('main-panel').innerHTML = html;
};

// Show the sound effect credits
window.showSfxCredits = function() {
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('credits.sfx.title') + '</h2></center>';
    html += '<div class="faction-summary" style="text-align: left; margin-bottom: 20px;">';
    if (creditsData && creditsData.sfx) {
        creditsData.sfx.forEach(line => { html += `<p>${line}</p>`; });
    } else {
        html += '<p>' + LOC('credits.sfx.missing') + '</p>';
    }
    html += '</div>';
    html += '<center><button style="width: 250px; background-color: #ff9999; text-align: center;" onclick="showCredits()">' + LOC('common.back') + '</button></center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Show the image credits
window.showImageCredits = function() {
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('credits.images.title') + '</h2></center>';
    html += '<div class="faction-summary" style="text-align: left; margin-bottom: 20px;">';
    html += '<p><b>' + LOC('credits.images.subtitle') + '</b></p><ul>';
    if (creditsData && creditsData.images) {
        creditsData.images.forEach(line => { html += `<li style="margin-bottom: 8px;">${line}</li>`; });
    } else {
        html += '<li>' + LOC('credits.images.missing') + '</li>';
    }
    html += '</ul></div>';
    html += '<center><button style="width: 250px; background-color: #ff9999; text-align: center;" onclick="showCredits()">' + LOC('common.back') + '</button></center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Show the music credits
window.showMusicCredits = function() {
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('credits.music.title') + '</h2></center>';
    html += '<div class="faction-summary" style="text-align: left; margin-bottom: 20px;">';
    if (creditsData && creditsData.music) {
        creditsData.music.forEach(line => { html += `<p>${line}</p>`; });
    } else {
        html += '<p>' + LOC('credits.music.missing') + '</p>';
    }
    html += '</div>';
    html += '<center><button style="width: 250px; background-color: #ff9999; text-align: center;" onclick="showCredits()">' + LOC('common.back') + '</button></center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Show the sources screen
window.showSources = function() {
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('credits.sources.title') + '</h2></center>';
    html += '<div class="faction-summary" style="text-align: left; margin-bottom: 20px;">';
    html += '<p><b>' + LOC('credits.sources.subtitle') + '</b></p><ul>';
    if (creditsData && creditsData.sources) {
        creditsData.sources.forEach(line => { html += `<li style="margin-bottom: 8px;">${line}</li>`; });
    } else {
        html += '<li>' + LOC('credits.sources.missing') + '</li>';
    }
    html += '</ul></div>';
    html += '<center><button style="width: 250px; background-color: #ff9999; text-align: center;" onclick="showCredits()">' + LOC('common.back') + '</button></center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Expand or collapse the Effects settings card
window.toggleSettingsEffects = function() {
    const cb = document.getElementById('settings-effects-toggle');
    if (cb) {
        showOptionEffects = cb.checked;
        saveUserSettings();
    }
};

// Applies all three appearance settings to the page. Safe to call repeatedly.
window.applyAppearance = function() {
    const root = document.documentElement;
    root.setAttribute('data-wstyle', windowStyle);
    root.setAttribute('data-scheme', colorScheme);

    let link = document.getElementById('theme-css');
    const href = WINDOW_STYLES[windowStyle] && WINDOW_STYLES[windowStyle].css;
    if (!href) {
        if (link) link.remove();
    } else {
        if (!link) {
            link = document.createElement('link');
            link.id = 'theme-css';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    }

    const overlay = document.getElementById('crt-overlay');
    if (overlay) {
        overlay.style.display = crtEnabled ? 'block' : 'none';
        overlay.style.opacity = crtIntensity / 100;
    }

    const active = EFFECTS.filter(e => isEffectOn(e.id)).map(e => e.id);
    if (active.length) root.setAttribute('data-fx', active.join(' '));
    else root.removeAttribute('data-fx');
};

// Whether an effect is switched on
window.isEffectOn = function(id) {
    return id === 'crt' ? crtEnabled : Boolean(effectsOn[id]);
};

// Turn one effect on or off and apply it
window.setEffect = function(id, on) {
    if (id === 'crt') crtEnabled = Boolean(on);
    else if (Object.prototype.hasOwnProperty.call(effectsOn, id)) effectsOn[id] = Boolean(on);
    else return;
    applyAppearance();
    saveUserSettings();
    showSettingsMenu(true);
};

// Master switch: every effect on, or every effect off
window.setAllEffects = function(on) {
    crtEnabled = Boolean(on);
    Object.keys(effectsOn).forEach(k => { effectsOn[k] = Boolean(on); });
    applyAppearance();
    saveUserSettings();
    showSettingsMenu(true);
};

// Choose a window style and apply it
window.setWindowStyle = function(id) {
    if (!WINDOW_STYLES[id]) return;
    windowStyle = id;
    applyAppearance();
    saveUserSettings();
    showSettingsMenu(true);
};

// Choose a color scheme and apply it
window.setColorScheme = function(id) {
    if (!COLOR_SCHEMES[id]) return;
    colorScheme = id;
    applyAppearance();
    saveUserSettings();
    showSettingsMenu(true);
};

// Turn CRT scanlines on or off
// Apply the CRT intensity slider
window.updateCRTIntensity = function() {
    const slider = document.getElementById('crt-slider');
    const display = document.getElementById('crt-display');
    const overlay = document.getElementById('crt-overlay');
    if (slider && overlay) {
        crtIntensity = Number(slider.value);
        overlay.style.opacity = crtIntensity / 100;
        if (display) display.innerText = crtIntensity + '%';
        saveUserSettings();
    }
};

// Apply the text size setting to the page
function applyTextScale(scaleValue) {
    textScale = Number(scaleValue);
    const scale = textScale / 100;

    let style = document.getElementById('dynamic-text-scale');
    if (!style) {
        style = document.createElement('style');
        style.id = 'dynamic-text-scale';
        document.head.appendChild(style);
    }

    style.innerHTML = `
        .stat-label, .stat-value, .portrait-seats, .portrait-mood { font-size: ${Math.round(12 * scale)}px !important; }
        .update-notice-body { font-size: ${Math.round(14 * scale)}px !important; }
        .left-tab-btn, .music-header, .coffee-btn, .toast-title { font-size: ${Math.round(13 * scale)}px !important; }
        #main-panel button, #left-panel button, #mpr-dashboard button, .portrait-name, .achievement-desc { font-size: ${Math.round(14 * scale)}px !important; }
        .faction-summary, #custom-alert-message, .achievement-title, #main-panel p, #left-panel p { font-size: ${Math.round(15 * scale)}px !important; line-height: 1.7 !important; }
        #main-panel > div:not(.tally-box):not(#speed-controls-container) { font-size: ${Math.round(15 * scale)}px !important; line-height: 1.7 !important; }
        #main-panel font[size="2"], #mpr-dashboard font[size="2"] { font-size: ${Math.round(13 * scale)}px !important; }
        #main-panel font[size="3"], #mpr-dashboard font[size="3"] { font-size: ${Math.round(17 * scale)}px !important; }
        #main-panel font[size="4"], #mpr-dashboard font[size="4"] { font-size: ${Math.round(19 * scale)}px !important; }
        #main-panel h2 { font-size: ${Math.round(24 * scale)}px !important; }
        #main-panel h3 { font-size: ${Math.round(18 * scale)}px !important; }
        .pc-display { font-size: ${Math.round(22 * scale)}px !important; }
    `;
}

// Apply the text size slider
window.updateTextScale = function() {
    const slider = document.getElementById('text-scale-slider');
    const display = document.getElementById('text-scale-display');
    if (slider) {
        applyTextScale(slider.value);
        if (display) display.innerText = textScale + '%';
        saveUserSettings();
    }
};

// Label for a chapter or topic button (numeral.<n> in the language files, or the plain number)
function getNumeralLabel(n) {
    return LOC.has('numeral.' + n) ? LOC('numeral.' + n) : n;
}

// Show a page of the tutorial
window.showTutorial = function(pageIndex) {
    clearTallyInterval();
    scrollMainPanelToTop();
    if (!tutorialPages || tutorialPages.length === 0) {
        showCustomAlert(LOC('tutorial.load_error'), showStartMenu);
        return;
    }

    const pageData = tutorialPages[pageIndex];
    const pageText = typeof pageData === 'string' ? pageData : pageData.text;
    const pageTitle = (typeof pageData === 'object' && pageData.title)
        ? pageData.title
        : LOC('tutorial.topic_default_title', { N: pageIndex + 1, TOTAL: tutorialPages.length });

    let html = '<center><h2>' + LOC('tutorial.title') + '</h2></center>';

    html += '<div style="text-align: center; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #808080;">';
    html += '<span style="font-size: 11px; font-weight: bold; color: #000080; margin-right: 6px;">' + LOC('tutorial.topic_label') + '</span>';
    for (let i = 0; i < tutorialPages.length; i++) {
        const isCur = (i === pageIndex);
        const label = getNumeralLabel(i + 1);
        const topTitle = escapeHtml((typeof tutorialPages[i] === 'object' && tutorialPages[i].title) ? tutorialPages[i].title : LOC('tutorial.topic_short', { N: i + 1 }));
        html += `<button class="${isCur ? 'is-selected' : ''}" title="${topTitle}" style="width: 36px; display: inline-block; text-align: center; --py: 3px; --px: 0; margin: 2px; font-size: 11px; " onclick="showTutorial(${i})">${label}</button>`;
    }
    html += '</div>';

    html += `<h3 style="text-align: center; color: #000080; margin-bottom: 12px;">${pageTitle}</h3>`;
    html += '<div class="faction-summary" style="padding: 15px; margin-bottom: 12px; min-height: 220px;">' + pageText + '</div>';

    html += '<div style="text-align: center; margin-top: 10px;">';
    if (pageIndex > 0) {
        html += `<button style="width: 130px; text-align: center; display: inline-block; margin-right: 10px; " onclick="showTutorial(${pageIndex - 1})">${LOC('common.previous')}</button>`;
    }
    html += `<span style="font-size: 12px; font-weight: bold; color: #333; margin: 0 8px;">${LOC('common.page_of', { N: pageIndex + 1, TOTAL: tutorialPages.length })}</span>`;
    if (pageIndex < tutorialPages.length - 1) {
        html += `<button style="width: 130px; text-align: center; display: inline-block; margin-left: 10px; " onclick="showTutorial(${pageIndex + 1})">${LOC('common.next')}</button>`;
    }
    html += '</div>';

    html += '<center><button style="width: 250px; text-align: center; margin-top: 16px; background-color: #ff9999; " onclick="showStartMenu()">' + LOC('common.back') + '</button></center>';
    document.getElementById('main-panel').innerHTML = html;
};


// Built-in SVG flags so language buttons always render as small crisp flags even without external image files
const BUILTIN_LANG_FLAGS = {
    en: `<svg viewBox="0 0 60 40" width="24" height="16" aria-hidden="true"><rect width="60" height="40" fill="#012169"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFFFFF" stroke-width="7"/><path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" stroke-width="3.5"/><path d="M30,0 V40 M0,20 H60" stroke="#FFFFFF" stroke-width="11"/><path d="M30,0 V40 M0,20 H60" stroke="#C8102E" stroke-width="6.5"/></svg>`,
    id: `<svg viewBox="0 0 30 20" width="24" height="16" aria-hidden="true"><rect width="30" height="10" fill="#CE1126"/><rect y="10" width="30" height="10" fill="#FFFFFF"/></svg>`,
    zh: `<svg viewBox="0 0 30 20" width="24" height="16" aria-hidden="true"><rect width="30" height="20" fill="#DE2910"/><polygon points="5,2.2 5.9,4.9 8.7,4.9 6.4,6.6 7.3,9.3 5,7.6 2.7,9.3 3.6,6.6 1.3,4.9 4.1,4.9" fill="#FFDE00"/><circle cx="10.5" cy="2.2" r="0.85" fill="#FFDE00"/><circle cx="12.2" cy="4.2" r="0.85" fill="#FFDE00"/><circle cx="12.2" cy="6.8" r="0.85" fill="#FFDE00"/><circle cx="10.5" cy="8.8" r="0.85" fill="#FFDE00"/></svg>`
};

// Renders the 4-button utility icon bar (Library, Achievements, Settings, Credits) using photo/icons/*.png
window.renderUtilityIconsHTML = function(extraStyle = '') {
    const libTitle = escapeHtml(LOC('title.library'));
    const achTitle = escapeHtml(LOC('title.achievements'));
    const setTitle = escapeHtml(LOC('title.settings'));
    const crdTitle = escapeHtml(LOC('title.credits'));
    return `<div class="utility-icon-row"${extraStyle ? ` style="${extraStyle}"` : ''}>
        <button type="button" class="utility-icon-btn" onclick="showLibraryMenu()" title="${libTitle}" aria-label="${libTitle}">
            <img src="photo/icons/book.png" alt="${libTitle}" draggable="false">
        </button>
        <button type="button" class="utility-icon-btn" onclick="showAchievementsMenu()" title="${achTitle}" aria-label="${achTitle}">
            <img src="photo/icons/trophy.png" alt="${achTitle}" draggable="false">
        </button>
        <button type="button" class="utility-icon-btn" onclick="showSettingsMenu()" title="${setTitle}" aria-label="${setTitle}">
            <img src="photo/icons/settings.png" alt="${setTitle}" draggable="false">
        </button>
        <button type="button" class="utility-icon-btn" onclick="showCredits()" title="${crdTitle}" aria-label="${crdTitle}">
            <img src="photo/icons/info.png" alt="${crdTitle}" draggable="false">
        </button>
    </div>`;
};

// Renders the compact row of small flag buttons (used on the title screen and inside Settings)
window.renderLanguageFlagsHTML = function(inSettings = false) {
    let html = '<div class="lang-flag-row">';
    LOC.languages().forEach(l => {
        const nm = escapeHtml(l.name);
        const isCur = (l.code === currentLang);
        const visual = l.flag
            ? `<img src="${escapeHtml(l.flag)}" alt="${nm}" draggable="false">`
            : (BUILTIN_LANG_FLAGS[l.code] || `<span style="font-size:10px;padding:2px 4px;">${l.code.toUpperCase()}</span>`);
        if (l.enabled) {
            html += `<button type="button" class="lang-flag-btn ${isCur ? 'is-selected' : ''}" title="${nm}" aria-label="${nm}" onclick="setLanguage('${l.code}', ${Boolean(inSettings)})">${visual}</button>`;
        } else {
            const unavailTip = escapeHtml(LOC('language.unavailable_tooltip', { NAME: l.name }));
            html += `<button type="button" class="lang-flag-btn" disabled title="${unavailTip}" aria-label="${nm}">${visual}</button>`;
        }
    });
    html += '</div>';
    return html;
};

// Switch the game language (works on the title screen and mid-game from Settings without resetting the campaign)
window.setLanguage = async function(lang, stayInSettings = false) {
    const info = LOC.languages().find(l => l.code === lang);
    if (!info || !info.enabled || currentLang === lang) return;
    currentLang = lang;
    saveUserSettings();
    await LOC.load(lang);
    await loadLocalizedAssets();
    lastRenderedPortraitSignature = "";
    if (typeof window.syncMusicUI === 'function') window.syncMusicUI();
    updateUI();
    if (stayInSettings && typeof showSettingsMenu === 'function') {
        showSettingsMenu(true);
    } else if (gameStarted) {
        returnToPreviousView();
    } else {
        showStartMenu();
    }
};

// Build the HTML for one update or announcement entry
function renderUpdateEntry(u) {
    const meta = [u.version ? LOC('updates.version', { VERSION: u.version }) : '', u.date || ''].filter(Boolean).join(' &bull; ');

    let html = '<div class="update-entry">';
    if (meta) html += `<div class="update-notice-meta">${meta}</div>`;
    if (u.title) html += `<div class="update-notice-heading">${u.title}</div>`;
    html += '<ul>' + u.notes.map(n => `<li>${n}</li>`).join('') + '</ul>';
    html += '</div>';
    return html;
}

// updates.json can be a list (newest first) or a single update object
function renderUpdateNotice() {
    const raw = Array.isArray(updatesData) ? updatesData : (updatesData ? [updatesData] : []);
    const list = raw.filter(u => u && Array.isArray(u.notes) && u.notes.length > 0);
    if (list.length === 0) return '';

    let html = '<div class="update-notice">';
    html += `<div class="update-notice-title">${LOC('updates.heading')}</div>`;
    html += '<div class="update-notice-body">';
    html += renderUpdateEntry(list[0]);
    if (list.length > 1) {
        html += `<details class="update-older"><summary>${LOC('updates.previous', { COUNT: list.length - 1 })}</summary>`;
        html += list.slice(1).map(u => renderUpdateEntry(u)).join('');
        html += '</details>';
    }
    html += '</div></div>';
    return html;
}

// Render the main menu
window.showStartMenu = function() {
    clearTallyInterval();
    scrollMainPanelToTop();
    const savedRun = hasSavedCampaign();

    const btnStyle = 'width: 100%; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px;';

    const titleImg = (gameConfig && gameConfig.titleBannerImage) ? gameConfig.titleBannerImage : 'photo/title_banner.png';
    let html = `<div class="title-screen-banner">
        <div class="title-screen-banner-placeholder-text">
            ${LOC('title.banner_fallback_1')}<br>
            <span style="font-size: 11px; font-weight: normal;">${LOC('title.banner_fallback_2')}</span>
        </div>
        <img src="${titleImg}" alt="[Title Banner]" onerror="this.style.display='none'">
    </div>`;
    html += '<div class="start-menu-layout">';

    html += `<div class="start-menu-left">${renderUpdateNotice()}</div>`;

    html += '<div class="start-menu-right">';

    if (savedRun) {
        const savedTurn = savedRun.currentTurn || 1;
        const savedDate = (events[savedTurn - 1] && events[savedTurn - 1].date)
            ? events[savedTurn - 1].date
            : LOC('title.saved_turn_fallback', { TURN: savedTurn });
        const savedPhase = LOC(savedRun.isActionPhase ? 'title.phase_action' : 'title.phase_event');
        const summary = LOC('title.continue_summary', { TURN: savedTurn, MAX: events.length, DATE: savedDate, PHASE: savedPhase });
        html += `<button style="width: 100%; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px; background-color: #d0e8d0; color: #004d00;" onclick="continueSavedCampaign()">${LOC('title.continue')}<br><span style="font-size: 11px; font-weight: normal; color: #222;">${summary}</span></button>`;
    }

    html += `<button style="${btnStyle}" onclick="showDifficultyMenu()">${LOC(savedRun ? 'title.new_game' : 'title.play')}</button>`;
    html += `<button style="${btnStyle}" onclick="showTutorial(0)">${LOC('title.tutorial')}</button>`;

    html += renderUtilityIconsHTML('margin-top: 4px; margin-bottom: 10px;');

    html += renderLanguageFlagsHTML(false);

    html += '</div></div>';
    html += '<div style="min-height: 40px;"></div>';
    document.getElementById('main-panel').innerHTML = html;
};

// Render the difficulty selection menu
window.showDifficultyMenu = function() {
    scrollMainPanelToTop();
    let html = `<center><h2>${LOC('difficulty.title')}</h2></center>`;
    html += '<div class="difficulty-row">';
    if (selectedDifficulty === 'ucn' && !(window.SSS && SSS.unlocked())) selectedDifficulty = 'historical';
    const diffList = ['easy', 'medium', 'high', 'historical'];
    if (window.SSS) diffList.push('ucn');
    diffList.forEach(diff => {
        const def = gameConfig.difficultySettings[diff];
        if (!def) return;
        const isUcn = diff === 'ucn';
        if (isUcn && !SSS.unlocked()) {
            html += `<button class="ucn-diff-btn is-locked" onclick="SSS.lockedHint()">${LOC('ucn.locked.label')}</button>`;
            return;
        }
        const cls = [diff === selectedDifficulty ? 'is-selected' : '', isUcn ? 'ucn-diff-btn' : ''].filter(Boolean).join(' ');
        const styleAttr = diff === 'historical' ? ' style="color: #8B0000;"' : '';
        html += `<button class="${cls}"${styleAttr} onclick="selectDifficulty('${diff}')">${LOC.r(def.name)}</button>`;
    });
    html += '</div>';

    const selDef = gameConfig.difficultySettings[selectedDifficulty];
    if (selDef.image) {
        html += `<center><span class="glass-frame"><img src="${selDef.image}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(LOC('difficulty.image_alt', { NAME: LOC.r(selDef.name) }))}"></span></center>`;
    }

    html += '<div style="padding: 10px; background-color: #FFFFFF; border: none; margin-bottom: 15px; font-family: MS Sans Serif; font-size: 13px; line-height: 1.4; text-align: justify;">';
    html += `${LOC.r(selDef.description)}</div>`;
    if (selectedDifficulty === 'ucn' && window.SSS) html += SSS.renderPanel();

    const forecastLocked = selectedDifficulty === 'historical' || (selectedDifficulty === 'ucn' && window.SSS && SSS.isForecastHidden());
    const toggleDisabled = forecastLocked ? 'disabled' : '';
    const toggleChecked = (showOptionEffects && !forecastLocked) ? 'checked' : '';
    const toggleStyle = forecastLocked ? 'color: #888;' : 'color: #000;';

    if (!(selectedDifficulty === 'ucn' && window.SSS)) {
        html += `<div style="text-align:center; margin-bottom: 25px; font-family: MS Sans Serif; font-size: 12px; ${toggleStyle}">`;
        html += `<label style="cursor: pointer;"><input type="checkbox" id="effects-toggle" ${toggleChecked} ${toggleDisabled} onchange="toggleEffects()"> ${LOC('difficulty.forecast_toggle')}</label>`;
        html += `</div>`;
    }

    html += `<center><button style="width: 250px; font-size: 14px; --py: 10px; --px: 10px; text-align: center;" onclick="showSituation()">${LOC('common.continue')}</button></center>`;
    html += `<center><button style="width: 250px; margin-top: 10px; background-color: #ff9999; text-align: center;" onclick="showStartMenu()">${LOC('common.back')}</button></center>`;
    document.getElementById('main-panel').innerHTML = html;
};

// Opening screen of a new campaign: offers the full briefing or an immediate start
window.showSituation = function() {
    scrollMainPanelToTop();
    let html = `<center><h2>${LOC('situation.title')}</h2></center>`;
    if (gameConfig && gameConfig.situationImage) {
        html += `<center><span class="glass-frame"><img src="${gameConfig.situationImage}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(LOC('situation.image_alt'))}"></span></center>`;
    }
    html += `<div style="padding: 10px 15px; margin-bottom: 20px; font-family: MS Sans Serif, sans-serif; font-size: 13px; line-height: 1.6; color: #333; text-align: center;">${LOC('situation.choice_prompt')}</div>`;
    html += '<center>';
    html += `<button style="width: 300px; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px;" onclick="showSituationBriefing()">${LOC('situation.learn')}</button><br>`;
    html += `<button style="width: 300px; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px;" onclick="startGame()">${LOC('situation.skip')}</button><br>`;
    html += `<button style="width: 300px; text-align: center; background-color: #ff9999; --py: 10px; --px: 10px;" onclick="showDifficultyMenu()">${LOC('common.back')}</button>`;
    html += '</center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Render the full situation briefing (paragraphs are situation.p1, situation.p2, ... in data/language/*/lore.json)
window.showSituationBriefing = function() {
    scrollMainPanelToTop();
    let html = `<center><h2>${LOC('situation.title')}</h2></center>`;
    if (gameConfig && gameConfig.situationImage) {
        html += `<center><span class="glass-frame"><img src="${gameConfig.situationImage}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(LOC('situation.image_alt'))}"></span></center>`;
    }
    html += '<div style="padding: 15px; margin-bottom: 20px; font-family: MS Sans Serif, sans-serif; font-size: 13px; line-height: 1.6; color: #333; text-align: justify;">';
    html += `<b>${LOC('situation.salutation')}</b><br><br>`;
    const paragraphs = [];
    for (let i = 1; LOC.has('situation.p' + i); i++) paragraphs.push(LOC('situation.p' + i));
    html += paragraphs.join('<br><br>');
    html += '</div>';

    html += '<center>';
    html += `<button style="width: 300px; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px;" onclick="startGame()">${LOC('situation.start')}</button><br>`;
    html += `<button style="width: 300px; text-align: center; background-color: #ff9999; --py: 10px; --px: 10px;" onclick="showSituation()">${LOC('common.back')}</button>`;
    html += '</center>';
    document.getElementById('main-panel').innerHTML = html;
};

// Select a difficulty and refresh the menu
window.selectDifficulty = function(diff) {
    if (diff === 'ucn' && !(window.SSS && SSS.unlocked())) { if (window.SSS) SSS.lockedHint(); return; }
    selectedDifficulty = diff;
    if (diff === 'historical' || (diff === 'ucn' && window.SSS && SSS.isForecastHidden())) showOptionEffects = false;
    saveUserSettings();
    showDifficultyMenu();
};

// Toggle whether option effects are shown
window.toggleEffects = function() {
    const cb = document.getElementById('effects-toggle');
    if (cb) {
        showOptionEffects = cb.checked;
        saveUserSettings();
    }
};

// Reset state and begin a new campaign
window.startGame = function() {
    clearTallyInterval();
    startBackgroundMusic();
    if (selectedDifficulty === 'ucn') {
        if (window.SSS && SSS.unlocked()) SSS.startRun();
        else selectedDifficulty = 'historical';
    } else {
        window.sssActive = null;
    }
    const def = gameConfig.difficultySettings[selectedDifficulty];

    clearCampaignSave();

    currentTurn = 1;
    globalMalus = 0;
    activeDecrees = {};
    bannedFactions = {};
    completedInteractions = {};
    actionCooldowns = {};
    actionUsageCount = {};
    factionCooldowns = {};
    factionUsageCount = {};
    turnExecutiveUsed = false;
    turnFactionUsed = false;
    turnFactionCount = 0;
    prevStatsSnapshot = null;
    lastRenderedPortraitSignature = "";
    minStats = { pop: 0, mil: 0, ref: 0, econ: 0, intl: 0, stab: 0 };
    maxCendana = 100;
    minFactions = {};
    window.tallySpeed = (window.extraSettings && window.extraSettings.defaultTallySpeed) || 1;
    window.pcLog = [];
    window.lastElectionSummary = null;
    window.electionPanelSnapshot = null;
    window.resolvedEventTurn = 0;
    window.horseTradeCounts = {};
    window.lastHorseTradeTicker = "";

    factions = deepClone(initialFactionsSnapshot);
    portraitFactions = [...INITIAL_PORTRAIT_FACTIONS];
    events.forEach(ev => { delete ev.shuffledIndices; });

    stats.PC = clampPC(def.pc);
    // Per-metric opening offsets exist only on the Ultimate Custom Night; every other difficulty uses one shared statMod.
    const startMod = (k) => (def.startMods && typeof def.startMods[k] === 'number') ? def.startMods[k] : def.statMod;
    stats.pop = clampDashboard('pop', 30 + startMod('pop'));
    stats.mil = clampDashboard('mil', 35 + startMod('mil'));
    stats.ref = clampDashboard('ref', 40 + startMod('ref'));
    stats.econ = clampDashboard('econ', 20 + startMod('econ'));
    stats.intl = clampDashboard('intl', 30 + startMod('intl'));
    stats.stab = clampDashboard('stab', 25 + startMod('stab'));
    stats.cendana = clampDashboard('cendana', def.cendana);

    for (const key in factions) {
        factions[key].affinity = clampFaction(key, factions[key].affinity + (typeof def.affinityMod === 'number' ? def.affinityMod : def.statMod));
        factions[key].favor = 0;
        if (key === 'abri') factions[key].affinity = clampFaction(key, 50 + ((def.startMods && def.startMods.mil) || 0));
        factions[key].baseAffinity = factions[key].affinity;
    }

    if (factions['abri']) stats.mil = Math.round(factions['abri'].affinity);

    lowestGovStability = getGovStability();
    bankBaliCleanSteps = {};
    timorPromiseSteps = {};
    sp3UpheldWithHighCendana = false;
    helpedRaisSpeaker = false;
    if (window.OppositionEngine) OppositionEngine.reset();

    gameStarted = true;
    syncSidebarVisibility();
    updateUI();
    loadPhase();
};

// Show Habibie's biography (paragraphs are bio.habibie.p1, p2, ... in data/language/*/lore.json)
window.showHabibieBio = function() {
    if (!enterMenuView()) return;
    scrollMainPanelToTop();
    let html = `<h2>${LOC('bio.habibie.title')}</h2>`;
    if (gameConfig && gameConfig.habibieCoverImage) {
        html += `<center><span class="glass-frame"><img src="${gameConfig.habibieCoverImage}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(LOC('bio.habibie.image_alt'))}"></span></center>`;
    }
    let paragraphs = '';
    for (let i = 1; LOC.has('bio.habibie.p' + i); i++) paragraphs += `<p>${LOC('bio.habibie.p' + i)}</p>`;
    html += `<div class="faction-summary">${paragraphs}</div>`;

    html += `<button style="background-color: #ff9999; text-align: center;" onclick="returnToPreviousView()">${LOC('common.back')}</button>`;
    document.getElementById('main-panel').innerHTML = html;
};

// Show a faction's biography
window.showFactionBio = function(factionKey) {
    scrollMainPanelToTop();
    const f = factions[factionKey];
    let html = '<h2> ' + f.name + '</h2>';
    if (f.coverImage) {
        html += `<center><span class="glass-frame"><img src="${f.coverImage}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(LOC('faction.bio_alt', { NAME: f.name }))}"></span></center>`;
    }
    html += '<div class="faction-summary">' + f.biography + '</div>';
    html += '<button style="background-color: #ff9999; text-align: center;" onclick="openFactionMenu(\'' + factionKey + '\')">' + LOC('common.back') + '</button>';
    document.getElementById('main-panel').innerHTML = html;
};

// Readable text colors paired with FACTION_HISTORICAL_COLORS swatches
const FACTION_TEXT_COLORS = {
    'pdip':            '#9E1F14',
    'utusan_golongan': '#555555',
    'pkb':             '#005500',
    'poros_tengah':    '#004488',
    'ppp':             '#1E6840',
    'other_parties':   '#006068',
    'utusan_daerah':   '#555555',
    'golkar_habibie':  '#8A5A00',
    'golkar_akbar':    '#7D6000',
    'abri':            '#3E5022'
};

// Once Poros Tengah has formed (the Central Axis merge) it is drawn in Islamic green instead of PAN blue.
const POROS_TENGAH_MERGED_COLORS = { fill: '#0B7A3E', border: '#5FD08A', text: '#075E2E' };
function isPorosTengahFormed(key) {
    return key === 'poros_tengah' && typeof factions !== 'undefined' && Boolean(factions[key] && factions[key].hasMerged);
}
// Swatch colors of a faction (fill and border), with the merged Poros Tengah variant.
function getFactionColors(key) {
    const base = FACTION_HISTORICAL_COLORS[key];
    if (!base) return undefined;
    return isPorosTengahFormed(key) ? Object.assign({}, base, { fill: POROS_TENGAH_MERGED_COLORS.fill, border: POROS_TENGAH_MERGED_COLORS.border }) : base;
}
// Readable text color of a faction, with the merged Poros Tengah variant.
function getFactionTextColor(key) {
    return isPorosTengahFormed(key) ? POROS_TENGAH_MERGED_COLORS.text : FACTION_TEXT_COLORS[key];
}

// Decrees that change MPR composition, ban parties or rewrite rules are locked after the Accountability Speech
const POST_SPEECH_LOCKED_DECREES = new Set([
    'abolish_abri_mpr_seats',
    'dissolve_golkar_old_guard',
    'ban_pdip_subversion',
    'enforce_asas_tunggal_ban',
    'purge_utusan_golongan',
    'direct_presidential_amendment',
    'regional_autonomy',
    'maluku_irja_division',
    'civil_service_neutrality',
    'invoke_supersemar_ii',
    'cendana_restoration_pact'
]);

// Horse-trading fatigue counts and the last ticker message
window.horseTradeCounts = window.horseTradeCounts || {};
window.lastHorseTradeTicker = "";

// Turn number of the Accountability Speech
function getSpeechTurnNumber() {
    if (!events || events.length === 0) return 20;
    const idx = events.findIndex(e => e.id === 'ev_the_speech');
    return idx >= 0 ? (idx + 1) : Math.max(1, events.length - 2);
}

// True from the Accountability Speech (Oct 14) onward — locks seat decrees & non-final faction actions
function isPastAccountabilitySpeech() {
    return gameStarted && currentTurn >= getSpeechTurnNumber();
}

// True when no more faction engagements are allowed this turn. Before the Accountability Speech factions can be engaged
// any number of times (each one adds a surcharge); from the speech onward (including the Final Appeals) it is one per turn.
function isFactionLimitReached() {
    return turnFactionUsed && (isPastAccountabilitySpeech() || isNightOfLongKnivesTurn());
}

// Flat PC surcharge on the next faction engagement: the step times the engagements already held this turn. Always 0 from the speech onward.
function getFactionSurcharge() {
    if (isPastAccountabilitySpeech() || turnFactionCount <= 0) return 0;
    return Math.round(turnFactionCount * sysMod('factionEngageSurcharge', 5));
}

// True ONLY during the "Night of the Long Knives" (ev_eve_of_vote, Oct 18) turn
function isNightOfLongKnivesTurn() {
    if (!gameStarted || !events || currentTurn < 1 || currentTurn > events.length) return false;
    const ev = events[currentTurn - 1];
    return Boolean(ev && ev.id === 'ev_eve_of_vote');
}

// Senayan floor assessment is visible only from the Night of the Long Knives turn until the hide turn
const SENAYAN_ASSESSMENT_HIDE_TURN = 23;

// Turn number of the Night of the Long Knives
function getLongKnivesTurnNumber() {
    if (!events || events.length === 0) return Infinity;
    const idx = events.findIndex(e => e.id === 'ev_eve_of_vote');
    return idx >= 0 ? (idx + 1) : events.length;
}

// Whether the Senayan floor assessment is currently shown
function isSenayanAssessmentVisible() {
    return Boolean(gameStarted) &&
        currentTurn >= getLongKnivesTurnNumber() &&
        currentTurn < SENAYAN_ASSESSMENT_HIDE_TURN;
}

// Whether a decree is locked because the MPR has already convened
function isDecreeLockedBySession(decree) {
    if (!isPastAccountabilitySpeech() || !decree) return false;
    if (Array.isArray(decree.banFactions) && decree.banFactions.length > 0) return true;
    if (decree.seatChanges || decree.seatRecipients) return true;
    return POST_SPEECH_LOCKED_DECREES.has(decree.id);
}

// Hide a decree until the event named in its unlockEvent field is reached
function isDecreeEventUnlocked(decree) {
    if (!decree || !decree.unlockEvent) return true;
    if (!gameStarted || !events) return false;
    const idx = events.findIndex(e => e.id === decree.unlockEvent);
    if (idx < 0) return true;
    return currentTurn >= (idx + 1);
}

// True when the decree excludes, or is excluded by, a decree that is already enacted (the exclusion works in both directions)
function isDecreeBlockedByMutex(decree) {
    if (!decree) return false;
    if (Array.isArray(decree.mutexDecrees) && decree.mutexDecrees.some(id => activeDecrees[id] === true)) return true;
    return ((actionsData && actionsData.decrees) || []).some(d =>
        activeDecrees[d.id] === true && Array.isArray(d.mutexDecrees) && d.mutexDecrees.includes(decree.id));
}

// The three pillars of Golkar's A-B-G power structure. Each is broken by enacting its decree; only when all three are broken
// can the decrees flagged "reqGolkarPillars" (the ones that abolish Golkar seats) be enacted.
// What each standing pillar does until its decree is enacted
const GOLKAR_PILLAR_EFFECTS = {
    abriResistance: 0.15,  // A: share of every gain with a Golkar bloc that is lost
    pcMalus: 0.20,         // B: share of all Political Capital income that is lost
    cendanaDrift: 1        // G: Cendana Influence regained at the end of every turn
};
const GOLKAR_PILLARS = [
    { id: 'abri',      letter: 'A', decree: 'abolish_kodam_territorial' },
    { id: 'birokrasi', letter: 'B', decree: 'civil_service_neutrality' },
    { id: 'golkar',    letter: 'G', decree: 'anti_corruption' }
];

// Whether a pillar still stands and its penalty is active
function golkarPillarStands(pillarId) {
    const pillar = GOLKAR_PILLARS.find(p => p.id === pillarId);
    return Boolean(gameStarted && pillar && !isGolkarPillarBroken(pillar));
}

// Whether a pillar has been broken (its decree is in force)
function isGolkarPillarBroken(pillar) {
    return activeDecrees[pillar.decree] === true;
}

// Display name of a decree id (falls back to the id)
function getDecreeName(decreeId) {
    const d = actionsData.decrees && actionsData.decrees.find(x => x.id === decreeId);
    return d ? d.text : decreeId;
}

// The description box under the letters: what the pillar is, and which decree breaks it
function buildGolkarPillarDetailHTML(pillarId) {
    const pillar = GOLKAR_PILLARS.find(p => p.id === pillarId);
    if (!pillar) return '';
    const decreeName = getDecreeName(pillar.decree);
    const status = isGolkarPillarBroken(pillar)
        ? LOC('faction.golkar_pillars.broken', { DECREE: decreeName })
        : LOC('faction.golkar_pillars.prereq', { DECREE: decreeName });
    const effectVars = {
        RESIST: Math.round(GOLKAR_PILLAR_EFFECTS.abriResistance * 100),
        PCMALUS: Math.round(GOLKAR_PILLAR_EFFECTS.pcMalus * 100),
        DRIFT: GOLKAR_PILLAR_EFFECTS.cendanaDrift
    };
    const effect = isGolkarPillarBroken(pillar)
        ? LOC('faction.golkar_pillars.effect_lifted')
        : LOC('faction.golkar_pillars.' + pillar.id + '.effect', effectVars);
    return `<div class="golkar-pillar-titlebar">${LOC('faction.golkar_pillars.' + pillar.id + '.name')}</div>`
        + `<div class="golkar-pillar-body">${LOC('faction.golkar_pillars.' + pillar.id + '.desc')}<br><br>${effect}<br><br>${status}<br><br><i>${LOC('faction.golkar_pillars.unlock_note')}</i></div>`;
}

// Three big gold letters (A, B, G); tapping one shows its description below, tapping another switches it. A broken pillar's letter is dimmed.
function buildGolkarPillarsHTML() {
    const letters = GOLKAR_PILLARS.map(p => {
        const cls = 'golkar-pillar-letter' + (isGolkarPillarBroken(p) ? ' is-broken' : '') + (window.golkarPillarSelected === p.id ? ' is-selected' : '');
        const name = escapeHtml(LOC('faction.golkar_pillars.' + p.id + '.name'));
        return `<span class="${cls}" id="golkar-pillar-${p.id}" role="button" tabindex="0" aria-label="${name}" title="${name}" onclick="selectGolkarPillar('${p.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectGolkarPillar('${p.id}');}">${p.letter}</span>`;
    }).join('');
    const detail = window.golkarPillarSelected ? buildGolkarPillarDetailHTML(window.golkarPillarSelected) : '';
    return `<div class="golkar-pillars" role="group" aria-label="${escapeHtml(LOC('faction.golkar_pillars.label'))}">${letters}</div>`
        + `<div class="golkar-pillar-detail" id="golkar-pillar-detail" aria-live="polite"${detail ? '' : ' style="display:none;"'}>${detail}</div>`;
}

// Shows the description of the tapped pillar (tapping the open one again hides it)
window.selectGolkarPillar = function(pillarId) {
    window.golkarPillarSelected = (window.golkarPillarSelected === pillarId) ? null : pillarId;
    GOLKAR_PILLARS.forEach(p => {
        const el = document.getElementById('golkar-pillar-' + p.id);
        if (el) el.classList.toggle('is-selected', window.golkarPillarSelected === p.id);
    });
    const box = document.getElementById('golkar-pillar-detail');
    if (!box) return;
    if (window.golkarPillarSelected) {
        box.innerHTML = buildGolkarPillarDetailHTML(window.golkarPillarSelected);
        box.style.display = '';
    } else {
        box.style.display = 'none';
    }
};

// Check a decree's faction-loyalty requirements, waiving factions that were banned or merged away
function getDecreeFactionReqFailures(decree) {
    const fails = [];
    if (decree && decree.reqGolkarPillars) {
        GOLKAR_PILLARS.filter(p => !isGolkarPillarBroken(p)).forEach(p => {
            fails.push(LOC('faction.golkar_pillars.req', { PILLAR: LOC('faction.golkar_pillars.' + p.id + '.name'), DECREE: getDecreeName(p.decree) }));
        });
    }
    if (!decree || !Array.isArray(decree.reqFactions)) return fails;
    decree.reqFactions.forEach(req => {
        const f = factions[req.key];
        if (!f || f.seats <= 0 || bannedFactions[req.key]) return;
        const op = req.op || '>=';
        const ok = (op === '<=') ? (f.affinity <= req.val) : (f.affinity >= req.val);
        if (ok) return;
        const label = EFFECT_DISPLAY_NAMES[req.key] || req.key;
        const tier = getMoodData(req.key, req.val).text;
        fails.push(LOC(op === '<=' ? 'req.fall' : 'req.reach', { STAT: label, TIER: tier }));
    });
    return fails;
}

// Renders a color-coded faction pill with its historical party swatch (No leader names in parentheses, no stance text)
function renderColorCodedFactionTag(factionKey) {
    const f = factions[factionKey];
    if (!f) return '';
    const col = getFactionColors(factionKey) || { fill: '#808080' };
    const textCol = getFactionTextColor(factionKey) || '#111111';
    const cleanPartyName = (typeof stripLeaderParentheses === 'function')
        ? stripLeaderParentheses(f.name)
        : String(f.name).replace(/\s*\([^)]*\)/g, '').trim();

    return `<span class="faction-color-tag">
        <span class="faction-color-swatch" style="background-color: ${col.fill};"></span>
        <b style="color: ${textCol};">${cleanPartyName}</b>
    </span>`;
}

// Spend 1 PC (or 5 PC) to slightly nudge a faction's goodwill ONLY during Night of the Long Knives
window.lobbyDelegates = function(factionKey, pcToSpend = 1, returnView = 'action') {
    if (!gameStarted || !isActionPhase || !isNightOfLongKnivesTurn()) return;
    if (!factions[factionKey] || bannedFactions[factionKey] || factions[factionKey].seats <= 0) return;

    const overtures = (Number(pcToSpend) >= HORSE_TRADE_BLOC_OVERTURES) ? HORSE_TRADE_BLOC_OVERTURES : 1;
    if (factionKey === 'pdip' && window.OppositionEngine && OppositionEngine.isPdipLocked()) return;
    const cost = horseCostFor(factionKey, overtures);
    if (stats.PC < cost) {
        showCustomAlert(LOC('horse.exhausted'), null);
        return;
    }
    if (factions[factionKey].affinity >= 100) {
        showCustomAlert(LOC('horse.maxed', { NAME: factions[factionKey].name }), null);
        return;
    }

    prevStatsSnapshot = { ...stats };
    stats.PC = clampPC(stats.PC - cost);
    logPCChange(-cost, `horse_trade:${factionKey}`);

    const nationalMult = getHorseTradeNationalMult();
    const stanceMult = getHorseTradeReceptiveness(factionKey, factions[factionKey].affinity).mult;

    let totalGain = 0;
    window.horseTradeCounts[factionKey] = window.horseTradeCounts[factionKey] || 0;

    for (let i = 0; i < overtures; i++) {
        const priorUses = window.horseTradeCounts[factionKey];
        const fatigue = Math.max(0.55, 1 - (priorUses * 0.015));
        const jitter = 0.9 + (Math.random() * 0.2);
        totalGain += HORSE_TRADE_BASE_GAIN * nationalMult * stanceMult * fatigue * jitter;
        window.horseTradeCounts[factionKey]++;
    }

    if (factionKey === 'abri') {
        applyMilitaryDelta(totalGain);
    } else {
        totalGain *= (1 - currentMilitaryResistance());
        if (factionKey === 'pdip' && window.OppositionEngine) {
            totalGain *= OppositionEngine.getPdipGainMult();
            OppositionEngine.onPdipDelta(totalGain);
        }
        factions[factionKey].affinity = clampFaction(factionKey, factions[factionKey].affinity + totalGain);
    }

    lastRenderedPortraitSignature = "";
    saveCampaignState();
    updateUI();

    if (returnView === 'faction') {
        openFactionMenu(factionKey, true);
    } else {
        showActionMenu(true);
    }
};

// Build the horse-trading desk HTML
function renderHorseTradingDeskHTML(returnView = 'action') {
    let html = `<div class="horse-trade-box">
        <div class="music-header">${LOC('horse.title')}</div>`;

    for (let i = 0; i < portraitFactions.length; i++) {
        const key = portraitFactions[i];
        const f = factions[key];
        if (!f || f.seats <= 0 || bannedFactions[key]) continue;

        const tagHTML = renderColorCodedFactionTag(key);
        const recept = getHorseTradeReceptiveness(key, f.affinity);
        const maxed = f.affinity >= 100;
        const cost1 = horseCostFor(key, 1);
        const cost5 = horseCostFor(key, HORSE_TRADE_BLOC_OVERTURES);
        const streetLocked = key === 'pdip' && window.OppositionEngine && OppositionEngine.isPdipLocked();
        const canSpend1 = stats.PC >= cost1 && !maxed && !streetLocked;
        const canSpend5 = stats.PC >= cost5 && !maxed && !streetLocked;

        html += `<div class="horse-trade-row">
            <div class="horse-trade-info">
                ${tagHTML}
                <div style="font-size: 10.5px; color: #444; margin-top: 2px;">
                    ${LOC('horse.stance_line', { SEATS: f.seats, STANCE: `<font color="${recept.color}"><b>${recept.text}</b></font>` })}
                </div>
            </div>
            <div class="horse-trade-actions">
                <button type="button" class="horse-trade-btn" ${canSpend1 ? '' : 'disabled'} onclick="lobbyDelegates('${key}', 1, '${returnView}')">
                    ${LOC('horse.btn_single', { COST: cost1 })}
                </button>
                <button type="button" class="horse-trade-btn" ${canSpend5 ? '' : 'disabled'} onclick="lobbyDelegates('${key}', 5, '${returnView}')">
                    ${LOC('horse.btn_bloc', { COST: cost5 })}
                </button>
            </div>
        </div>`;
    }

    html += `</div>`;
    return html;
}

// Color-coded Palace Whip Intelligence Report for the final turns (no stance text)
function getPreVoteFactionStanceHTML() {
    if (!isSenayanAssessmentVisible()) return '';
    const backing = [];
    const hedging = [];
    const opposing = [];
    const indebtedTags = [];

    for (let i = 0; i < portraitFactions.length; i++) {
        const key = portraitFactions[i];
        const f = factions[key];
        if (!f || f.seats <= 0 || bannedFactions[key]) continue;

        const badge = renderColorCodedFactionTag(key);

        if (f.affinity >= 60) backing.push(badge);
        else if (f.affinity >= 42) hedging.push(badge);
        else opposing.push(badge);

        if (f.favor && f.favor > 0) {
            indebtedTags.push(badge);
        }
    }

    const cendanaNote = window.OppositionEngine ? OppositionEngine.getCendanaWhipNoteHTML() : "";

    return `<div class="pre-vote-whip-box">
        <div class="music-header">${LOC('senayan.title')}</div>
        <div style="padding: 8px 10px; font-size: 12px; line-height: 1.55; background-color: #DFDFDF; box-shadow: var(--bevel-sunken);">
            <div style="margin-bottom: 6px; background-color: #FFFFFF; padding: 5px 8px; box-shadow: var(--bevel-status-well);">
                ${LOC('senayan.summary', { PROJECTION: getVagueWhipProjection() + (window.whipTrendHTML || '') })}
            </div>

            <div class="whip-group-block">
                <span class="whip-group-title" style="color: #006400;">&#9632; ${LOC('senayan.backing')}</span>
                ${backing.length > 0 ? backing.join(' ') : `<i style="color:#555;">${LOC('senayan.backing_empty')}</i>`}
            </div>

            <div class="whip-group-block">
                <span class="whip-group-title" style="color: #B8860B;">&#9632; ${LOC('senayan.wavering')}</span>
                ${hedging.length > 0 ? hedging.join(' ') : `<i style="color:#555;">${LOC('senayan.wavering_empty')}</i>`}
            </div>

            <div class="whip-group-block" style="margin-bottom: 4px;">
                <span class="whip-group-title" style="color: #8B0000;">&#9632; ${LOC('senayan.opposing')}</span>
                ${opposing.length > 0 ? opposing.join(' ') : `<i style="color:#555;">${LOC('senayan.opposing_empty')}</i>`}
            </div>

            <div style="border-top: 1px dotted #808080; margin-top: 6px; padding-top: 5px; font-size: 11.5px;">
                <b>${LOC('senayan.favors_title')}</b>
                ${indebtedTags.length > 0
                    ? LOC('senayan.favors_some', { FACTIONS: indebtedTags.join(' ') })
                    : `<i style="color: #555;">${LOC('senayan.favors_none')}</i>`}
            </div>
            ${cendanaNote}
        </div>
    </div>`;
}

// Render the current event and its options
function renderEventMenu() {
    clearTallyInterval();
    scrollMainPanelToTop();
    const ev = events[currentTurn - 1];
    if (!ev) { returnToPreviousView(); return; }
    let html = '<h2>' + ev.title + '</h2>';
    if (ev.image) {
        html += `<center><span class="glass-frame"><img src="${ev.image}" class="event-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(ev.title)}"></span></center>`;
    }

    const cleanDesc = String(ev.desc || '').replace(/<br><br><font color="#0000FF"><b>Your speech tonight grants[\s\S]*?<\/b><\/font>/i, '');
    html += '<p style="text-align: justify; font-family: MS Sans Serif, sans-serif; font-size: 13px; line-height: 1.5; color: #333;">' + cleanDesc + '</p><br>';

    if (currentTurn >= getSpeechTurnNumber()) {
        html += getPreVoteFactionStanceHTML();
    }

    if (!ev.shuffledIndices) {
        const indices = [];
        for (let i = 0; i < ev.options.length; i++) indices.push(i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = indices[i];
            indices[i] = indices[j];
            indices[j] = temp;
        }
        ev.shuffledIndices = indices;
    }

    for (let i = 0; i < ev.shuffledIndices.length; i++) {
        const originalIndex = ev.shuffledIndices[i];
        const opt = ev.options[originalIndex];
        const effectString = (showOptionEffects && opt.effects) ? formatEffectString(opt.effects) : "";
        html += `<button onclick="resolveEvent(${originalIndex})">${opt.text}${effectString}</button>`;
    }

    document.getElementById('main-panel').innerHTML = html;
    saveCampaignState();
}

// Load the current turn: event phase or MPR session
function loadPhase() {
    if (currentTurn >= MAX_TURNS) {
        runElection();
        return;
    }
    isActionPhase = false;
    updateMobileBottomNav();
    turnExecutiveUsed = false;
    turnFactionUsed = false;
    turnFactionCount = 0;

    for (const key in actionCooldowns) {
        if (actionCooldowns[key] > 0) actionCooldowns[key]--;
    }

    for (const key in factionCooldowns) {
    if (factionCooldowns[key] > 0) factionCooldowns[key]--;
    }

    const ev = events[currentTurn - 1];
    if (ev && ev.id === 'ev_central_axis' && factions['poros_tengah'] && !bannedFactions['poros_tengah'] && !factions['poros_tengah'].hasMerged && factions['poros_tengah'].transformed) {
        factions['poros_tengah'].hasMerged = true;
        const panSeats = factions['poros_tengah'].seats;
        const pppSeats = (factions['ppp'] && !bannedFactions['ppp']) ? factions['ppp'].seats : 0;
        const pkbSeats = (factions['pkb'] && !bannedFactions['pkb']) ? factions['pkb'].seats : 0;
        const othTransfer = (factions['other_parties'] && !bannedFactions['other_parties']) ? Math.min(20, factions['other_parties'].seats) : 0;
        const totalMergedSeats = panSeats + pppSeats + pkbSeats + othTransfer;

        const panAff = factions['poros_tengah'].affinity;
        const pppAff = factions['ppp'] ? factions['ppp'].affinity : panAff;
        const pkbAff = factions['pkb'] ? factions['pkb'].affinity : panAff;
        const othAff = factions['other_parties'] ? factions['other_parties'].affinity : panAff;

        const weightedAffinity = totalMergedSeats > 0
            ? ((panAff * panSeats) + (pppAff * pppSeats) + (pkbAff * pkbSeats) + (othAff * othTransfer)) / totalMergedSeats
            : panAff;

        const t = factions['poros_tengah'].transformed;
        factions['poros_tengah'].name = t.name;
        factions['poros_tengah'].portraitName = t.portraitName || t.name;
        factions['poros_tengah'].seats = totalMergedSeats;
        factions['poros_tengah'].affinity = clampFaction('poros_tengah', weightedAffinity);
        factions['poros_tengah'].summary = t.summary;
        factions['poros_tengah'].biography = t.biography;
        factions['poros_tengah'].moods = t.moods;
        factions['poros_tengah'].interactions = t.interactions;

        const pppFavors = (factions['ppp'] && !bannedFactions['ppp']) ? (factions['ppp'].favor || 0) : 0;
        const pkbFavors = (factions['pkb'] && !bannedFactions['pkb']) ? (factions['pkb'].favor || 0) : 0;
        const rawFavors = pppFavors + pkbFavors;
        const inheritedFavor = Math.min(2, Math.floor(rawFavors * 0.5));
        factions['poros_tengah'].favor = Math.min(diffNum('maxFavor', 3), (factions['poros_tengah'].favor || 0) + inheritedFavor);

        if (factions['ppp']) factions['ppp'].seats = 0;
        const pppIndex = portraitFactions.indexOf('ppp');
        if (pppIndex > -1) portraitFactions.splice(pppIndex, 1);

        if (factions['pkb']) factions['pkb'].seats = 0;
        const pkbIndex = portraitFactions.indexOf('pkb');
        if (pkbIndex > -1) portraitFactions.splice(pkbIndex, 1);

        if (factions['other_parties'] && othTransfer > 0) {
            factions['other_parties'].seats = Math.max(0, factions['other_parties'].seats - othTransfer);
        }
    }

    renderEventMenu();
    updateUI();
}

// Apply the chosen option's effects and move on
window.resolveEvent = function(optIndex) {
    const ev = events[currentTurn - 1];
    if (!ev || window.resolvedEventTurn === currentTurn) return;
    const option = ev.options[optIndex];
    if (!option) return;
    window.resolvedEventTurn = currentTurn;

    const advHook = window.OppositionEngine ? OppositionEngine.onEventChoice(ev, optIndex, option) : null;
    const advSabotaged = Boolean(advHook && advHook.sabotaged);
    const advReaction = (option.reaction || '') + (advHook ? advHook.suffix : '');

    if (ev.id === 'ev_bank_bali' && optIndex === 0) bankBaliCleanSteps.frozeEGP = true;
    if (ev.id === 'ev_imf_ultimatum' && optIndex === 0) bankBaliCleanSteps.pwcAccess = true;
    if (ev.id === 'ev_imf_ultimatum' && optIndex === 4) bankBaliCleanSteps.defiedIMF = true;
    if (ev.id === 'ev_pwc_audit' && optIndex === 0) bankBaliCleanSteps.declassifiedPwC = true;

    if (!advSabotaged && ev.id === 'ev_referendum_countdown' && optIndex === 0) timorPromiseSteps.countdown = true;
    if (!advSabotaged && ev.id === 'ev_timor_votes' && optIndex === 0) timorPromiseSteps.votes = true;
    if (!advSabotaged && ev.id === 'ev_peacekeeper_decision' && (optIndex === 0 || optIndex === 1)) timorPromiseSteps.peacekeepers = true;

    if (ev.id === 'ev_assembly_convenes' && optIndex === 0) helpedRaisSpeaker = true;
    if (ev.id === 'ev_suharto_probe' && optIndex === 1 && stats.cendana >= 80) {
        sp3UpheldWithHighCendana = true;
    }

    let evEffects = advSabotaged ? advHook.effects : option.effects;
    if (evEffects) evEffects = scaleEffects(rollEffectRanges(evEffects), diffNum('eventPosMult', 1), diffNum('eventNegMult', 1));
    applyEffects(evEffects);
    updateUI();

    if (currentTurn >= events.length) {
        showCustomAlert(advReaction, () => {
            currentTurn++;
            runElection();
        });
    } else {
        isActionPhase = true;
        saveCampaignState();
        showCustomAlert(advReaction, showActionMenu);
    }
    if (window.OppositionEngine) OppositionEngine.flushPopups();
};

// End-of-turn economy: computes the malus or bonus from government stability and difficulty, applies passive PC income and drifts stats and faction affinities.
function rampDecreeFloors() {
    if (!actionsData || !Array.isArray(actionsData.decrees)) return;
    const statCap = sysMod('maxStatFloor', 90), facCap = sysMod('maxFactionFloor', 85);
    const statRamp = sysMod('floorRampStat', 4), facRamp = sysMod('floorRampFaction', 5);
    actionsData.decrees.forEach(d => {
        if (!activeDecrees[d.id] || !d.locks) return;
        if (d.locks.minStats) {
            for (const stat in d.locks.minStats) {
                if (stat === 'cendana' || stat === 'mil') continue;
                const target = Math.min(statCap, d.locks.minStats[stat]);
                if ((minStats[stat] || 0) < target) {
                    minStats[stat] = Math.min(target, (minStats[stat] || 0) + statRamp);
                    stats[stat] = clampDashboard(stat, stats[stat]);
                }
            }
        }
        if (d.locks.minFactions) {
            for (const fac in d.locks.minFactions) {
                if (!factions[fac] || bannedFactions[fac]) continue;
                const target = Math.min(facCap, d.locks.minFactions[fac]);
                if ((minFactions[fac] || 0) < target) {
                    minFactions[fac] = Math.min(target, (minFactions[fac] || 0) + facRamp);
                    factions[fac].affinity = clampFaction(fac, factions[fac].affinity);
                }
            }
        }
    });
}

function applyEndOfTurnEconomy() {
    rampDecreeFloors();
    const mods = gameConfig.systemModifiers;
    const diffDef = gameConfig.difficultySettings[selectedDifficulty];
    const govStability = getGovStability();

    let severityMalus = 0;
    let severityBonus = 0;

    if (govStability < mods.lowStatThreshold) {
        const deficit = mods.lowStatThreshold - govStability;
        severityMalus = Math.ceil(deficit / 5);
        const maxMalus = mods.maxGlobalMalus || 10.0;
        globalMalus = Math.min(maxMalus, globalMalus + (severityMalus * mods.malusMultiplier));
    } else if (govStability >= mods.highStatThreshold) {
        const highSurplus = govStability - mods.highStatThreshold;
        severityBonus = Math.ceil(highSurplus / 5);
        globalMalus = Math.max(0, globalMalus - (mods.malusDecayHigh || 1.5));
    } else {
        globalMalus = Math.max(0, globalMalus - (mods.malusDecayNormal || 0.5));
    }

    const cap = diffDef.malusCap;
    const currentDrain = Math.min(cap, globalMalus / 2);
    const pcPenalty = Math.floor(globalMalus * 0.75);

    let currentBonus = 0;
    if (severityBonus > 0) {
        currentBonus = Math.min(mods.maxBonusDrift, severityBonus * mods.bonusMultiplier);
    }

    let passivePC = (diffDef.passivePCMod || 0);
    if (govStability >= 60) {
        passivePC += severityBonus;
    } else if (govStability < 35 && cap > 0) {
        passivePC -= Math.min(3, Math.ceil((35 - govStability) / 8));
    }

    if (factions['golkar_habibie'] && !bannedFactions['golkar_habibie']) {
        if (factions['golkar_habibie'].affinity >= 70) {
            passivePC += 2;
        } else if (factions['golkar_habibie'].affinity < 40) {
            passivePC -= 1;
        }
    }

    if (passivePC > 0) passivePC = stochRound(passivePC * pcGainFactor());
    if (passivePC !== 0) {
        const nextPC = clampPC(stats.PC + passivePC);
        logPCChange(nextPC - stats.PC, 'end-of-turn passive ledger');
        stats.PC = nextPC;
    }

    // The Golkar machine keeps propping up the Cendana network while its pillar stands
    if (golkarPillarStands('golkar')) {
        stats.cendana = clampDashboard('cendana', stats.cendana + GOLKAR_PILLAR_EFFECTS.cendanaDrift);
    }

    if (stats.econ <= 20) {
        stats.pop = clampDashboard('pop', stats.pop - 2);
        stats.stab = clampDashboard('stab', stats.stab - 2);
    } else if (stats.econ >= 75) {
        stats.pop = clampDashboard('pop', stats.pop + 1);
        stats.stab = clampDashboard('stab', stats.stab + 1);
    }

    if (stats.intl <= 20) {
        stats.econ = clampDashboard('econ', stats.econ - 2);
    } else if (stats.intl >= 75) {
        stats.econ = clampDashboard('econ', stats.econ + 2);
    }

    if (stats.ref <= 20) {
        stats.stab = clampDashboard('stab', stats.stab - 2);
        stats.pop = clampDashboard('pop', stats.pop - 1);
    }

    let popDriftMod = 0;
    if (stats.pop >= 75) popDriftMod = 0.5;
    else if (stats.pop <= 20 && cap > 0) popDriftMod = -0.5;

    const netDrift = currentBonus - currentDrain + popDriftMod;

    for (const key in factions) {
        if (factions[key].seats <= 0 || bannedFactions[key]) continue;

        const noise = (Math.random() * 2.0) - 1.0;
        if (key === 'golkar_habibie' && netDrift < 0) {
            const loyalistDrain = Math.min(mods.loyalistDrainMitigation, Math.abs(netDrift));
            factions[key].affinity = clampFaction(key, factions[key].affinity - loyalistDrain + noise);
        } else {
            factions[key].affinity = clampFaction(key, factions[key].affinity + netDrift + noise);
        }
    }

    // Upkeep: support built far above a faction's starting stance slowly erodes unless it is maintained
    const driftRate = diffNum('factionDrift', 0);
    if (driftRate > 0) {
        for (const key in factions) {
            const f = factions[key];
            if (f.seats <= 0 || bannedFactions[key] || key === 'golkar_habibie') continue;
            if (typeof f.baseAffinity === 'number' && f.affinity > f.baseAffinity) {
                f.affinity = clampFaction(key, f.affinity - Math.min(driftRate, f.affinity - f.baseAffinity));
            }
        }
    }

    // The old regime's networks quietly rebuild toward their starting strength
    const regen = diffNum('cendanaRegen', 0);
    if (regen > 0 && stats.cendana < (diffDef.cendana || 0) && stats.cendana < maxCendana) {
        const whole = Math.floor(regen);
        const bump = whole + (Math.random() < (regen - whole) ? 1 : 0);
        if (bump > 0) stats.cendana = clampDashboard('cendana', stats.cendana + bump);
    }

    const gravityRate = 2;
    ['pop', 'ref', 'econ', 'intl', 'stab'].forEach(key => {
        if (stats[key] > 78) {
            stats[key] = clampDashboard(key, stats[key] - gravityRate);
        } else if (stats[key] < 22 && (selectedDifficulty === 'easy' || selectedDifficulty === 'medium')) {
            stats[key] = clampDashboard(key, stats[key] + 1);
        }
    });

    if (factions['abri']) {
        stats.mil = Math.round(factions['abri'].affinity);
    }

    return { pcPenalty: pcPenalty, passivePC: passivePC };
}

// Preview the malus or bonus that will apply at the end of this turn
function getCurrentPenaltyPreview() {
    const mods = gameConfig.systemModifiers;
    const govStability = getGovStability();
    let projectedMalus = globalMalus;
    if (govStability < mods.lowStatThreshold) {
        const deficit = mods.lowStatThreshold - govStability;
        projectedMalus = Math.min(mods.maxGlobalMalus || 10, globalMalus + Math.ceil(deficit / 5) * mods.malusMultiplier);
    }
    return Math.floor(projectedMalus * 0.75);
}

// Build the gazette listing the enacted decrees
function getStateGazetteHTML() {
    const enactedList = [];
    if (actionsData && Array.isArray(actionsData.decrees)) {
        actionsData.decrees.forEach(dec => {
            if (activeDecrees[dec.id]) {
                enactedList.push(`<span style="display: inline-block; background-color: #FFFFFF; padding: 2px 7px; margin: 2px 4px 2px 0; font-size: 11px; font-weight: bold; color: #000080; box-shadow: var(--bevel-status-well);">&#10003; ${dec.text}</span>`);
            }
        });
    }

    if (enactedList.length === 0) {
        return `<div class="state-gazette-box">
            <div style="font-size: 11px; font-weight: bold; color: #000080; margin-bottom: 3px;">${LOC('gazette.title')}</div>
            <div style="font-size: 11px; color: #555; font-style: italic;">${LOC('gazette.empty')}</div>
        </div>`;
    }

    return `<div class="state-gazette-box">
        <div style="font-size: 11px; font-weight: bold; color: #000080; margin-bottom: 4px;">${LOC('gazette.title')}</div>
        <div>${enactedList.join("")}</div>
    </div>`;
}

// Render the action phase menu
window.showActionMenu = function(preserveScroll = false) {
    clearTallyInterval();
    if (!preserveScroll) scrollMainPanelToTop();
    isActionPhase = true;
    updateMobileBottomNav();
    saveCampaignState();

    const pastSpeech = isPastAccountabilitySpeech();
    const isLongKnives = isNightOfLongKnivesTurn();

    let html = isLongKnives
        ? '<h2>' + LOC('horse.title') + '</h2>'
        : ('<h2>' + LOC(pastSpeech ? 'action.title_session' : 'action.title_default') + '</h2>');

    const goodLine = key => `<font color="#006400"><b>${LOC(key)}</b></font>`;
    const badLine = key => `<font color="#8B0000"><b>${LOC(key)}</b></font>`;

    const execLine = !turnExecutiveUsed ? goodLine('action.exec_available') : badLine('action.exec_used');

    let facLine = turnFactionCount === 0
        ? `<font color="#006400"><b>${LOC('action.faction_available', { STEP: sysMod('factionEngageSurcharge', 5) })}</b></font>`
        : `<font color="#B8860B"><b>${LOC('action.faction_used', { COUNT: turnFactionCount, SURCHARGE: getFactionSurcharge() })}</b></font>`;

    if (isLongKnives) {
        facLine = !turnFactionUsed
            ? goodLine('action.longknives_available')
            : `<font color="#000080"><b>${LOC('action.longknives_used')}</b></font>`;
    } else if (pastSpeech) {
        facLine = !turnFactionUsed ? goodLine('action.session_available') : badLine('action.session_used');
    }

    const tipLine = (idPrefix, style) =>
        `<span style="${style}">${LOC(idPrefix + '.line')}</span>`;

    const stabMod = getStabilityCostModifier();
    let frictionLine = tipLine('friction.normal', 'color: #333333;');
    if (stabMod > 0) {
        frictionLine = tipLine('friction.high', 'color: #8B0000; font-weight: bold;');
    } else if (stabMod < 0) {
        frictionLine = tipLine('friction.low', 'color: #006400; font-weight: bold;');
    }

    const malusDrag = getCurrentPenaltyPreview();
    let authorityLine = tipLine('authority.intact', 'color: #006400;');
    if (malusDrag >= 5) {
        authorityLine = tipLine('authority.paralysis', 'color: #8B0000; font-weight: bold;');
    } else if (malusDrag >= 3) {
        authorityLine = tipLine('authority.eroding', 'color: #FF4500; font-weight: bold;');
    } else if (malusDrag >= 1) {
        authorityLine = tipLine('authority.doubt', 'color: #B8860B;');
    }

    html += `<div style="background-color: #E0DFE3; border: 2px inset #FFFFFF; padding: 10px 12px; margin-bottom: 14px; font-size: 12px; line-height: 1.65;">
        • ${execLine}<br>
        • ${facLine}<br>
        • ${frictionLine}<br>
        • ${authorityLine}<br>
    </div>`;

    const routineImg = (gameConfig && gameConfig.routineActionsImage) ? gameConfig.routineActionsImage : 'photo/routine.png';
    const decreesImg = (gameConfig && gameConfig.decreesImage) ? gameConfig.decreesImage : 'photo/decree.png';
    const disabledCls = turnExecutiveUsed ? ' action-image-disabled' : '';
    const routineClick = turnExecutiveUsed ? '' : 'onclick="showRoutineActions()"';
    const decreesClick = turnExecutiveUsed ? '' : 'onclick="showDecreesMenu()"';

    html += `<div class="action-image-cards-grid">
        <div class="action-image-card${disabledCls}" ${routineClick}>
            <div class="action-image-frame">
                <span>${LOC('dash.photo_placeholder', { NAME: LOC('action.routine_photo') })}</span>
                <img src="${routineImg}" class="portrait-img" alt="[${LOC('action.routine_title')}]">
            </div>
            <div class="action-image-title">${LOC('action.routine_title')}</div>
        </div>

        <div class="action-image-card${disabledCls}" ${decreesClick}>
            <div class="action-image-frame">
                <span>${LOC('dash.photo_placeholder', { NAME: LOC('action.decrees_photo') })}</span>
                <img src="${decreesImg}" class="portrait-img" alt="[${LOC('action.decrees_title')}]">
            </div>
            <div class="action-image-title">${LOC('action.decrees_title')}</div>
        </div>
    </div>`;

    if (isLongKnives) {
        html += renderHorseTradingDeskHTML('action');
    } else if (!pastSpeech) {
        const newFactions = [];
        for (const key in factions) {
            const f = factions[key];
            if (f && f.seats > 0 && !bannedFactions[key] && f.interactions) {
                for (let i = 0; i < f.interactions.length; i++) {
                    if (f.interactions[i].minTurn === currentTurn) {
                        newFactions.push(`<span style="color: ${getFactionTextColor(key) || '#000080'};">${f.name}</span>`);
                        break;
                    }
                }
            }
        }

        if (newFactions.length > 0) {
            const factionListStr = LOC.list(newFactions);
            html += `<p style="margin: 8px 0;"><font face="MS Sans Serif" size="2" color="#0000FF"><b class="flashing-text-blue">${LOC('action.new_interactions', { NAME: factionListStr })}</b></font></p>`;
        }
    }

    html += getPreVoteFactionStanceHTML();
    html += getStateGazetteHTML();

    html += '<p style="margin-top: 10px; margin-bottom: 6px; text-align: center;"><font face="MS Sans Serif" size="2" color="#000080"><b>' + LOC('action.select_portrait') + '</b></font></p>';

    html += `<center><button style="width: 300px; text-align: center; background-color: #d0e8d0; margin-top: 6px;" onclick="finishActionPhase()">${LOC('action.next_turn')}</button></center>`;

    document.getElementById('main-panel').innerHTML = html;
};

// End the action phase and advance the turn
window.finishActionPhase = function() {
    applyEndOfTurnEconomy();
    if (window.OppositionEngine) OppositionEngine.onEndOfTurn();
    updateUI();
    nextTurn();
};

// Advance the turn automatically when no actions remain
function checkAutoAdvanceTurn() {
    if (isNightOfLongKnivesTurn() && stats.PC > 0) {
        showActionMenu();
        return;
    }
    const autoAdvance = !window.extraSettings || window.extraSettings.autoAdvanceTurn;
    if (turnExecutiveUsed && isFactionLimitReached() && autoAdvance) {
        finishActionPhase();
    } else {
        showActionMenu();
    }
}

// Tab ids for the routine and decree menus (labels are category.<id> in the language files).
// Older callers that pass the English label ('Economy', 'Civil Society', ...) still work.
function normalizeActionTab(tab) {
    const t = String(tab || '').toLowerCase().replace(/\s+/g, '_');
    return t || 'economy';
}

// Render the routine actions menu
window.showRoutineActions = function(activeTab = 'economy') {
    activeTab = normalizeActionTab(activeTab);
    scrollMainPanelToTop();
    if (turnExecutiveUsed) {
        showActionMenu();
        return;
    }

    let html = '<h2>' + LOC('action.routine_title') + '</h2>';

    const categories = {
        economy: [
            'taipans', 'privatization', 'bureaucratic_squeeze', 'economy',
            'urban_relief_program', 'foreign_roadshow', 'diaspora_outreach',
            'jps_expansion', 'batam_technopark', 'seize_cendana_tolls',
            'dakab_supersemar_bailout'
        ],
        civil_society: [
            'clerics', 'student_dialogue', 'trisakti_semanggi_commemoration',
            'chinatown_reconciliation', 'sbkri_review', 'ciganjur_dialogue',
            'womens_commission', 'declassify_1965_files'
        ],
        security: [
            'leak', 'military', 'kamra_deployment', 'kostrad_rotation',
            'maluku_peace_envoy', 'audit_kodam_foundations', 'mobilize_pam_swakarsa'
        ],
        politics: [
            'slushfund', 'campaign', 'address', 'icmi_caucus',
            'wednesday_cabinet', 'litsus_screening'
        ],
        regional_affairs: [
            'papua_dialogue', 'sultan_outreach', 'kalimantan_accord',
            'riau_kaltim_summit'
        ]
    };

    html += '<div class="category-tabs" style="margin-bottom: 15px; border-bottom: 2px solid #808080; padding-bottom: 5px; text-align: center;">';
    for (const cat in categories) {
        html += `<button class="${activeTab === cat ? 'is-selected' : ''}" style="width: auto; display: inline-block; margin: 2px; --py: 5px; --px: 10px; text-align: center;" onclick="showRoutineActions('${cat}')">${LOC('category.' + cat)}</button>`;
    }
    html += '</div>';

    let actionsInTabCount = 0;
    const pcPenaltyPreview = Math.floor(globalMalus * 0.75);
    const repeatDecay = gameConfig.systemModifiers.routineRepeatDecay || 0.15;

    if (actionsData && actionsData.routine) {
        actionsData.routine.forEach(action => {
            if (categories[activeTab] && categories[activeTab].includes(action.id)) {
                actionsInTabCount++;
                const timesUsed = actionUsageCount[action.id] || 0;
                const fatigueFactor = Math.max(0.4, 1 - (timesUsed * repeatDecay));
                let estPC = 0;
                if (action.dynamicPC) {
                    const rawEst = Math.round((action.dynamicPC.base * fatigueFactor) - pcPenaltyPreview);
                    estPC = Math.max(action.dynamicPC.min, rawEst > 0 ? Math.round(rawEst * pcGainFactor()) : rawEst);
                }

                let pcTierWord = LOC('routine.pc_tier.modest');
                if (estPC >= 20) pcTierWord = LOC('routine.pc_tier.substantial');
                else if (estPC >= 12) pcTierWord = LOC('routine.pc_tier.moderate');

                const pcBadge = action.dynamicPC
                    ? ` <span style="color: #0000FF; font-weight: bold;">${LOC('routine.grants_pc', { TIER: pcTierWord, FATIGUE: timesUsed > 0 ? LOC('routine.diminished') : '' })}</span>`
                    : '';

                let effectString = "";
                if (showOptionEffects) {
                    if (action.effects) effectString += formatEffectString(action.effects);
                    if (action.conditionalEffects) {
                        for (const cond of action.conditionalEffects) {
                            const statVal = stats[cond.condition.stat];
                            const isMatch = cond.condition.operator === '>=' ? (statVal >= cond.condition.value) : (statVal < cond.condition.value);
                            if (isMatch && cond.effects) {
                                effectString += formatEffectString(cond.effects);
                                break;
                            }
                        }
                    }
                    if (action.dynamicScaling) {
                        const scale = action.dynamicScaling;
                        const offsetVal = stats[scale.scaleFrom] + scale.scaleOffset;
                        const calcGain = Math.max(scale.min, scale.base + Math.floor(offsetVal / scale.scaleDivisor));
                        const dynObj = {};
                        dynObj[scale.target] = calcGain;
                        effectString += formatEffectString(dynObj);
                    }
                }

                let cooldownText = "";
                let disabledState = "";
                let btnStyle = "";

                if (actionCooldowns[action.id] > 0) {
                    disabledState = "disabled";
                    cooldownText = ` <span style="color: #8B0000; font-weight: bold; font-size: 10px; margin-left: 5px;">${LOC('routine.unavailable_for', { TURNS: actionCooldowns[action.id] })}</span>`;
                    btnStyle = "opacity: 0.5; cursor: not-allowed; filter: grayscale(100%);";
                }

                html += `<button ${disabledState} style="${btnStyle}" onclick="executeAction('${action.id}')">
                    <b>${action.short_name || LOC('routine.default_name')}</b>${pcBadge}${cooldownText}<br><br>
                    <span style="font-weight:normal;">${action.description}</span>${effectString}
                </button>`;
            }
        });
    }

    if (actionsInTabCount === 0) {
        html += '<p><font face="MS Sans Serif" size="2"><i>' + LOC('routine.none') + '</i></font></p>';
    }

    html += '<br><button style="background-color: #ff9999; text-align: center;" onclick="showActionMenu()">' + LOC('common.back') + '</button>';
    document.getElementById('main-panel').innerHTML = html;
};

// Render the decrees menu
window.showDecreesMenu = function(activeTab = 'economy') {
    activeTab = normalizeActionTab(activeTab);
    scrollMainPanelToTop();
    if (turnExecutiveUsed) {
        showActionMenu();
        return;
    }

    let html = '<h2>' + LOC('decrees.title') + '</h2>';

    if (isPastAccountabilitySpeech()) {
        html += `<div style="background-color: #FFF3CD; box-shadow: var(--bevel-sunken); padding: 8px 10px; align-items: justify; margin-bottom: 12px; font-size: 12px; color: #664D03;">
            <b>${LOC('decrees.session_locked_notice')}</b>
        </div>`;
    }

    const categories = {
        economy: [
            'economic_bailout', 'currency_board', 'central_bank_independence',
            'ibra_extraordinary_powers', 'imf_fuel_subsidy', 'imf_bulog_deregulation',
            'imf_ibra_liquidation', 'anti_monopoly_law', 'peoples_economy_charter',
            'timor_national_car_seizure'
        ],
        civil_society: [
            'political_prisoner_release', 'human_rights_commission_powers',
            'chinese_cultural_ban_repeal', 'broadcast_liberalization',
            'reinstate_siupp_censorship', 'purge_utusan_golongan'
        ],
        security: [
            'police_military_separation', 'civilian_defense_ministry',
            'ratify_kamra_militia_bill', 'abolish_kodam_territorial',
            'invoke_supersemar_ii'
        ],
        politics: [
            'anti_corruption', 'civil_service_neutrality',
            'direct_presidential_amendment', 'suharto_asset_seizure_tribunal',
            'abolish_abri_mpr_seats', 'dissolve_golkar_old_guard',
            'cendana_restoration_pact', 'ban_pdip_subversion',
            'enforce_asas_tunggal_ban', 'unify_golkar_slipi', 'rainbow_coalition_accord'
        ],
        regional_affairs: [
            'regional_autonomy', 'aceh_special_status_law', 'maluku_irja_division'
        ]
    };

    html += '<div class="category-tabs" style="margin-bottom: 15px; border-bottom: 2px solid #808080; padding-bottom: 5px; text-align: center;">';
    for (const cat in categories) {
        html += `<button class="${activeTab === cat ? 'is-selected' : ''}" style="width: auto; display: inline-block; margin: 2px; --py: 5px; --px: 10px; text-align: center;" onclick="showDecreesMenu('${cat}')">${LOC('category.' + cat)}</button>`;
    }
    html += '</div>';

    let allActiveInTab = true;
    let decreesInTabCount = 0;

    if (actionsData && actionsData.decrees) {
        actionsData.decrees.forEach(decree => {
            if (categories[activeTab] && categories[activeTab].includes(decree.id)) {
                if (!isDecreeEventUnlocked(decree)) return;
                decreesInTabCount++;
                const displayCost = computeDecreeCost(decree.baseCost);
                const isPassed = activeDecrees[decree.id] === true;
                const isSessionLocked = !isPassed && isDecreeLockedBySession(decree);

                const isMutexLocked = !isPassed && isDecreeBlockedByMutex(decree);

                const failReasons = [];

                if (decree.reqDecree && !activeDecrees[decree.reqDecree]) {
                    let reqName = decree.reqDecree;
                    const found = actionsData.decrees.find(d => d.id === decree.reqDecree);
                    if (found) reqName = found.text;
                    failReasons.push(LOC('req.decree', { NAME: reqName }));
                }

                const statReqs = [];
                if (decree.reqStat) statReqs.push(decree.reqStat);
                if (Array.isArray(decree.reqStats)) statReqs.push(...decree.reqStats);

                statReqs.forEach(req => {
                    const sk = req.key;
                    const sv = req.val;
                    const op = req.op || '>=';
                    const statLabel = EFFECT_DISPLAY_NAMES[sk] || sk.toUpperCase();
                    const tierLabel = getPlainStatTierName(sk, sv);

                    if (op === '>=' && stats[sk] < sv) {
                        failReasons.push(LOC(sk === 'cendana' ? 'req.cendana_strong' : 'req.reach', { STAT: statLabel, TIER: tierLabel }));
                    } else if (op === '<=' && stats[sk] > sv) {
                        failReasons.push(LOC(sk === 'cendana' ? 'req.cendana_reduce' : 'req.fall', { STAT: statLabel, TIER: tierLabel }));
                    }
                });

                getDecreeFactionReqFailures(decree).forEach(r => failReasons.push(r));

                if (Array.isArray(decree.banFactions)) {
                    const allAlreadyBanned = decree.banFactions.every(fk => bannedFactions[fk] || !factions[fk] || factions[fk].seats <= 0);
                    if (allAlreadyBanned && !isPassed) {
                        isMutexLocked = true;
                    }
                }

                if (isPassed || isMutexLocked || isSessionLocked) {
                    const overlayText = LOC(isPassed ? 'overlay.passed' : 'overlay.locked');
                    const overlayBg = isPassed ? "rgba(0, 140, 0, 0.22)" : "rgba(220, 20, 60, 0.25)";
                    const textColor = isPassed ? "rgba(0, 80, 0, 0.9)" : "rgba(139, 0, 0, 0.9)";
                    const flexLetters = Array.from(overlayText).map(char => `<span>${char}</span>`).join('');
                    const sessionNote = isSessionLocked
                        ? `<div style="margin-top: 6px; color: #8B0000; font-size: 11px; font-weight: bold;">${LOC('decrees.session_note')}</div>`
                        : '';

                    html += `<button disabled style="position: relative; cursor: not-allowed; text-align: left; overflow: hidden; margin-bottom: 8px; border-color: ${textColor};">
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 10; pointer-events: none; padding: 0 10px; box-sizing: border-box; background-color: ${overlayBg}; overflow: hidden;">
                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; font-family: 'MS Sans Serif', sans-serif; color: ${textColor}; font-size: clamp(35px, 6vw, 75px); mix-blend-mode: multiply; opacity: 0.85; text-shadow: 0px 0px 1px ${textColor}; pointer-events: none;">
                                ${flexLetters}
                            </div>
                        </div>
                        <div style="opacity: 0.65; position: relative; z-index: 1;">
                            <b>${decree.text}</b> ${LOC('common.cost', { COST: displayCost })}<br><br>
                            <span style="font-weight:normal;">${decree.description}</span>
                            ${sessionNote}
                        </div>
                    </button>`;
                } else if (failReasons.length > 0) {
                    allActiveInTab = false;
                    const reasonHtml = failReasons.map(r => `<li style="margin-bottom: 2px;">${r}</li>`).join('');
                    html += `<button disabled style="opacity: 0.5; cursor: not-allowed; filter: grayscale(100%); text-align: left; margin-bottom: 8px;">
                        <b>${decree.text}</b> ${LOC('common.cost', { COST: displayCost })} <span style="color: #8B0000; font-weight: bold; font-size: 10px; margin-left: 5px;">${LOC('common.unavailable')}</span><br><br>
                        <span style="font-weight:normal;">${decree.description}</span>
                        <div style="margin-top: 8px; color: #8B0000; font-family: 'MS Sans Serif', sans-serif; font-size: 11px; font-weight: bold;">
                            <ul style="margin: 0; padding-left: 20px;">${reasonHtml}</ul>
                        </div>
                    </button>`;
                } else {
                    allActiveInTab = false;
                    const canAfford = stats.PC >= displayCost;
                    const affordStyle = canAfford ? '' : 'opacity: 0.65;';
                    html += `<button style="${affordStyle}" onclick="executeDecree('${decree.id}')">
                        <b>${decree.text}</b> ${LOC('common.cost', { COST: displayCost })}<br><br>
                        <span style="font-weight:normal;">${decree.description}</span>
                    </button>`;
                }
            }
        });
    }

    if (decreesInTabCount === 0) {
        html += '<p><font face="MS Sans Serif" size="2"><i>' + LOC('decrees.none') + '</i></font></p>';
    } else if (allActiveInTab) {
        html += '<p><font face="MS Sans Serif" size="2" color="#8B0000"><i>' + LOC('decrees.all_done') + '</i></font></p>';
    }

    html += '<br><button style="background-color: #ff9999; text-align: center;" onclick="showActionMenu()">' + LOC('common.back') + '</button>';
    document.getElementById('main-panel').innerHTML = html;
};

// Render a faction's interaction menu
window.openFactionMenu = function(factionKey, preserveScroll = false) {
    if (!gameStarted) {
        showCustomAlert(LOC('faction.not_started'), null);
        return;
    }
    if (bannedFactions[factionKey] || (factions[factionKey] && factions[factionKey].seats <= 0)) {
        return;
    }
    if (!isActionPhase) {
        showCustomAlert(LOC('faction.resolve_first'), null);
        return;
    }

    if (!preserveScroll) scrollMainPanelToTop();
    const f = factions[factionKey];
    const mood = getMoodData(factionKey, f.affinity);
    const favorCount = f.favor || 0;
    const leverage = getFactionLeverage(factionKey);
    const pastSpeech = isPastAccountabilitySpeech();

    let favorDesc = LOC('faction.favor_none');
    if (favorCount === 1) favorDesc = LOC('faction.favor_one');
    else if (favorCount > 1) favorDesc = LOC('faction.favor_many', { COUNT: favorCount });

    let html = '<h2>' + LOC('faction.interact_title', { NAME: f.name }) + '</h2>';
    if (f.coverImage) {
        html += `<center><span class="glass-frame"><img src="${f.coverImage}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px;" alt="${escapeHtml(f.name)}"></span></center>`;
    }

    html += '<p><font face="MS Sans Serif" size="2"><b>' + LOC('faction.label.delegates') + '</b> ' + f.seats + '<br>';
    html += '<b>' + LOC('faction.label.stance') + '</b> <font color="' + mood.color + '"><b>' + mood.text + '</b></font><br>';

    html += '<b>' + LOC('faction.label.leverage') + '</b> <font color="' + leverage.color + '" title="' + escapeHtml(leverage.desc) + '"><b>' + leverage.text + '</b></font><br>';
    html += '<b>' + LOC('faction.label.favor') + '</b> <font color="#0000FF">' + favorDesc + '</font></p>';

    if (window.OppositionEngine) {
        if (factionKey === 'abri') {
            html += OppositionEngine.getMilitaryMeterHTML();
            if (!OppositionEngine.getMilitaryMeter()) console.warn('The military meter needs js/oppositionAI/tni.js (add its script tag after opposition.js).');
        } else {
            if (factionKey === 'pdip') {
                html += OppositionEngine.getPdipMeterHTML();
                if (!OppositionEngine.getPdipMeter()) console.warn('The street mobilization meter needs js/oppositionAI/pdip.js (add its script tag after opposition.js).');
            }
            html += OppositionEngine.getMilitaryResistanceNoteHTML();
        }
    }

    // Placeholder emblem for both Golkar blocs: the three pillars of the Jalur A-B-G (ABRI, Birokrasi, Golkar)
    if (factionKey.startsWith('golkar')) { window.golkarPillarSelected = null; html += buildGolkarPillarsHTML(); }

    html += '<div class="faction-summary">' + f.summary + '</div>';

    if (isFactionLimitReached()) {
        html += '<p><font face="MS Sans Serif" size="2" color="#8B0000"><b>' + LOC('faction.already_engaged') + '</b></font></p>';
    } else if (turnFactionCount > 0 && !pastSpeech) {
        html += '<p><font face="MS Sans Serif" size="2" color="#B8860B"><b>' + LOC('faction.surcharge_note', { COUNT: turnFactionCount, SURCHARGE: getFactionSurcharge() }) + '</b></font></p>';
    }

    let availableInteractions = [];
    if (f.interactions) {
        availableInteractions = f.interactions.filter(interaction => {
            const meetsMin = !interaction.minTurn || currentTurn >= interaction.minTurn;
            const meetsMax = !interaction.maxTurn || currentTurn <= interaction.maxTurn;
            return meetsMin && meetsMax;
        });
    }

    if (availableInteractions.length > 0) {
        const sortedInteractions = [...availableInteractions].sort((a, b) => {
            const aFinal = String(a.id || '').includes('final') ? 1 : 0;
            const bFinal = String(b.id || '').includes('final') ? 1 : 0;
            return bFinal - aFinal;
        });

        sortedInteractions.forEach(interaction => {
            const isFinalRequest = String(interaction.id || '').includes('final');
            const isLockedByPostSpeech = pastSpeech && !isFinalRequest;
            const displayCost = computeFactionActionCost(factionKey, interaction.cost);
            const effectString = (showOptionEffects && interaction.effects) ? formatEffectString(interaction.effects) : "";

            const failReasons = [];
            const meetsAffinity = interaction.minAffinity === undefined || f.affinity >= interaction.minAffinity;
            if (!meetsAffinity) {
                const reqMood = getMoodData(factionKey, interaction.minAffinity);
                failReasons.push(LOC('req.stance', { TIER: reqMood.text }));
            }

            const meetsDecree = interaction.reqDecree === undefined || activeDecrees[interaction.reqDecree] === true;
            if (!meetsDecree) {
                let reqDecreeName = LOC('req.decree_unknown');
                if (actionsData && actionsData.decrees) {
                    const foundDecree = actionsData.decrees.find(d => d.id === interaction.reqDecree);
                    if (foundDecree) reqDecreeName = foundDecree.text;
                }
                failReasons.push(LOC('req.decree', { NAME: reqDecreeName }));
            }

            let meetsStat = true;
            if (interaction.minStat) {
                const statKey = interaction.minStat.key;
                const statVal = interaction.minStat.val;
                const displayStatName = EFFECT_DISPLAY_NAMES[statKey] || statKey.toUpperCase();
                const reqTierName = getPlainStatTierName(statKey, statVal);

                if (statKey === 'cendana') {
                    if (stats[statKey] > statVal) {
                        meetsStat = false;
                        failReasons.push(LOC('req.stat_too_entrenched', { STAT: displayStatName, TIER: reqTierName }));
                    }
                } else {
                    if (stats[statKey] < statVal) {
                        meetsStat = false;
                        failReasons.push(LOC('req.stat_too_weak', { STAT: displayStatName, TIER: reqTierName }));
                    }
                }
            }

            const isConditionMet = meetsAffinity && meetsDecree && meetsStat;
            const isSided = !interaction.repeatable && completedInteractions[interaction.id];
            const isLocked = (interaction.mutexGroup && completedInteractions[interaction.mutexGroup] && !isSided) || isLockedByPostSpeech;

            const actionKey = factionKey + ':' + interaction.id;
            const currentCooldown = (typeof factionCooldowns !== 'undefined' && factionCooldowns[actionKey]) ? factionCooldowns[actionKey] : 0;

            if (isSided || isLocked) {
                const overlayText = LOC(isSided ? 'overlay.committed' : 'overlay.locked');
                const overlayBg = isSided ? "rgba(0, 160, 0, 0.25)" : "rgba(220, 20, 60, 0.25)";
                const textColor = isSided ? "rgba(0, 80, 0, 0.9)" : "rgba(139, 0, 0, 0.9)";
                const flexLetters = Array.from(overlayText).map(char => `<span>${char}</span>`).join('');

                const postSpeechNote = isLockedByPostSpeech
                    ? `<div style="margin-top: 6px; color: #8B0000; font-size: 11px; font-weight: bold;">${LOC('faction.post_speech_note')}</div>`
                    : '';

                html += `<button disabled style="position: relative; cursor: not-allowed; text-align: left; overflow: hidden; margin-bottom: 8px; border-color: ${textColor};">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 10; pointer-events: none; padding: 0 10px; box-sizing: border-box; background-color: ${overlayBg}; overflow: hidden;">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; font-family: 'MS Sans Serif', sans-serif; color: ${textColor}; font-size: clamp(35px, 6vw, 75px); mix-blend-mode: multiply; opacity: 0.85; text-shadow: 0px 0px 1px ${textColor}; pointer-events: none;">
                            ${flexLetters}
                        </div>
                    </div>
                    <div style="opacity: 0.65; position: relative; z-index: 1;">
                        <b>${interaction.text}</b> ${LOC('common.cost', { COST: displayCost })}<br><br>
                        <span style="font-weight:normal; display:block; text-align:justify;">${interaction.description}</span>
                        
                        ${postSpeechNote}
                    </div>
                </button>`;
            } else if (currentCooldown > 0) {
                html += `<button disabled style="opacity: 0.5; cursor: not-allowed; filter: grayscale(100%); text-align: left; margin-bottom: 8px;">
                    <b>${interaction.text}</b> ${LOC('common.cost', { COST: displayCost })} <span style="color: #8B0000; font-weight: bold; font-size: 10px; margin-left: 5px;">${LOC('faction.cooldown', { TURNS: currentCooldown })}</span><br><br>
                    <span style="font-weight:normal; display:block; text-align:justify;">${interaction.description}</span>
                </button>`;
            } else if (!isConditionMet) {
                const reasonHtml = failReasons.map(r => `<li style="margin-bottom: 2px;">${r}</li>`).join('');
                html += `<button disabled style="opacity: 0.5; cursor: not-allowed; filter: grayscale(100%); text-align: left; margin-bottom: 8px;">
                    <b>${interaction.text}</b> ${LOC('common.cost', { COST: displayCost })} <span style="color: #8B0000; font-weight: bold; font-size: 10px; margin-left: 5px;">${LOC('common.unavailable')}</span><br><br>
                    <span style="font-weight:normal; display:block; text-align:justify;">${interaction.description}</span>
                    <div style="margin-top: 8px; color: #8B0000; font-family: 'MS Sans Serif', sans-serif; font-size: 11px; font-weight: bold;">
                        <ul style="margin: 0; padding-left: 20px;">${reasonHtml}</ul>
                    </div>
                </button>`;
            } else {
                const isNew = (interaction.minTurn === currentTurn) || (pastSpeech && isFinalRequest);
                const btnClass = (isNew && !isFactionLimitReached()) ? ' class="new-action-btn" onmouseenter="this.classList.remove(\'new-action-btn\')"' : '';
                const disabledAttr = isFactionLimitReached() ? 'disabled style="opacity: 0.55; cursor: not-allowed;"' : '';

                html += `<button${btnClass} ${disabledAttr} onclick="executeFactionAction('${factionKey}', '${interaction.id}', ${displayCost})">
                    <b>${interaction.text}</b> ${LOC('common.cost', { COST: displayCost })}<br><br>
                    <span style="font-weight:normal; display:block; text-align:justify;">${interaction.description}</span>${effectString}
                </button>`;
            }
        });
    } else {
        html += '<p><font face="MS Sans Serif" size="2"><i>' + LOC('faction.no_interactions') + '</i></font></p>';
    }

    html += '<br><button onclick="showFactionBio(\'' + factionKey + '\')">' + LOC('faction.btn_info') + '</button>';
    html += '<button style="background-color: #ff9999; text-align: center;" onclick="showActionMenu()">' + LOC('common.back') + '</button>';
    document.getElementById('main-panel').innerHTML = html;
};

// Pay for and apply a faction interaction
window.executeFactionAction = function(factionKey, interactionId, finalCost) {
    if (isFactionLimitReached()) return;
    const isFinalAction = String(interactionId || '').includes('final');
    if (isPastAccountabilitySpeech() && !isFinalAction) {
        showCustomAlert(LOC('faction.session_closed'), null);
        return;
    }
    if (stats.PC < finalCost) {
        showCustomAlert(LOC('faction.insufficient_pc'), null);
        return;
    }

    const f = factions[factionKey];
    const interactionDef = f.interactions.find(i => i.id === interactionId);
    if (!interactionDef) return;

    let alertMsg = interactionDef.alertMsg || LOC('faction.default_alert');

    stats.PC = clampPC(stats.PC - finalCost);
    logPCChange(-finalCost, 'faction:' + factionKey + ':' + interactionId);
    turnFactionUsed = true;
    turnFactionCount++;
    if (factionKey === 'abri' && window.OppositionEngine) OppositionEngine.onMilitaryInteraction();
    if (factionKey === 'pdip' && window.OppositionEngine) OppositionEngine.onPdipInteraction();
    const milResAtStart = (factionKey !== 'abri') ? currentMilitaryResistance() : 0;

    if (!interactionDef.repeatable) {
        completedInteractions[interactionId] = true;
    }
    if (interactionDef.locksGroup && interactionDef.mutexGroup) {
        completedInteractions[interactionDef.mutexGroup] = true;
    }

    const actionKey = factionKey + ':' + interactionId;
    if (typeof factionUsageCount === 'undefined') window.factionUsageCount = {};
    if (typeof factionCooldowns === 'undefined') window.factionCooldowns = {};

    factionUsageCount[actionKey] = (factionUsageCount[actionKey] || 0) + 1;
    const timesUsed = factionUsageCount[actionKey];

    if (interactionDef.repeatable) {
        factionCooldowns[actionKey] = 3 + diffNum('cooldownBonus', 0);
    }


    let deltaFromLeverage = 0;
    const leverage = getFactionLeverage(factionKey);

    if (interactionDef.effects) {
        const effectsToApply = rollEffectRanges(interactionDef.effects);

        if (effectsToApply[factionKey] && effectsToApply[factionKey] > 0) {
            const originalVal = effectsToApply[factionKey];
            const repeatMult = interactionDef.repeatable
                ? Math.max(sysMod('factionRepeatFloor', 0.5), 1 - (timesUsed - 1) * sysMod('factionRepeatDecay', 0.2))
                : 1;
            const levMult = leverage.gainMult;
            const modifiedVal = Math.max(1, Math.round(originalVal * levMult * repeatMult * diffNum('gainMult', 1)));
            deltaFromLeverage = Math.round(originalVal * levMult) - originalVal;
            effectsToApply[factionKey] = modifiedVal;
        }
        applyEffects(effectsToApply);
    }

    let favorBonus = 0;
    if (isFinalAction && f.favor > 0) {
        favorBonus = Math.min(28, Math.round(Math.sqrt(f.favor) * 14));
        if (factionKey === 'abri' && window.OppositionEngine) favorBonus = Math.round(favorBonus * OppositionEngine.getMilitaryGainMult());
        else if (milResAtStart > 0) favorBonus = Math.round(favorBonus * (1 - milResAtStart));
        if (factionKey === 'pdip' && window.OppositionEngine) favorBonus = Math.round(favorBonus * OppositionEngine.getPdipGainMult());
        f.favor = 0;
        f.affinity = clampFaction(factionKey, f.affinity + favorBonus);
        if (factionKey === 'pdip' && window.OppositionEngine) OppositionEngine.onPdipDelta(favorBonus);
    }

    if (factions['abri']) {
        stats.mil = Math.round(factions['abri'].affinity);
    }

    saveCampaignState();
    updateUI();

    if (deltaFromLeverage > 0) {
        alertMsg += `<br><br><font color="#006400"><b>${LOC('faction.leverage_boost')}</b></font>`;
    } else if (deltaFromLeverage < 0) {
        alertMsg += `<br><br><font color="#8B0000"><b>${LOC('faction.leverage_blunt')}</b></font>`;
    }

    if (favorBonus > 0) {
        alertMsg += `<br><br><font color="#0000FF"><b>${LOC('faction.favor_redeemed')}</b></font>`;
    }
    if (milResAtStart > 0) {
        alertMsg += `<br><br><font color="#8B0000"><b>${LOC('military.blunted', { RES: Math.round(milResAtStart * 100) })}</b></font>`;
    }

    showCustomAlert(alertMsg, checkAutoAdvanceTurn);
    if (window.OppositionEngine) OppositionEngine.flushPopups();
};

// Pay for and enact a decree
window.executeDecree = function(type) {
    if (turnExecutiveUsed) return;
    const decreeDef = actionsData.decrees ? actionsData.decrees.find(d => d.id === type) : null;
    if (!decreeDef) return;

    if (isDecreeLockedBySession(decreeDef)) {
        showCustomAlert(LOC('decree.session_locked'), null);
        return;
    }
    if (!isDecreeEventUnlocked(decreeDef) || getDecreeFactionReqFailures(decreeDef).length > 0) {
        showCustomAlert(LOC('decree.conditions_unmet'), null);
        return;
    }

    const actionCost = computeDecreeCost(decreeDef.baseCost);
    if (stats.PC < actionCost) {
        showCustomAlert(LOC('decree.insufficient_pc'), null);
        return;
    }

    stats.PC = clampPC(stats.PC - actionCost);
    logPCChange(-actionCost, 'decree:' + type);
    activeDecrees[type] = true;
    turnExecutiveUsed = true;

    const advSeatSnap = window.OppositionEngine ? OppositionEngine.snapshotSeats() : null;

    if (Array.isArray(decreeDef.banFactions)) {
        let totalBannedSeats = 0;
        decreeDef.banFactions.forEach(fk => {
            bannedFactions[fk] = true;
            if (factions[fk] && factions[fk].seats > 0) {
                totalBannedSeats += factions[fk].seats;
                factions[fk].seats = 0;
                factions[fk].favor = 0;
            }
        });

        const vacatedSeats = Math.max(0, Math.min(totalBannedSeats, Number(decreeDef.seatsVacated) || 0));
        const transferableSeats = totalBannedSeats - vacatedSeats;

        if (decreeDef.seatRecipients && transferableSeats > 0) {
            const recipientKeys = Object.keys(decreeDef.seatRecipients).filter(rk => factions[rk] && !bannedFactions[rk]);
            let weightTotal = 0;
            recipientKeys.forEach(rk => { weightTotal += decreeDef.seatRecipients[rk]; });

            let seatsDistributed = 0;
            recipientKeys.forEach((rk, idx) => {
                if (idx === recipientKeys.length - 1) {
                    factions[rk].seats += (transferableSeats - seatsDistributed);
                } else {
                    const share = Math.round((decreeDef.seatRecipients[rk] / weightTotal) * transferableSeats);
                    factions[rk].seats += share;
                    seatsDistributed += share;
                }
            });
        }
    }

    if (decreeDef.seatChanges) {
        for (const facKey in decreeDef.seatChanges) {
            if (factions[facKey] && !bannedFactions[facKey]) {
                factions[facKey].seats = Math.max(0, factions[facKey].seats + decreeDef.seatChanges[facKey]);
            }
        }
    }

    if (window.OppositionEngine) OppositionEngine.recordSeatTransfer(advSeatSnap, type);

    const locks = decreeDef.locks;
    if (locks) {
        prevStatsSnapshot = { ...stats };
        if (locks.statPenalties) {
            applyEffects(locks.statPenalties, false);
        }
        if (locks.factionPenalties) {
            applyEffects(locks.factionPenalties, false);
        }
        if (locks.minStats) {
            for (const stat in locks.minStats) {
                // Soft floor: the guard starts close to the current value and ramps up each turn (see rampDecreeFloors)
                const target = Math.min(sysMod('maxStatFloor', 90), locks.minStats[stat]);
                const startFloor = Math.min(target, (stats[stat] || 0) + sysMod('floorEnactGrant', 5));
                minStats[stat] = Math.max(minStats[stat] || 0, startFloor);
                stats[stat] = clampDashboard(stat, Math.max(stats[stat], minStats[stat]));
            }
        }
        if (locks.maxCendana !== undefined) {
            maxCendana = Math.min(maxCendana, locks.maxCendana);
            stats.cendana = clampDashboard('cendana', Math.min(stats.cendana, maxCendana));
        }
        if (locks.minFactions) {
            for (const fac in locks.minFactions) {
                const target = Math.min(sysMod('maxFactionFloor', 85), locks.minFactions[fac]);
                const curAff = factions[fac] ? factions[fac].affinity : 0;
                minFactions[fac] = Math.max(minFactions[fac] || 0, Math.min(target, curAff + sysMod('factionFloorEnactGrant', 8)));
                if (factions[fac]) {
                    factions[fac].affinity = clampFaction(fac, Math.max(factions[fac].affinity, minFactions[fac]));
                }
            }
        }
    }

    if (factions['abri']) {
        stats.mil = Math.round(factions['abri'].affinity);
    }

    if (window.OppositionEngine) OppositionEngine.onDecreeEnacted(type, decreeDef);

    lastRenderedPortraitSignature = "";
    saveCampaignState();
    updateUI();
    showCustomAlert(decreeDef.alertMsg || LOC('decree.default_alert'), checkAutoAdvanceTurn);
    if (window.OppositionEngine) OppositionEngine.flushPopups();
};

// Pay for and apply a routine action
window.executeAction = function(type) {
    if (turnExecutiveUsed) return;
    const actionDef = actionsData.routine ? actionsData.routine.find(a => a.id === type) : null;
    if (!actionDef) return;

    turnExecutiveUsed = true;
    prevStatsSnapshot = { ...stats };
    const pcPenalty = Math.floor(globalMalus * 0.75);
    const timesUsed = actionUsageCount[type] || 0;
    const repeatDecay = gameConfig.systemModifiers.routineRepeatDecay || 0.15;
    const fatigueFactor = Math.max(0.4, 1 - (timesUsed * repeatDecay));
    actionUsageCount[type] = timesUsed + 1;

    // Security routine outreach to the Armed Forces also steadies the generals' patience for the turn
    if ((type === 'military' || type === 'kostrad_rotation') && window.OppositionEngine) {
        OppositionEngine.onMilitaryInteraction();
    }

    let alertMsg = actionDef.alertMsg || "";

    const effFatigue = Math.max(sysMod('routineEffectFloor', 0.55), 1 - timesUsed * sysMod('routineEffectDecay', 0.08));
    const fatigued = (e) => (effFatigue < 1) ? scaleEffects(rollEffectRanges(e), effFatigue, 1) : e;

    if (actionDef.effects) applyEffects(fatigued(actionDef.effects), false);

    if (actionDef.conditionalEffects) {
        for (const cond of actionDef.conditionalEffects) {
            const statVal = stats[cond.condition.stat];
            let isMatch = false;
            if (cond.condition.operator === '>=') isMatch = (statVal >= cond.condition.value);
            else if (cond.condition.operator === '<') isMatch = (statVal < cond.condition.value);

            if (isMatch) {
                if (cond.effects) applyEffects(fatigued(cond.effects), false);
                if (cond.alertMsg) alertMsg = cond.alertMsg;
                break;
            }
        }
    }

    if (actionDef.dynamicScaling) {
        const scale = actionDef.dynamicScaling;
        const offsetVal = stats[scale.scaleFrom] + scale.scaleOffset;
        const calculatedGain = scale.base + Math.floor(offsetVal / scale.scaleDivisor);
        const finalGain = Math.max(scale.min, calculatedGain);

        const dynamicEffect = {};
        dynamicEffect[scale.target] = finalGain;
        applyEffects(dynamicEffect, false);

        if (actionDef.alertMsgs) {
            alertMsg = (finalGain > 0) ? actionDef.alertMsgs.success : actionDef.alertMsgs.failure;
        }
    }

    if (actionDef.dynamicPC) {
        let rawPC = Math.round((actionDef.dynamicPC.base * fatigueFactor) - pcPenalty);
        if (rawPC > 0) rawPC = stochRound(rawPC * pcGainFactor());
        const pcGained = Math.max(actionDef.dynamicPC.min, rawPC);
        const nextPC = clampPC(stats.PC + pcGained);
        logPCChange(nextPC - stats.PC, 'routine:' + type);
        stats.PC = nextPC;
        if (alertMsg.includes("{pcGained}")) {
            alertMsg = alertMsg.replace("{pcGained}", pcGained);
        }
    }

    actionCooldowns[type] = (actionDef.cooldown || 2) + diffNum('cooldownBonus', 0);

    saveCampaignState();
    updateUI();
    showCustomAlert(alertMsg, checkAutoAdvanceTurn);
    if (window.OppositionEngine) OppositionEngine.flushPopups();
};

// Advance to the next turn
function nextTurn() {
    currentTurn++;
    loadPhase();
}