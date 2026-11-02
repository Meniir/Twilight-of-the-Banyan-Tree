// SUMMARY: Text lookup system. Every player-visible string lives in data/language/<folder>/*.json as "key": "text".
// Code fetches it with LOC('key', { VAR: value }). Supports $VAR$ variables, $other.key$ inlining, $$ for a literal dollar,
// §X...§! colour codes, English fallback for untranslated keys, and filling data-loc* attributes in the page.
// Must load before storage.js and game.js.
(function () {
    'use strict';

    // Folder that holds the language files, the manifest path, and the maximum depth for $key$ inlining.
    const ROOT = 'data/language/';
    const MANIFEST_URL = ROOT + 'languages.json';
    const MAX_NESTING = 8;

    // Colour letters usable as §<letter> ... §! inside strings.
    const COLORS = {
        R: '#8B0000',
        G: '#006400',
        g: '#009000',
        B: '#0000FF',
        N: '#000080',
        Y: '#B8860B',
        O: '#FF4500',
        W: '#FF5F15',
        F: '#B22222',
        I: '#004C97',
        P: '#C0392B',
        X: '#FF0000',
        K: '#000000',
        S: '#555555',
        // National stats (same colours as the tutorial and the stat panel). Political Capital uses B.
        D: '#D81B60',   // Popularity
        M: '#8E24AA',   // Reformasi Credibility
        E: '#1B7837',   // Economic Health
        T: '#00838F',   // International Standing
        A: '#37474F',   // National Stability
        L: '#556B2F',   // Military Support
        C: '#704D00'    // Cendana Influence
    };

    // Manifest used only when languages.json cannot be loaded.
    const FALLBACK_MANIFEST = {
        default: 'en',
        files: ['interface/ui.json', 'interface/gameplay.json', 'interface/stats_ui.json', 'interface/terms.json'],
        languages: { en: { folder: 'english', name: 'English', enabled: true } }
    };

    // Strings needed before any language file has loaded (loading screen and fatal error).
    const BUILTIN = {
        'loader.default_title': 'LOADING ASSETS',
        'loader.loading': 'Loading...',
        'error.fatal_title': 'Fatal Error Loading Assets',
        'error.fatal_body': 'Failed to fetch local JSON files. Check the console for missing files or syntax errors.'
    };

    // Runtime state: current language, loaded manifest, default-language and current-language dictionaries, debug flag, missing keys.
    const state = {
        lang: 'en',
        manifest: null,
        base: {},
        dict: {},
        debug: false,
        missing: {}
    };

    // Turns nested JSON objects into flat dotted keys, skipping keys that start with "_".
    function flatten(obj, prefix, out) {
        Object.keys(obj || {}).forEach(k => {
            if (k.charAt(0) === '_') return;
            const key = prefix ? prefix + '.' + k : k;
            const v = obj[k];
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
            else out[key] = Array.isArray(v) ? v.join('') : String(v);
        });
        return out;
    }

    // Fetches a JSON file and returns null on any failure.
    async function fetchJson(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    // Loads languages.json once (or falls back to the built-in manifest).
    async function loadManifest() {
        if (state.manifest) return state.manifest;
        const m = await fetchJson(MANIFEST_URL);
        state.manifest = (m && m.languages) ? m : FALLBACK_MANIFEST;
        return state.manifest;
    }

    // Fetches and merges every text file of one language folder; later files override earlier ones.
    async function loadFolder(folder, files) {
        const names = files.filter(f => typeof f === 'string' && f.trim() !== '');
        const parts = await Promise.all(names.map(f => fetchJson(ROOT + folder + '/' + f)));
        const out = {};
        parts.forEach((p, i) => {
            if (p && Array.isArray(p)) {
                console.warn('[LOC] ' + names[i] + ' is a data file, not a text file: remove it from "files" in languages.json');
                return;
            }
            if (p) flatten(p, '', out);
        });
        return out;
    }

    // Finds a key in the current language, then the default language, then the built-in strings.
    function lookup(key) {
        if (Object.prototype.hasOwnProperty.call(state.dict, key)) return state.dict[key];
        if (Object.prototype.hasOwnProperty.call(state.base, key)) return state.base[key];
        if (Object.prototype.hasOwnProperty.call(BUILTIN, key)) return BUILTIN[key];
        return undefined;
    }

    // Converts §X ... §! markers into coloured spans and closes any colour left open.
    function applyColors(text) {
        if (text.indexOf('\u00A7') === -1) return text;
        let open = 0;
        const out = text.replace(/\u00A7(.)/g, (m, c) => {
            if (c === '!') {
                if (open > 0) { open--; return '</span>'; }
                return '';
            }
            if (!COLORS[c]) return m;
            open++;
            return '<span style="color:' + COLORS[c] + ';">';
        });
        return out + '</span>'.repeat(open);
    }

    // Replaces $VAR$ with a passed variable or another key's text, and $$ with a literal dollar sign.
    function format(text, vars, depth) {
        return text.replace(/\$\$|\$([A-Za-z0-9_.]+)\$/g, (m, name) => {
            if (m === '$$') return '$';
            if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
                const v = vars[name];
                return (v === null || v === undefined) ? '' : String(v);
            }
            if (depth < MAX_NESTING && lookup(name) !== undefined) return render(name, vars, depth + 1);
            return m;
        });
    }

    // Produces the final text for a key, or "[key]" when it is missing.
    function render(key, vars, depth) {
        const raw = lookup(key);
        if (raw === undefined) {
            if (!state.missing[key]) {
                state.missing[key] = true;
                if (state.debug) console.warn('[LOC] missing key: ' + key);
            }
            return '[' + key + ']';
        }
        return applyColors(format(raw, vars, depth));
    }

    // Main lookup function: LOC('key', { VAR: value }).
    function LOC(key, vars) {
        if (state.debug) return '\u27E6' + key + '\u27E7';
        return render(String(key), vars, 0);
    }

    // True if the key exists in any dictionary.
    LOC.has = function (key) { return lookup(String(key)) !== undefined; };

    // Resolves data-file text: a value that is a key becomes its text, and inline $key$ references to known keys are filled in
    // (so a stance or tier name quoted in several places is written once). Unknown $NAME$ placeholders are left untouched.
    LOC.r = function (value, vars) {
        if (typeof value !== 'string') return value;
        if (lookup(value) !== undefined) return LOC(value, vars);
        if (value.indexOf('$') === -1) return value;
        return value.replace(/\$([A-Za-z0-9_.]+)\$/g, (m, name) => (lookup(name) !== undefined ? LOC(name, vars) : m));
    };

    // Joins items as "A", "A and B" or "A, B, and C" using the list.* keys.
    LOC.list = function (items) {
        const a = (items || []).filter(x => x !== null && x !== undefined && x !== '');
        if (a.length === 0) return '';
        if (a.length === 1) return String(a[0]);
        if (a.length === 2) return LOC('list.pair', { A: a[0], B: a[1] });
        return LOC('list.last', { LIST: a.slice(0, -1).join(LOC('list.separator')), LAST: a[a.length - 1] });
    };

    // Loads a language (with the default language as fallback), sets the page lang attribute and refreshes page text.
    LOC.load = async function (code, force) {
        const man = await loadManifest();
        const files = man.files || FALLBACK_MANIFEST.files;
        const defCode = man.default || 'en';
        const want = man.languages[code] ? code : defCode;

        if (force || Object.keys(state.base).length === 0) {
            state.base = await loadFolder(man.languages[defCode].folder, files);
        }
        state.dict = (want === defCode) ? state.base : await loadFolder(man.languages[want].folder, files);
        state.lang = want;
        state.missing = {};
        try {
            const hl = (man.languages[want] && man.languages[want].htmlLang) || want;
            document.documentElement.setAttribute('lang', hl);
        } catch (e) { }
        LOC.applyDOM();
        return want;
    };

    // Attributes that can be filled from language keys, mapped to the real HTML attribute they set.
    const DOM_ATTRS = { 'data-loc-title': 'title', 'data-loc-alt': 'alt', 'data-loc-placeholder': 'placeholder', 'data-loc-aria': 'aria-label' };

    // Strips tags and decodes entities so text can be used inside an attribute.
    function toPlainText(html) {
        const box = document.createElement('textarea');
        box.innerHTML = String(html).replace(/<[^>]*>/g, '');
        return box.value;
    }

    // Fills data-loc and data-loc-* elements in the page and sets the document title.
    LOC.applyDOM = function (root) {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        const scope = root || document;
        scope.querySelectorAll('[data-loc]').forEach(el => { el.innerHTML = LOC(el.getAttribute('data-loc')); });
        Object.keys(DOM_ATTRS).forEach(attr => {
            scope.querySelectorAll('[' + attr + ']').forEach(el => el.setAttribute(DOM_ATTRS[attr], toPlainText(LOC(el.getAttribute(attr)))));
        });
        if (!root && LOC.has('app.title')) {
            const title = toPlainText(LOC('app.title'));
            document.title = title;
            // The in-page title bar reads this variable, so it follows the selected language
            document.documentElement.style.setProperty('--app-title', JSON.stringify(title));
        }
    };

    // Lists the languages from languages.json as { code, name, folder, flag, enabled }.
    LOC.languages = function () {
        const man = state.manifest || FALLBACK_MANIFEST;
        return Object.keys(man.languages).map(code => ({
            code: code,
            name: man.languages[code].name || code,
            folder: man.languages[code].folder,
            flag: man.languages[code].flag || '',
            enabled: man.languages[code].enabled !== false
        }));
    };

    // Folder name of a language (the loaded one by default).
    LOC.folder = function (code) {
        const man = state.manifest || FALLBACK_MANIFEST;
        const l = man.languages[code || state.lang] || man.languages[man.default || 'en'];
        return l.folder;
    };

    // Folder name of the default (fallback) language.
    LOC.defaultFolder = function () {
        const man = state.manifest || FALLBACK_MANIFEST;
        return man.languages[man.default || 'en'].folder;
    };

    // Path of the folder that holds all language folders (used by game.js to find data files).
    LOC.root = ROOT;

    // Console helpers: current language code, raw-key debug mode, and the list of keys that were requested but not found.
    LOC.lang = function () { return state.lang; };
    LOC.setDebug = function (on) { state.debug = Boolean(on); };
    LOC.missing = function () { return Object.keys(state.missing); };

    window.LOC = LOC;
})();