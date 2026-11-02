// SUMMARY: Popup system and sound. Newspaper and browser-style popups for news dispatches, a queue for alerts, the sound-effects engine (Web Audio
// with fallback) and the global click sound.

// Popup state: pending callback, whether the popup is news, and queued alerts
let alertCallback = null;
let currentAlertIsNews = false;
const alertQueue = [];

// True while a popup alert is visible
function isAlertOpen() {
    const overlay = document.getElementById('custom-alert-overlay');
    return Boolean(overlay && overlay.style.display === 'flex');
}

// True on small screens or touch (coarse pointer) devices.
function isMobileDevice() {
    return window.innerWidth <= 820 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// AMBIENT WEB AUDIO ENGINE (Prevents ducking Spotify/music on mobile)
const SFX_PATHS = {
    click: 'audio/sfx/click.wav',
    notification: 'audio/sfx/notification.mp3',
    news: 'audio/sfx/news.mp3',
    achievement: 'audio/sfx/notif2.wav',
    blocked: 'audio/sfx/blocked.wav'
};

// Web Audio context, decoded buffers and fallback audio elements for sound effects
let sfxAudioCtx = null;
const sfxBuffers = {};
const sfxFallbackElements = {};

// Tell mobile browsers (iOS 17+ / mobile webviews) to mix audio without ducking Spotify
if (typeof navigator !== 'undefined' && navigator.audioSession) {
    try {
        navigator.audioSession.type = 'ambient';
    } catch (e) {}
}

// Create the shared audio context on first use
function getOrCreateAudioContext() {
    if (!sfxAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            sfxAudioCtx = new AudioCtx();
        }
    }
    if (sfxAudioCtx && sfxAudioCtx.state === 'suspended') {
        sfxAudioCtx.resume().catch(() => {});
    }
    return sfxAudioCtx;
}

// Fetch and decode all sound effect files
async function preloadSfxBuffers() {
    const ctx = getOrCreateAudioContext();
    for (const [key, path] of Object.entries(SFX_PATHS)) {
        try {
            const res = await fetch(path);
            if (!res.ok) continue;
            const arrayBuf = await res.arrayBuffer();
            if (ctx) {
                sfxBuffers[key] = await new Promise((resolve, reject) => {
                    ctx.decodeAudioData(arrayBuf, resolve, reject);
                });
            }
        } catch (e) {
            if (!isMobileDevice()) {
                sfxFallbackElements[key] = new Audio(path);
            }
        }
    }
}

// Preload sound effects on page load
window.addEventListener('load', preloadSfxBuffers);

// Play a sound effect by key through Web Audio, with an audio element fallback
function playSfxByKey(key, volumeMultiplier = 1.3) {
    try {
        if (typeof window.isSfxEnabled === 'function' && !window.isSfxEnabled()) return;

        const bgAudio = document.getElementById('bg-music');
        const baseVol = (bgAudio && typeof bgAudio.volume === 'number') ? bgAudio.volume : 0.4;
        const vol = Math.min(1.0, baseVol * volumeMultiplier);
        if (vol <= 0) return;

        if (typeof navigator !== 'undefined' && navigator.audioSession) {
            try { navigator.audioSession.type = 'ambient'; } catch (e) {}
        }

        const ctx = getOrCreateAudioContext();
        if (ctx && sfxBuffers[key]) {
            const source = ctx.createBufferSource();
            const gainNode = ctx.createGain();
            source.buffer = sfxBuffers[key];
            gainNode.gain.value = vol;
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            source.start(0);
            return;
        }

        if (!isMobileDevice()) {
            if (!sfxFallbackElements[key] && SFX_PATHS[key]) {
                sfxFallbackElements[key] = new Audio(SFX_PATHS[key]);
            }
            const el = sfxFallbackElements[key];
            if (el) {
                el.volume = vol;
                el.currentTime = 0;
                el.play().catch(() => {});
            }
        }
    } catch (e) {
        console.warn(e);
    }
}

// Play the popup notification sound
window.playPopupChime = function() {
    playSfxByKey('notification', 1.3);
};

// Play the achievement sound
window.playAchievementSfx = function() {
    playSfxByKey('achievement', 1.35);
};

