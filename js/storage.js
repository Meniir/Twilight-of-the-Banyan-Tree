// SUMMARY: All localStorage persistence: the automatic mid-run campaign save and resume, user settings
// (difficulty, audio, appearance, language, extended settings) and the list of unlocked achievements.
// Must load before achievements.js and game.js.

// localStorage keys for settings, achievements, custom wallpaper and the active campaign.
const SETTINGS_KEY = 'habibie_settings';
const ACHIEVEMENTS_KEY = 'habibie_achievements';
const CUSTOM_BG_KEY = 'habibie_custom_bg';
const CAMPAIGN_SAVE_KEY = 'habibie_active_campaign_v1';
const DIFFICULTY_WINS_KEY = 'habibie_difficulty_wins';

// Writes the whole running campaign (turn, stats, factions, decrees, cooldowns, achievement counters, opposition state) to localStorage.
window.saveCampaignState = function() {
    if (!gameStarted || currentTurn >= MAX_TURNS) return;
    try {
        const curEv = events[currentTurn - 1];
        const payload = {
            timestamp: Date.now(),
            currentTurn,
            isActionPhase,
            globalMalus,
            selectedDifficulty,
            ucnActive: window.sssActive || null,
            showOptionEffects,
            actionCooldowns,
            actionUsageCount,
            factionCooldowns: typeof factionCooldowns !== 'undefined' ? factionCooldowns : {},
            factionUsageCount: typeof factionUsageCount !== 'undefined' ? factionUsageCount : {},
            turnExecutiveUsed,
            turnFactionUsed,
            turnFactionCount,
            activeDecrees,
            bannedFactions,
            completedInteractions,
            minStats,
            maxCendana,
            minFactions,
            stats,
            factions,
            portraitFactions,
            lowestGovStability,
            bankBaliCleanSteps,
            timorPromiseSteps,
            sp3UpheldWithHighCendana,
            helpedRaisSpeaker,
            pcLog: window.pcLog || [],
            opposition: window.OppositionEngine ? OppositionEngine.getState() : null,
            lang: currentLang,
            curEventShuffledIndices: curEv ? curEv.shuffledIndices : null
        };
        localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(payload));
    } catch (e) { console.warn('Could not save campaign:', e); }
};

// Returns the saved campaign if a valid, unfinished one exists, otherwise null.
window.hasSavedCampaign = function() {
    try {
        const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data && data.currentTurn && data.currentTurn < MAX_TURNS && data.stats && data.factions) {
            return data;
        }
    } catch (e) { console.warn(e); }
    return null;
};

// Deletes the saved campaign.
window.clearCampaignSave = function() {
    try {
        localStorage.removeItem(CAMPAIGN_SAVE_KEY);
    } catch (e) { console.warn(e); }
};

// Restores the saved campaign into the game state (reloading its language first if needed) and resumes at the saved screen.
window.continueSavedCampaign = async function() {
    const data = hasSavedCampaign();
    if (!data) {
        showStartMenu();
        return;
    }

    clearTallyInterval();

    if (LOC.languages().some(l => l.enabled && l.code === data.lang) && data.lang !== currentLang) {
        currentLang = data.lang;
        saveUserSettings();
        await loadLocalizedAssets();
    }

    currentTurn = data.currentTurn || 1;
    isActionPhase = Boolean(data.isActionPhase);
    globalMalus = Number(data.globalMalus) || 0;
    selectedDifficulty = data.selectedDifficulty || selectedDifficulty;
    window.sssActive = null;
    if (selectedDifficulty === 'ucn' && window.SSS) SSS.restoreRun(data.ucnActive);
    if (typeof data.showOptionEffects === 'boolean') showOptionEffects = data.showOptionEffects;

    actionCooldowns = data.actionCooldowns || {};
    actionUsageCount = data.actionUsageCount || {};
    factionCooldowns = data.factionCooldowns || {};
    factionUsageCount = data.factionUsageCount || {};
    turnExecutiveUsed = Boolean(data.turnExecutiveUsed);
    turnFactionUsed = Boolean(data.turnFactionUsed);
    turnFactionCount = Number.isFinite(data.turnFactionCount) ? data.turnFactionCount : (turnFactionUsed ? 1 : 0);
    activeDecrees = data.activeDecrees || {};
    bannedFactions = data.bannedFactions || {};
    completedInteractions = data.completedInteractions || {};
    minStats = data.minStats || { pop: 0, mil: 0, ref: 0, econ: 0, intl: 0, stab: 0 };
    maxCendana = data.maxCendana !== undefined ? data.maxCendana : 100;
    minFactions = data.minFactions || {};
    stats = Object.assign({ PC: 20, pop: 30, mil: 35, ref: 40, econ: 20, intl: 30, stab: 25, cendana: 75 }, data.stats);
    factions = data.factions;
    portraitFactions = Array.isArray(data.portraitFactions) ? data.portraitFactions : [...INITIAL_PORTRAIT_FACTIONS];

    lowestGovStability = data.lowestGovStability !== undefined ? data.lowestGovStability : 100;
    bankBaliCleanSteps = data.bankBaliCleanSteps || {};
    timorPromiseSteps = data.timorPromiseSteps || {};
    sp3UpheldWithHighCendana = Boolean(data.sp3UpheldWithHighCendana);
    helpedRaisSpeaker = Boolean(data.helpedRaisSpeaker);
    window.pcLog = Array.isArray(data.pcLog) ? data.pcLog : [];

    if (window.OppositionEngine) OppositionEngine.restoreState(data.opposition || {});

    window.resolvedEventTurn = 0;
    window.electionPanelSnapshot = null;

    if (data.curEventShuffledIndices && events[currentTurn - 1]) {
        events[currentTurn - 1].shuffledIndices = data.curEventShuffledIndices;
    }

    prevStatsSnapshot = null;
    lastRenderedPortraitSignature = "";
    gameStarted = true;
    startBackgroundMusic();
    syncSidebarVisibility();
    updateUI();

    if (isActionPhase) {
        showActionMenu();
    } else {
        renderEventMenu();
    }
};

