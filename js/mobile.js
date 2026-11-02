// SUMMARY: Mobile-only UI: collapsible left status panel, sticky top status bar with a metrics sheet,
// touch tooltip notes and scroll-to-top that accounts for the sticky bar. Load order: before game.js.

// Whether the left status panel is collapsed on mobile.
window.mobileLeftPanelCollapsed = window.innerWidth <= 820;

// Adds the collapse/expand toggle button at the top of the left panel (once).
function setupMobileLeftPanelToggle() {
    const leftPanel = document.getElementById('left-panel');
    if (!leftPanel || document.getElementById('mobile-left-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'mobile-left-toggle';
    btn.className = 'mobile-panel-toggle-btn';
    btn.onclick = function() {
        window.mobileLeftPanelCollapsed = !window.mobileLeftPanelCollapsed;
        updateMobileToggleLabel();
    };
    leftPanel.insertBefore(btn, leftPanel.firstChild);
    updateMobileToggleLabel();
}

// Applies the collapsed state to the left panel and updates the toggle label (PC and government status when collapsed).
function updateMobileToggleLabel() {
    const leftPanel = document.getElementById('left-panel');
    const btn = document.getElementById('mobile-left-toggle');
    if (!leftPanel || !btn) return;

    if (window.mobileLeftPanelCollapsed) {
        leftPanel.classList.add('mobile-collapsed');
        const govText = gameStarted ? getGovStabilityWord() : '-';
        btn.innerHTML = LOC('mobile.expand', { PC: stats.PC, GOV: govText });
    } else {
        leftPanel.classList.remove('mobile-collapsed');
        btn.innerHTML = LOC('mobile.minimize');
    }
}

// True when the Actions shortcut can safely jump to the action hub (a campaign is at its action phase and no roll call is animating).
function canOpenMobileActionHub() {
    return Boolean(gameStarted) && isActionPhase && currentTurn <= events.length && !window.activeTallyInterval;
}

// Shows or hides the bottom navigation bar and enables/disables its Actions shortcut; call whenever the game phase changes.
function updateMobileBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    const bar = document.getElementById('mobile-status-bar');
    const on = Boolean(bar && bar.classList.contains('active'));
    nav.classList.toggle('active', on);
    document.body.classList.toggle('has-mobile-nav', on);
    const actions = document.getElementById('mbn-actions');
    if (actions) actions.disabled = !canOpenMobileActionHub();
}

// Bottom-bar Actions shortcut: returns to the action hub (routine actions, decrees, faction engagements).
window.openMobileActionHub = function() {
    if (!canOpenMobileActionHub()) return;
    setMobileStatusSheetOpen(false);
    showActionMenu();
};

// Metrics listed in the mobile status sheet (labels come from effect_name.<key>).
const MOBILE_STATUS_METRICS = ['pop', 'mil', 'ref', 'econ', 'intl', 'stab', 'cendana'];

// Updates the sticky top bar (PC, government status, turn counter) and hides it outside a campaign.
function updateMobileStatusBar() {
    const bar = document.getElementById('mobile-status-bar');
    if (!bar) return;

    const leftPanel = document.getElementById('left-panel');
    const visible = gameStarted && !(leftPanel && leftPanel.style.display === 'none');
    bar.classList.toggle('active', visible);
    if (!visible) {
        setMobileStatusSheetOpen(false);
        updateMobileBottomNav();
        return;
    }

    // Sticky elements below the bar (category tabs) offset themselves by its height
    document.documentElement.style.setProperty('--msb-h', bar.offsetHeight + 'px');
    document.getElementById('msb-pc').innerText = stats.PC;
    const govWord = getGovStabilityWord();
    const govEl = document.getElementById('msb-gov');
    govEl.innerText = govWord;
    govEl.style.color = GOV_WORD_COLORS[govWord] || '#000000';
    document.getElementById('msb-turn').innerText = `${Math.min(currentTurn, events.length)}/${events.length}`;

    if (bar.classList.contains('open')) renderMobileStatusSheet();
    updateMobileBottomNav();
}

// Fills the status sheet with the current metric values copied from the left panel.
function renderMobileStatusSheet() {
    const sheet = document.getElementById('msb-sheet');
    if (!sheet) return;
    let html = '';
    MOBILE_STATUS_METRICS.forEach(key => {
        const label = LOC('effect_name.' + key);
        const valEl = document.getElementById('val-' + key);
        html += `<div class="msb-row"><span>${label}</span><span>${valEl ? valEl.innerHTML : ''}</span></div>`;
    });
    sheet.innerHTML = html;
}

// Opens or closes the status sheet and updates the caret and aria-expanded state.
function setMobileStatusSheetOpen(open) {
    const bar = document.getElementById('mobile-status-bar');
    if (!bar) return;
    bar.classList.toggle('open', open);
    const toggle = document.getElementById('msb-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    const navStatus = document.getElementById('mbn-status');
    if (navStatus) navStatus.setAttribute('aria-expanded', open ? 'true' : 'false');
    const caret = document.getElementById('msb-caret');
    if (caret) caret.innerHTML = open ? '&#9650;' : '&#9660;';
    if (open) renderMobileStatusSheet();
}

// Toggles the status sheet.
window.toggleMobileStatusSheet = function() {
    const bar = document.getElementById('mobile-status-bar');
    if (bar) setMobileStatusSheetOpen(!bar.classList.contains('open'));
};

// Closes the status sheet when tapping outside the bar.
document.addEventListener('click', function(e) {
    const bar = document.getElementById('mobile-status-bar');
    const nav = document.getElementById('mobile-bottom-nav');
    if (bar && bar.classList.contains('open') && !bar.contains(e.target) && !(nav && nav.contains(e.target))) {
        setMobileStatusSheetOpen(false);
    }
});

// Scrolls to the top of the main panel (offset for the sticky bar on small screens, plain top of page otherwise).
function scrollMainPanelToTop() {
    if (window.innerWidth <= 820) {
        const mainPanel = document.getElementById('main-panel');
        if (mainPanel) {
            const bar = document.getElementById('mobile-status-bar');
            const barHeight = (bar && bar.classList.contains('active')) ? bar.offsetHeight : 0;
            const y = mainPanel.getBoundingClientRect().top + window.scrollY - 8 - barHeight;
            window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
            return;
        }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
}