// Play the sound for continuing past a news popup
window.playNewsContinueSfx = function() {
    playSfxByKey('news', 1.3);
};

// Play the blocked-action sound
window.playBlockedSfx = function() {
    playSfxByKey('blocked', 1.35);
};

// Play the click sound
window.playClickSfx = function() {
    if (isMobileDevice()) return;
    playSfxByKey('click', 1.0);
};

// Global click listener: plays blocked.wav on disabled/banned items, or click.wav on desktop
document.addEventListener('click', function(e) {
    if (e.target && e.target.closest) {
        const blockedEl = e.target.closest('button:disabled, .action-image-disabled, .portrait-banned, .mpr-legend-banned');
        if (blockedEl) {
            window.playBlockedSfx();
            return;
        }
    }
    window.playClickSfx();
}, true);

// Popups that are really "you can't do that" warnings play the blocked sound instead of the chime.
// They are recognised by the localized text of these keys, so detection works in every language.
const BLOCKED_ALERT_KEYS = [
    'faction.insufficient_pc', 'decree.insufficient_pc', 'faction.not_started',
    'faction.resolve_first', 'settings.backup_invalid', 'news.blocked.write_message'
];

// Helper to detect if a popup message is an insufficient-PC or blocked-action alert
function isBlockedAlertMessage(msg) {
    if (typeof msg !== 'string') return false;
    const lower = msg.toLowerCase();
    return BLOCKED_ALERT_KEYS.some(key => {
        if (!LOC.has(key)) return false;
        const text = LOC(key).replace(/[.\u3002]+$/, '').toLowerCase();
        return text.length > 0 && lower.indexOf(text) !== -1;
    });
}

