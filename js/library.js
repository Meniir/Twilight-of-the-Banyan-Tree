// SUMMARY: In-game Library glossary screen with a search box and category filter buttons.
// Screen text comes from the library.* language keys; entries (term, subtitle, desc, category, optional image, optional alt and altTitle) come from libraryData
// and may hold plain text or language keys. Clicking the portrait of an entry that has an alt text switches its description to that alternate text (titled by its own altTitle, e.g. Criticism or Controversies) and back. Entries in the persons and presidents categories get a portrait box.

// Current category filter (a category id) and current search text.
let currentLibraryCategory = 'all';
let currentLibrarySearch = '';

// Indexes (in libraryData) of the entries that currently show their alternate text instead of their description.
const libraryAltOpen = new Set();

// Category filter buttons. "legacy" is the English label that older library data used in its category field.
const LIBRARY_CATEGORIES = [
    { id: 'all',               legacy: 'All' },
    { id: 'persons',           legacy: 'Persons' },
    { id: 'presidents',        legacy: 'Presidents' },
    { id: 'institutions',      legacy: 'Institutions' },
    { id: 'laws_decrees',      legacy: 'Laws & Decrees' },
    { id: 'parties_factions',  legacy: 'Parties & Factions' },
    { id: 'military_security', legacy: 'Military & Security' },
    { id: 'economy_kkn',       legacy: 'Economy & KKN' },
    { id: 'society_movements', legacy: 'Society & Movements' },
    { id: 'political_terms',   legacy: 'Political Terms' }
];

// Turns a category id or legacy English label into a category id ('all' if unrecognised).
function normalizeLibraryCategory(cat) {
    const c = String(cat === null || cat === undefined ? '' : cat).trim().toLowerCase();
    const found = LIBRARY_CATEGORIES.find(x => x.id === c || x.legacy.toLowerCase() === c);
    return found ? found.id : 'all';
}

// Returns one entry field as text, resolving language keys.
function getLibraryText(item, field) {
    return LOC.r(item[field] || '');
}

// Renders the Library screen: title, search box, category buttons, entry list and back button.
window.showLibraryMenu = function(category = null, preserveScroll = false) {
    if (!enterMenuView()) return;
    if (!preserveScroll) scrollMainPanelToTop();
    if (category !== null) {
        currentLibraryCategory = normalizeLibraryCategory(category);
    }

    let html = `<center><h2>${LOC('library.title')}</h2></center>`;

    html += `<div class="library-controls-box">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; width: 100%;">
            <input type="text" id="library-search-input" class="library-search-input" style="width: 100%; flex: 1;" placeholder="${escapeHtml(LOC('library.search_placeholder'))}" value="${escapeHtml(currentLibrarySearch)}" oninput="filterLibraryEntries(this.value)">
            <button style="width: auto; display: inline-block; --py: 4px; --px: 12px; margin: 0; font-size: 11px; text-align: center; flex-shrink: 0;" onclick="clearLibrarySearch()">${LOC('library.clear')}</button>
        </div>
        <div style="text-align: center; border-top: 1px solid #808080; padding-top: 6px;">`;

    LIBRARY_CATEGORIES.forEach(cat => {
        const isCur = (currentLibraryCategory === cat.id);
        html += `<button class="${isCur ? 'is-selected' : ''}" style="width: auto; display: inline-block; margin: 2px; --py: 4px; --px: 9px; font-size: 11px;" onclick="selectLibraryCategory('${cat.id}')">${LOC('library.category.' + cat.id)}</button>`;
    });

    html += `</div></div>`;
    html += `<div id="library-entries-container">${renderLibraryEntriesHTML()}</div>`;
    html += `<center><button style="width: 250px; margin-top: 16px; background-color: #ff9999; text-align: center;" onclick="returnToPreviousView()">${gameStarted ? LOC('credits.btn.back_to_game') : LOC('common.back')}</button></center>`;

    document.getElementById('main-panel').innerHTML = html;
};

// Switches the category filter and redraws the screen without scrolling.
window.selectLibraryCategory = function(cat) {
    showLibraryMenu(cat, true);
};

// Updates the search text and refreshes only the entry list.
window.filterLibraryEntries = function(query) {
    currentLibrarySearch = query || '';
    const container = document.getElementById('library-entries-container');
    if (container) {
        container.innerHTML = renderLibraryEntriesHTML();
    }
};