// Saves difficulty, audio, appearance, text size, language and extended settings under one key.
function saveUserSettings() {
    try {
        const audioElem = document.getElementById('bg-music');
        const payload = {
            selectedDifficulty,
            showOptionEffects,
            musicEnabled,
            volume: audioElem ? audioElem.volume : 0.3,
            volumeSet: Boolean(window.volumeUserSet),
            windowStyle,
            colorScheme,
            crtEnabled,
            crtIntensity,
            effects: effectsOn,
            textScale,
            currentLang,
            extra: getPersistableExtraSettings()
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch (e) { console.warn('Could not save settings:', e); }
}

// Returns the extended settings to save, replacing a "custom" wallpaper with "teal" when its image was not stored.
function getPersistableExtraSettings() {
    const extra = Object.assign({}, window.extraSettings || {});
    if (extra.desktopBg === 'custom') {
        let hasImage = false;
        try { hasImage = Boolean(localStorage.getItem(CUSTOM_BG_KEY)); } catch (e) { console.warn(e); }
        if (!hasImage) extra.desktopBg = 'teal';
    }
    return extra;
}

// Loads saved settings (defaulting the language to English) and applies the appearance and music player visibility.
function loadUserSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) {
            currentLang = 'en';
            return;
        }
        const s = JSON.parse(raw);
        if (s.selectedDifficulty) selectedDifficulty = s.selectedDifficulty;
        if (typeof s.showOptionEffects === 'boolean') showOptionEffects = s.showOptionEffects;
        if (typeof s.musicEnabled === 'boolean') musicEnabled = s.musicEnabled;
        if (WINDOW_STYLES[s.windowStyle]) windowStyle = s.windowStyle;
        if (COLOR_SCHEMES[s.colorScheme]) colorScheme = s.colorScheme;
        if (typeof s.crtEnabled === 'boolean') crtEnabled = s.crtEnabled;
        if (s.effects && typeof s.effects === 'object') {
            Object.keys(effectsOn).forEach(k => { if (typeof s.effects[k] === 'boolean') effectsOn[k] = s.effects[k]; });
        }
        if (s.extra && typeof s.extra === 'object' && window.extraSettings) {
            window.extraSettings = Object.assign({}, window.extraSettings, s.extra);
            if (typeof applyAccessibility === 'function') applyAccessibility();
        }
        if (s.crtIntensity !== undefined) crtIntensity = Number(s.crtIntensity);
        if (s.textScale !== undefined) textScale = Number(s.textScale);
        currentLang = (typeof s.currentLang === 'string' && /^[a-z]{2,3}$/.test(s.currentLang)) ? s.currentLang : 'en';

        const audioElem = document.getElementById('bg-music');
        if (audioElem && s.volume !== undefined && (s.volumeSet || Number(s.volume) !== 1)) {
            audioElem.volume = Number(s.volume);
            window.volumeUserSet = true;
        }
        applyAppearance();
        const player = document.querySelector('.music-player');
        if (player) {
            player.style.display = musicEnabled ? 'block' : 'none';
        }
    } catch (e) { console.warn(e); }
}

// Reads the list of unlocked achievement ids (empty list if missing or broken).
function loadUnlockedAchievements() {
    try {
        const list = JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

// Writes the list of unlocked achievement ids.
function saveUnlockedAchievements() {
    try {
        localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedAchievements));
    } catch (e) { console.warn(e); }
}

// Records a win on a difficulty (kept across runs). Returns true once Easy, Medium, High and Historical have all been won.
function recordDifficultyWin(difficulty) {
    const standard = ['easy', 'medium', 'high', 'historical'];
    try {
        let wins = JSON.parse(localStorage.getItem(DIFFICULTY_WINS_KEY) || '[]');
        if (!Array.isArray(wins)) wins = [];
        if (standard.includes(difficulty) && !wins.includes(difficulty)) {
            wins.push(difficulty);
            localStorage.setItem(DIFFICULTY_WINS_KEY, JSON.stringify(wins));
        }
        return standard.every(d => wins.includes(d));
    } catch (e) { return false; }
}