// The structure (CSS classes, which source names match, the masthead layout) lives here.
// Every piece of text is a key in data/language: newspaper.<id>.<field>
// (window_title, dateline, left_meta, right_meta, footer, plus the masthead texts used below).
const NEWSPAPER_PROFILES = [
    {
        id: 'tempo', match: ['TEMPO'], paperClass: 'paper-tempo', headlineClass: '',
        masthead: n => `<div class="masthead-tempo">
            <div class="masthead-tempo-box">${n('title')}</div>
            <div class="masthead-tempo-motto">${n('motto')}</div>
        </div>`
    },
    {
        id: 'kompas', match: ['KOMPAS'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-kompas">
            <div class="masthead-kompas-ears">
                <span>${n('ear1')}</span>
                <span>${n('ear2')}</span>
                <span>${n('ear3')}</span>
            </div>
            <div class="masthead-kompas-title">${n('title')}</div>
        </div>`
    },
    {
        id: 'rakyat_merdeka', match: ['RAKYAT MERDEKA'], paperClass: 'paper-tabloid', headlineClass: 'headline-screaming',
        masthead: n => `<div class="masthead-rakyat-merdeka">
            <div class="masthead-rm-title">${n('title')}</div>
        </div>`
    },
    {
        id: 'pos_kota', match: ['POS KOTA'], paperClass: 'paper-tabloid', headlineClass: 'headline-screaming',
        masthead: n => `<div class="masthead-pos-kota">
            <div class="masthead-pk-title">${n('title')}</div>
        </div>`
    },
    {
        id: 'republika', match: ['REPUBLIKA'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-republika">
            <div class="masthead-republika-title">${n('title')}</div>
            <div class="masthead-republika-motto">${n('motto')}</div>
        </div>`
    },
    {
        id: 'jakarta_post', match: ['JAKARTA POST'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-jakarta-post">
            <div class="masthead-jp-title">${n('title')}</div>
            <div class="masthead-jp-motto">${n('motto')}</div>
        </div>`
    },
    {
        id: 'media_indonesia', match: ['MEDIA INDONESIA'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-media-indonesia">
            <div class="masthead-mi-title">${n('title')}</div>
        </div>`
    },
    {
        id: 'suara_pembaruan', match: ['SUARA PEMBARUAN'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-suara-pembaruan">
            <div class="masthead-sp-title">${n('title')}</div>
        </div>`
    },
    {
        id: 'detik', match: ['DETIK'], isBrowser: true
    },
    {
        id: 'suara_karya', match: ['SUARA KARYA'], paperClass: 'paper-broadsheet', headlineClass: '',
        masthead: n => `<div class="masthead-suara-karya">
            <div class="masthead-sk-title">${n('title')}</div>
        </div>`
    }
];

// Turn a profile definition into the object the renderers use, reading its text from the language files
function buildNewspaperProfile(def) {
    const n = field => LOC(`newspaper.${def.id}.${field}`);
    const opt = field => LOC.has(`newspaper.${def.id}.${field}`) ? n(field) : undefined;
    return {
        isBrowser: Boolean(def.isBrowser),
        windowTitle: n('window_title'),
        paperClass: def.paperClass,
        headlineClass: def.headlineClass,
        mastheadHTML: def.masthead ? def.masthead(n) : undefined,
        leftMeta: opt('left_meta'),
        rightMeta: opt('right_meta'),
        datelinePrefix: n('dateline'),
        editionFooter: opt('footer')
    };
}

// Pick the newspaper profile that matches a source name
window.getNewspaperProfile = function(rawSource) {
    const s = (rawSource || '').toUpperCase();

    for (let i = 0; i < NEWSPAPER_PROFILES.length; i++) {
        const def = NEWSPAPER_PROFILES[i];
        if (def.match.some(keyword => s.includes(keyword))) {
            return buildNewspaperProfile(def);
        }
    }

    if (s.includes('FORUM') || s.includes('GAMMA') || s.includes('PANJI')) {
        const magTitle = LOC('newspaper.magazine.' + (s.includes('GAMMA') ? 'gamma' : (s.includes('PANJI') ? 'panji' : 'forum')));
        return {
            isBrowser: false,
            windowTitle: magTitle,
            paperClass: "paper-tempo",
            headlineClass: "",
            mastheadHTML: `<div class="masthead-forum">
                <div class="masthead-forum-title">${magTitle}</div>
            </div>`,
            leftMeta: LOC('newspaper.magazine.left_meta'),
            rightMeta: LOC('newspaper.magazine.right_meta'),
            datelinePrefix: LOC('newspaper.magazine.dateline', { TITLE: magTitle }),
            editionFooter: LOC('newspaper.magazine.footer', { TITLE: magTitle })
        };
    }

    if (s.includes('BISNIS INDONESIA') || s.includes('KONTAN') || s.includes('FINANCIAL TIMES') || s.includes('WALL STREET') || s.includes('BLOOMBERG')) {
        return {
            isBrowser: false,
            windowTitle: s,
            paperClass: "paper-financial",
            headlineClass: "",
            mastheadHTML: `<div class="masthead-financial">
                <div class="masthead-fin-title">${s}</div>
            </div>`,
            leftMeta: LOC('newspaper.financial.left_meta'),
            rightMeta: LOC('newspaper.financial.right_meta'),
            datelinePrefix: LOC('newspaper.financial.dateline', { SOURCE: s }),
            editionFooter: LOC('newspaper.financial.footer')
        };
    }

    if (s.includes('WASPADA') || s.includes('SERAMBI')) {
        const acehPaper = LOC('newspaper.aceh.' + (s.includes('SERAMBI') ? 'serambi' : 'waspada'));
        return {
            isBrowser: false,
            windowTitle: acehPaper,
            paperClass: "paper-broadsheet",
            headlineClass: "",
            mastheadHTML: `<div class="masthead-waspada">
                <div class="masthead-waspada-title">${acehPaper}</div>
            </div>`,
            leftMeta: LOC('newspaper.aceh.left_meta'),
            rightMeta: LOC('newspaper.aceh.right_meta'),
            datelinePrefix: LOC('newspaper.aceh.dateline'),
            editionFooter: LOC('newspaper.aceh.footer', { TITLE: acehPaper })
        };
    }

    const foreignTitle = s || LOC('newspaper.foreign.default_title');
    return {
        isBrowser: false,
        windowTitle: foreignTitle,
        paperClass: "paper-broadsheet",
        headlineClass: "",
        mastheadHTML: `<div class="masthead-foreign">
            <div class="masthead-foreign-title">${foreignTitle}</div>
        </div>`,
        leftMeta: LOC('newspaper.foreign.left_meta'),
        rightMeta: LOC('newspaper.foreign.right_meta'),
        datelinePrefix: LOC('newspaper.foreign.dateline'),
        editionFooter: LOC('newspaper.foreign.footer')
    };
};

// Render standalone 1999 detikcom Mini Web Browser (No corner X)
function buildDetikBrowserHTML(profile, curDate, headline, bodyText) {
    return `<div class="detik-browser-window">
        <div class="detik-browser-titlebar">
            <span>&#127760; ${profile.windowTitle}</span>
        </div>

        <div class="detik-browser-menubar">
            <span>${LOC('news.browser.menu.file')}</span>
            <span>${LOC('news.browser.menu.edit')}</span>
            <span>${LOC('news.browser.menu.view')}</span>
            <span>${LOC('news.browser.menu.go')}</span>
            <span>${LOC('news.browser.menu.favorites')}</span>
            <span>${LOC('news.browser.menu.help')}</span>
        </div>

        <div class="detik-browser-toolbar">
            <span class="detik-tool-btn">${LOC('news.browser.tool.back')}</span>
            <span class="detik-tool-btn">${LOC('news.browser.tool.forward')}</span>
            <span class="detik-tool-btn">${LOC('news.browser.tool.stop')}</span>
            <span class="detik-tool-btn">${LOC('news.browser.tool.refresh')}</span>
            <span class="detik-tool-btn">${LOC('news.browser.tool.home')}</span>
        </div>

        <div class="detik-browser-addressbar">
            <span class="detik-addr-label">${LOC('news.browser.address_label')}</span>
            <div class="detik-addr-input">${LOC('news.browser.address_url')}</div>
        </div>

        <div class="detik-browser-viewport">
            <div class="detik-portal-banner">
                <div class="detik-portal-logo"><font color="#CC0000">detik</font><font color="#003399">com</font></div>
                <div class="detik-portal-tagline">${LOC('news.browser.tagline')}</div>
            </div>

            <div class="detik-portal-grid">
                <div class="detik-portal-sidebar">
                    <div class="detik-nav-header">${LOC('news.browser.nav_header')}</div>
                    <div class="detik-nav-item active">${LOC('news.browser.nav.top')}</div>
                    <div class="detik-nav-item">${LOC('news.browser.nav.national')}</div>
                    <div class="detik-nav-item">${LOC('news.browser.nav.mpr')}</div>
                    <div class="detik-nav-item">${LOC('news.browser.nav.economy')}</div>
                    <div class="detik-nav-item">${LOC('news.browser.nav.opinion')}</div>
                    <div class="detik-kurs-box">
                        ${LOC('news.browser.kurs_box')}
                    </div>
                </div>

                <div class="detik-portal-main">
                    <div class="detik-timestamp">${LOC('news.browser.timestamp', { DATE: curDate })}</div>
                    <div class="detik-article-headline">${headline}</div>
                    <div class="detik-article-body">
                        <b>${profile.datelinePrefix}</b>${bodyText}
                    </div>
                </div>
            </div>
        </div>

        <div class="detik-browser-footer">
            <div class="detik-status-well">${LOC('news.browser.status')}</div>
            <button type="button" class="detik-continue-btn" onclick="closeCustomAlert()">${LOC('news.continue')}</button>
        </div>
    </div>`;
}

// Render standalone Vertical Physical Newspaper / Magazine Front Page (No corner X)
function buildVerticalNewspaperHTML(profile, curDate, headline, bodyText) {
    return `<div class="standalone-newspaper-sheet ${profile.paperClass}">
        <div class="newspaper-top-trim"></div>
        ${profile.mastheadHTML}

        <div class="newspaper-dateline">
            <span>${profile.leftMeta}</span>
            <span>${curDate.toUpperCase()}</span>
            <span>${profile.rightMeta}</span>
        </div>

        <div class="newspaper-headline ${profile.headlineClass}">${LOC('news.headline_quote', { HEADLINE: headline })}</div>

        <div class="newspaper-subrule"></div>

        <div class="newspaper-body">
            <span class="newspaper-lead-city">${profile.datelinePrefix}</span>${bodyText}
        </div>

        <div class="newspaper-fold-crease"></div>

        <div class="newspaper-sheet-footer">
            <div class="newspaper-edition-meta">${profile.editionFooter || LOC('news.default_footer')}</div>
            <button type="button" class="newspaper-continue-btn" onclick="closeCustomAlert()">${LOC('news.continue')}</button>
        </div>
    </div>`;
}

// Show a popup (telex, news or plain alert), queuing it if one is already open
window.showCustomAlert = function(msg, callback) {
    if (isAlertOpen()) {
        alertQueue.push({ msg, callback });
        return;
    }

    if (isBlockedAlertMessage(msg)) {
        window.playBlockedSfx();
    } else {
        window.playPopupChime();
    }

    const curDate = (typeof gameStarted !== 'undefined' && gameStarted && typeof currentTurn !== 'undefined' && typeof events !== 'undefined' && currentTurn <= events.length && events[currentTurn - 1])
        ? events[currentTurn - 1].date
        : LOC('news.default_date');

    const alertBox = document.getElementById('custom-alert-box');
    const titleBar = document.getElementById('custom-alert-titlebar');
    const msgElem = document.getElementById('custom-alert-message');
    const defaultBtn = document.getElementById('custom-alert-btn');

    const newsMatch = (typeof msg === 'string')
        ? msg.match(/^([A-Z0-9\s.&'/\-]{2,45}):\s*['"](.+?)['"]\s*<br><br>([\s\S]+)$/i)
        : null;

    if (newsMatch) {
        currentAlertIsNews = true;
        const sourceName = newsMatch[1].trim();
        const headline = newsMatch[2].trim();
        const bodyText = newsMatch[3].trim();
        const profile = getNewspaperProfile(sourceName);

        if (alertBox) alertBox.className = profile.isBrowser ? 'alert-box-frameless mode-browser' : 'alert-box-frameless mode-newspaper';
        if (titleBar) titleBar.style.display = 'none';
        if (defaultBtn) defaultBtn.style.display = 'none';

        if (msgElem) {
            msgElem.className = 'frameless-message-container';
            msgElem.innerHTML = profile.isBrowser
                ? buildDetikBrowserHTML(profile, curDate, headline, bodyText)
                : buildVerticalNewspaperHTML(profile, curDate, headline, bodyText);
            msgElem.scrollTop = 0;
        }
    } else {
        currentAlertIsNews = false;
        if (alertBox) alertBox.className = '';
        if (titleBar) {
            titleBar.style.display = 'flex';
            titleBar.innerHTML = `<span>${LOC('news.dispatch_title')}</span><button type="button" class="win95-close-btn" onclick="closeCustomAlert()" title="${escapeHtml(LOC('news.close_tooltip'))}">&#10005;</button>`;
        }
        if (defaultBtn) defaultBtn.style.display = 'block';

        if (msgElem) {
            msgElem.className = '';
            msgElem.innerHTML = `<div class="telex-dispatch">
                <div class="telex-header">
                    <span>${LOC('news.telex_header')}</span>
                    <span>${curDate.toUpperCase()}</span>
                </div>
                <div style="text-align: justify; line-height: 1.55;">${msg}</div>
            </div>`;
            msgElem.scrollTop = 0;
        }
    }

    document.getElementById('custom-alert-overlay').style.display = 'flex';
    alertCallback = callback;
};

// Close the popup, run its callback and show the next queued alert
window.closeCustomAlert = function() {
    if (currentAlertIsNews) {
        window.playNewsContinueSfx();
        currentAlertIsNews = false;
    }

    document.getElementById('custom-alert-overlay').style.display = 'none';
    if (alertCallback) {
        const cb = alertCallback;
        alertCallback = null;
        try {
            cb();
        } catch (err) {
            console.error('Alert callback failed:', err);
        }
    }
    if (alertQueue.length > 0 && !isAlertOpen()) {
        const next = alertQueue.shift();
        showCustomAlert(next.msg, next.callback);
    }
};

// Allow Enter / Space / Escape to close any popup
document.addEventListener('keydown', function(e) {
    const overlay = document.getElementById('custom-alert-overlay');
    if (overlay && overlay.style.display === 'flex' && !e.repeat) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
            e.preventDefault();
            closeCustomAlert();
        }
    }
});