// Switches one entry between its description and its alternate text while preserving the list's scroll position.
window.toggleLibraryAlt = function(idx) {
    if (libraryAltOpen.has(idx)) libraryAltOpen.delete(idx);
    else libraryAltOpen.add(idx);
    const container = document.getElementById('library-entries-container');
    if (container) {
        const well = container.querySelector('.library-list-well');
        const savedScrollTop = well ? well.scrollTop : 0;
        container.innerHTML = renderLibraryEntriesHTML();
        const newWell = container.querySelector('.library-list-well');
        if (newWell) newWell.scrollTop = savedScrollTop;
    }
};

// Clears the search box and refreshes the entry list.
window.clearLibrarySearch = function() {
    currentLibrarySearch = '';
    const input = document.getElementById('library-search-input');
    if (input) input.value = '';
    const container = document.getElementById('library-entries-container');
    if (container) {
        container.innerHTML = renderLibraryEntriesHTML();
    }
};

// Builds the HTML for entries matching the current category and search (term, subtitle or description), with count and empty/missing-data messages.
function renderLibraryEntriesHTML() {
    if (typeof libraryData === 'undefined' || !libraryData || libraryData.length === 0) {
        return `<div class="faction-summary" style="text-align: center; color: #8B0000;">${LOC('library.data_missing', { FILE: 'texts/library.json' })}</div>`;
    }

    const q = currentLibrarySearch.trim().toLowerCase();
    const filtered = libraryData.filter(item => {
        if (currentLibraryCategory !== 'all' && normalizeLibraryCategory(item.category) !== currentLibraryCategory) return false;
        if (!q) return true;
        return ['term', 'subtitle', 'desc', 'alt', 'altTitle'].some(f => getLibraryText(item, f).toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
        return `<div class="faction-summary" style="text-align: center; font-style: italic; color: #555;">${LOC('library.no_match', { QUERY: escapeHtml(currentLibrarySearch), CATEGORY: LOC('library.category.' + currentLibraryCategory) })}</div>`;
    }

    let html = `<div style="font-size: 11px; color: #444; margin-bottom: 6px; text-align: right;">${LOC(filtered.length === 1 ? 'library.showing_one' : 'library.showing_many', { COUNT: filtered.length })}</div>`;
    html += `<div class="library-list-well">`;

    filtered.forEach(item => {
        const term = getLibraryText(item, 'term');
        const subtitle = getLibraryText(item, 'subtitle');
        const desc = getLibraryText(item, 'desc');
        const normCat = normalizeLibraryCategory(item.category);
        const alt = getLibraryText(item, 'alt');
        const altTitle = getLibraryText(item, 'altTitle') || LOC('library.alt_label');
        const idx = libraryData.indexOf(item);
        const showAlt = Boolean(alt) && libraryAltOpen.has(idx);
        const bodyHTML = showAlt
            ? `<div class="library-entry-desc library-entry-alt">${normCat === 'presidents' ? '' : `<b>${altTitle}</b><br>`}${alt}</div>`
            : `<div class="library-entry-desc">${desc}</div>`;
        const hintHTML = alt
            ? `<div style="font-size: 10px; font-style: italic; color: #555; margin-top: 4px;">${showAlt ? LOC('library.portrait_hint_back') : LOC('library.portrait_hint', { TITLE: altTitle })}</div>`
            : '';
        const portraitAttrs = alt
            ? ` style="cursor: pointer;" title="${escapeHtml(showAlt ? LOC('library.portrait_hint_back') : LOC('library.portrait_hint', { TITLE: altTitle }))}" onclick="toggleLibraryAlt(${idx})"`
            : '';
        const hasPortrait = Boolean(item.image || normCat === 'persons' || normCat === 'presidents');
        const imgSrc = item.image || '';
        const shortLabel = escapeHtml((term || LOC('library.photo_fallback')).split('(')[0].trim().toUpperCase());

        if (hasPortrait) {
            html += `<div class="library-entry-card library-entry-with-portrait">
                <div class="library-person-portrait"${portraitAttrs}>
                    <span>${LOC('dash.photo_placeholder', { NAME: shortLabel })}</span>
                    ${imgSrc ? `<img src="${imgSrc}" class="portrait-img" alt="${shortLabel}" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="library-entry-content">
                    <div class="library-entry-header">
                        <span class="library-entry-term">${term}</span>
                    </div>
                    ${subtitle ? `<div class="library-entry-sub">${subtitle}</div>` : ''}
                    ${bodyHTML}
                    ${hintHTML}
                </div>
            </div>`;
        } else {
            html += `<div class="library-entry-card">
                <div class="library-entry-header">
                    <span class="library-entry-term">${term}</span>
                </div>
                ${subtitle ? `<div class="library-entry-sub">${subtitle}</div>` : ''}
                ${bodyHTML}
            </div>`;
        }
    });

    html += `</div>`;
    return html;
}