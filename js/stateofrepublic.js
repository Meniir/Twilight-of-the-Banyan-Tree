// SUMMARY: State of the Republic dossier shown after the election: faction vote lists, the shareable card, the canvas-drawn gazette
// and its HD image export. Loads after election.js.

// Seat colors for the State of the Republic image (match the .seat-* classes in styles.css)
const STATE_SEAT_PALETTE = {
    'for':     { fill: '#00CC00', light: '#88FF88' },
    'against': { fill: '#FF2222', light: '#FF9999' },
    'blank':   { fill: '#AAAAAA', light: '#DDDDDD' }
};

// Seat size in pixels for the exported image (matches .mpr-seat-dot in styles.css). The on-screen card is sized by that CSS.
const STATE_SEAT_IMAGE_SIZE = 8;

// Image used as the President's portrait on the State of the Republic card
function getPresidentPortraitSrc() {
    return (gameConfig && gameConfig.stateOfRepublicPortrait) || 'photo/habibi.png';
}

// Short display label for a faction (distinguishes the two Golkar wings)
function getStateFactionLabel(f) {
    const col = (typeof FACTION_HISTORICAL_COLORS !== 'undefined') ? FACTION_HISTORICAL_COLORS[f.key] : null;
    return (col && col.label) || f.short || f.name;
}

// Seat outcomes from left to right: all FOR seats on the left, blanks in the middle, all AGAINST seats on the right
function getStateSeatOutcomes(sum) {
    const total = Math.max(1, sum.totalSeats);
    const nFor = Math.min(sum.forVotes, total);
    const nAgainst = Math.min(sum.againstVotes, total - nFor);
    const nBlank = total - nFor - nAgainst;
    return [].concat(Array(nFor).fill('for'), Array(nBlank).fill('blank'), Array(nAgainst).fill('against'));
}

// Every faction with at least one FOR vote, and every faction with at least one AGAINST vote (so splits and defectors show on both sides)
function getStateFactionVoteLists(sum) {
    const rows = sum.factionBreakdown.filter(f => f.seats > 0);
    const build = (kind) => rows
        .filter(f => (kind === 'for' ? f.forVotes : f.againstVotes) > 0)
        .map(f => {
            const mine = kind === 'for' ? f.forVotes : f.againstVotes;
            const other = kind === 'for' ? f.againstVotes : f.forVotes;
            return { f, n: mine, minority: mine < other };
        })
        .sort((a, b) => b.n - a.n);
    return { forList: build('for'), againstList: build('against') };
}

// One faction row of the card, built from the stat-row classes in styles.css
function buildStateFactionRowHTML(entry, kind) {
    const { f, n, minority } = entry;
    const col = (typeof FACTION_HISTORICAL_COLORS !== 'undefined') ? FACTION_HISTORICAL_COLORS[f.key] : null;
    const tone = kind === 'for' ? 'var(--tone-good)' : 'var(--tone-bad)';
    return `<div class="stat-row">
        <span class="stat-label"><span style="display: inline-block; width: 10px; height: 10px; margin-right: 5px; vertical-align: middle; background-color: ${col ? col.fill : '#808080'}; box-shadow: var(--bevel-status-well);"></span>${getStateFactionLabel(f)}${minority ? ' <span style="font-weight: normal; font-style: italic; color: var(--win95-text-dim);">' + LOC('republic.defectors') + '</span>' : ''}</span>
        <span class="stat-value" style="color: ${tone};">${LOC('republic.faction_votes_' + kind, { N: n })} <span style="font-weight: normal; color: var(--win95-text-dim);">${LOC('republic.of_seats', { SEATS: f.seats })}</span></span>
    </div>`;
}

// The shareable State of the Republic card: portrait, verdict, split hemicycle and the factions' votes
function buildStateCardHTML(sum) {
    const { forList, againstList } = getStateFactionVoteLists(sum);
    const total = Math.max(1, sum.totalSeats);
    const pct = n => (n / total * 100).toFixed(2);
    const verdictColor = sum.won ? 'var(--tone-good)' : 'var(--tone-bad)';
    const coords = generateHemicycleLayout(sum.totalSeats);
    const outcomes = getStateSeatOutcomes(sum);
    const dots = coords.map((pt, i) =>
        `<div class="mpr-seat-dot seat-${outcomes[i]}" style="left: ${pt.x}%; top: ${pt.y}%;"></div>`
    ).join('');

    const column = (title, kind, list) => `<div>
        <div class="music-header">${LOC('republic.column_title', { TITLE: title, COUNT: kind === 'for' ? sum.forVotes : sum.againstVotes })}</div>
        <div class="state-gazette-box">
            ${list.length > 0 ? list.map(e => buildStateFactionRowHTML(e, kind)).join('') : `<span style="font-size: 11px; font-style: italic; color: var(--win95-text-dim);">${LOC('republic.no_delegates')}</span>`}
        </div>
    </div>`;

    return `<div id="state-card" class="tally-box">
        <div class="music-header">${LOC('republic.title')}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start;">
            <div style="flex: 0 0 auto; margin: 0 auto; text-align: center;">
                <div class="player-portrait-container" style="cursor: default;">
                    <span style="color: #555;">${LOC('player.photo_placeholder')}</span>
                    <img src="${escapeHtml(getPresidentPortraitSrc())}" class="portrait-img" alt="${escapeHtml(LOC('player.portrait_alt'))}" onerror="this.style.display='none'">
                </div>
                <div style="font-size: 13px; font-weight: bold;">${LOC('player.title')}</div>
                <div style="font-size: 13px; font-weight: bold;">${LOC('player.full_name')}<br><span style="font-size: 11px; font-weight: normal; color: var(--win95-text-dim);">${LOC('player.office')}</span></div>
            </div>
            <div style="flex: 1 1 320px; min-width: 0;">
                <div class="faction-summary" style="text-align: center; margin-bottom: 8px; padding: 8px;">
                    <div style="font-size: 16px; font-weight: bold; color: ${verdictColor};">${LOC(sum.won ? 'republic.verdict_accepted' : 'republic.verdict_rejected')}</div>
                    <div style="font-size: 13px; font-weight: bold; margin-top: 2px;"><span style="color: var(--tone-good);">${LOC('republic.tally_for', { N: sum.forVotes })}</span> &middot; <span style="color: var(--tone-bad);">${LOC('republic.tally_against', { N: sum.againstVotes })}</span> &middot; <span style="color: var(--win95-text-dim);">${LOC('republic.tally_blank', { N: sum.blankVotes })}</span></div>
                </div>
                <div class="mpr-tug-container">
                    <div class="mpr-tug-for" style="width: ${pct(sum.forVotes)}%;"></div>
                    <div class="mpr-tug-blank" style="width: ${pct(sum.blankVotes)}%;"></div>
                    <div class="mpr-tug-against" style="width: ${pct(sum.againstVotes)}%;"></div>
                    <div class="mpr-majority-marker" title="${escapeHtml(LOC('election.majority_marker'))}"></div>
                </div>
                <div class="mpr-hemicycle-wrap">
                    ${dots}
                    <div style="position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); text-align: center; font-weight: bold; font-size: 20px; line-height: 1.1; white-space: nowrap;">${sum.forVotes} &ndash; ${sum.againstVotes}</div>
                    <div class="mpr-rostrum">${LOC('parliament.rostrum')}</div>
                </div>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 14px;">
            ${column(LOC('republic.voted_for'), 'for', forList)}
            ${column(LOC('republic.voted_against'), 'against', againstList)}
        </div>
    </div>
    <div style="text-align: center; margin-bottom: 14px;">
        <button style="width: 240px; display: inline-block; text-align: center;" onclick="downloadStateOfRepublicImage()">${LOC('republic.download_button')}</button>
    </div>`;
}

// Load an image, resolving to null if it cannot be loaded
function loadStateImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

// Parse a CSS color (#rgb, #rrggbb or rgb()) into [r, g, b]
function parseStateColor(c) {
    const s = String(c || '').trim();
    if (s[0] === '#') {
        const h = s.length === 4 ? s.slice(1).split('').map(x => x + x).join('') : s.slice(1, 7);
        return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
    }
    const m = s.match(/\d+(\.\d+)?/g);
    return m && m.length >= 3 ? [Math.round(m[0]), Math.round(m[1]), Math.round(m[2])] : [0, 0, 0];
}

// Mix two colors; t is the share of the first color
function mixStateColor(a, b, t) {
    const x = parseStateColor(a), y = parseStateColor(b);
    return 'rgb(' + [0, 1, 2].map(i => Math.round(x[i] * t + y[i] * (1 - t))).join(',') + ')';
}

// Read the active window style and color scheme from the page so the image matches the chosen theme
function getStateTheme() {
    const hasCs = (typeof getComputedStyle === 'function');
    const cs = hasCs ? getComputedStyle(document.documentElement) : null;
    const v = (name, fallback) => ((cs && cs.getPropertyValue(name).trim()) || fallback);
    const wstyle = (document.documentElement && document.documentElement.getAttribute && document.documentElement.getAttribute('data-wstyle')) || 'default';
    let desktop = '#008080';
    if (hasCs && document.body) {
        const bg = getComputedStyle(document.body).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') desktop = bg;
    }
    const T = {
        wstyle, desktop,
        bg: v('--win95-bg', '#C0C0C0'), surface: v('--win95-surface', '#DFDFDF'), white: v('--win95-white', '#FFFFFF'),
        shadow: v('--win95-shadow', '#808080'), dark: v('--win95-dark', '#000000'), navy: v('--win95-navy', '#000080'),
        blue: v('--win95-blue-grad', '#1084D0'), well: v('--win95-well', '#F5F5F5'), wellAlt: v('--win95-well-alt', '#E0DFE3'),
        text: v('--win95-text', '#000000'), dim: v('--win95-text-dim', '#555555'), accent: v('--win95-accent', '#000080'),
        good: v('--tone-good', '#006400'), bad: v('--tone-bad', '#8B0000')
    };
    const hexes = v('--win98-title-inactive', '').match(/#[0-9a-fA-F]{3,8}/g);
    T.inactive = (hexes && hexes.length >= 2) ? [hexes[0], hexes[1]] : [mixStateColor(T.shadow, '#000000', 0.62), T.bg];
    return T;
}

// Plain text of a decree label (decree text can carry HTML entities or tags)
function getStatePlainText(str) {
    const d = document.createElement('div');
    d.innerHTML = String(str == null ? '' : str);
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

// The Lembaran Negara data for the image: enacted decrees and dissolved blocs, wrapped into rows
function getStateGazetteData() {
    const decrees = [];
    if (actionsData && Array.isArray(actionsData.decrees)) {
        actionsData.decrees.forEach(dec => { if (activeDecrees[dec.id]) decrees.push(getStatePlainText(LOC.r(dec.text))); });
    }
    const dissolved = [];
    INITIAL_PORTRAIT_FACTIONS.forEach(fk => {
        if (bannedFactions[fk] && initialFactionsSnapshot[fk]) dissolved.push(getStatePlainText(stripLeaderParentheses(LOC.r(initialFactionsSnapshot[fk].name))));
    });
    return { decrees, dissolved };
}

// Measure and wrap the gazette so the canvas can be sized before anything is drawn
function layoutStateGazette(font) {
    const data = getStateGazetteData();
    const mg = document.createElement('canvas').getContext('2d');
    const INNER = 868, CHIP_H = 20, ROW_H = 25, GAP = 6;
    const chips = [];
    let x = 0, row = 0;
    mg.font = font(11, true);
    data.decrees.forEach(label => {
        const w = Math.ceil(mg.measureText('\u2713 ' + label).width) + 14;
        if (x > 0 && x + w > INNER) { row++; x = 0; }
        chips.push({ label, x, row, w: Math.min(w, INNER) });
        x += w + GAP;
    });
    const rows = chips.length ? row + 1 : 0;

    const dissolvedLines = [];
    if (data.dissolved.length > 0) {
        mg.font = font(11, false);
        let line = '';
        data.dissolved.join(', ').split(' ').forEach(word => {
            const test = line ? line + ' ' + word : word;
            if (line && mg.measureText(test).width > INNER) { dissolvedLines.push(line); line = word; }
            else line = test;
        });
        if (line) dissolvedLines.push(line);
    }

    let boxH = 8 + Math.max(1, rows) * ROW_H + 4;
    if (dissolvedLines.length > 0) boxH += 2 + 30 + (dissolvedLines.length - 1) * 14 + 2;
    return { chips, rows, rowH: ROW_H, chipH: CHIP_H, dissolvedLines, boxH };
}

// Draw the State of the Republic card as a 1920xN image (width 1920; height grows with the Lembaran Negara) in the active window style (Windows 95, Windows 98 or Mac OS 8)
function drawStateOfRepublicCanvas(sum, portraitImg, iconImg) {
    const S = 2, LW = 960;
    const T = getStateTheme();
    const MAC = T.wstyle === 'macos8';
    const W98 = T.wstyle === 'win98';
    const FONT = MAC
        ? '"Charcoal", "Chicago", "Geneva", "Lucida Grande", "Helvetica Neue", Helvetica, Arial, sans-serif'
        : '"MS Sans Serif", Tahoma, Geneva, sans-serif';
    const font = (size, bold, italic) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FONT}`;

    const GAZ = layoutStateGazette(font);
    const GY = 686;
    const cardBottom = GY + 22 + GAZ.boxH + 10;
    const winH = cardBottom + 12 - 10;
    const LH = cardBottom + 12 + 10;
    const cardH = cardBottom - 46;

    const canvas = document.createElement('canvas');
    canvas.width = LW * S;
    canvas.height = LH * S;
    const g = canvas.getContext('2d');
    g.scale(S, S);
    const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const bevel = (x, y, w, h, layers) => {
        layers.forEach((l, i) => {
            rect(x + i, y + i, w - 2 * i, 1, l[0]);
            rect(x + i, y + i, 1, h - 2 * i, l[0]);
            rect(x + i, y + h - 1 - i, w - 2 * i, 1, l[1]);
            rect(x + w - 1 - i, y + i, 1, h - 2 * i, l[1]);
        });
    };
    const STYLE = MAC ? {
        raised: { outline: '#000000', layers: [['#FFFFFF', '#888888'], ['#F0F0F0', '#BBBBBB']] },
        sunken: { outline: '#555555', layers: [['#777777', '#FFFFFF']] },
        status: { outline: null, layers: [['#888888', '#FFFFFF']] },
        window: { outline: '#000000', layers: [['#FFFFFF', '#888888']] }
    } : {
        raised: { outline: null, layers: [[T.white, T.dark], [T.surface, T.shadow]] },
        sunken: { outline: null, layers: [[T.shadow, T.white], [T.dark, T.surface]] },
        status: { outline: null, layers: [[T.shadow, T.white]] },
        window: { outline: null, layers: W98 ? [[T.surface, '#0A0A0A'], [T.white, T.shadow]] : [[T.surface, T.dark], [T.white, T.shadow]] }
    };
    const panel = (x, y, w, h, fill, kind) => {
        const st = STYLE[kind];
        if (st.outline) rect(x - 1, y - 1, w + 2, h + 2, st.outline);
        rect(x, y, w, h, fill);
        bevel(x, y, w, h, st.layers);
    };
    const text = (str, x, y, size, bold, color, align, italic) => {
        g.font = font(size, bold, italic);
        g.textAlign = align || 'left';
        g.fillStyle = color;
        g.fillText(str, x, y);
    };
    const gradient = (x, w, c1, c2) => {
        const grad = g.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        return grad;
    };

    const header = (x, y, w, label) => {
        if (MAC) {
            rect(x, y, w, 18, '#DDDDDD');
            rect(x, y + 17, w, 1, '#888888');
            text(label, x + w / 2, y + 12, 11, true, '#6E6E6E', 'center');
        } else if (W98) {
            rect(x, y, w, 18, gradient(x, w, T.inactive[0], T.inactive[1]));
            text(label, x + 6, y + 12, 11, true, '#F4F1EA');
        } else {
            rect(x, y, w, 18, gradient(x, w, T.navy, T.blue));
            text(label, x + 7, y + 13, 11, true, '#000000');
            text(label, x + 6, y + 12, 11, true, '#FFFFFF');
        }
    };

    rect(0, 0, LW, LH, T.desktop);
    if (MAC) {
        rect(12, 12, 942, winH + 2, 'rgba(0,0,0,0.55)');
    } else if (!W98) {
        rect(14, 14, 940, winH, 'rgba(0,0,0,0.45)');
    }
    panel(10, 10, 940, winH, T.bg, 'window');

    if (MAC) {
        for (let y = 16; y < 36; y++) rect(16, y, 928, 1, (y - 16) % 2 === 0 ? '#FFFFFF' : '#B9B9B9');
        rect(16, 36, 928, 1, '#000000');
        g.font = font(12, true);
        const capW = g.measureText(LOC('app.title')).width + 16;
        rect(480 - capW / 2, 19, capW, 14, '#DDDDDD');
        text(LOC('app.title'), 480, 30, 12, true, '#000000', 'center');
        const box = (bx) => {
            rect(bx, 19, 13, 13, '#000000');
            rect(bx + 1, 20, 11, 11, '#DDDDDD');
            rect(bx + 1, 20, 11, 1, '#FFFFFF');
            rect(bx + 1, 20, 1, 11, '#FFFFFF');
            rect(bx + 11, 20, 1, 11, '#888888');
            rect(bx + 1, 30, 11, 1, '#888888');
        };
        box(24);
        box(907);
        rect(911, 23, 5, 5, '#000000');
        rect(912, 24, 3, 3, '#DDDDDD');
        box(923);
        rect(926, 25, 8, 1, '#000000');
    } else if (W98) {
        rect(16, 17, 928, 18, gradient(16, 928, T.navy, T.blue));
        if (iconImg) g.drawImage(iconImg, 19, 18, 16, 16);
        text(LOC('app.title'), 40, 30, 12, true, '#FFFFFF');
        const btn = (bx) => panel(bx, 19, 16, 14, T.bg, 'raised');
        btn(886); btn(902); btn(920);
        rect(890, 28, 6, 2, '#000000');
        rect(906.5, 22.5, 8, 8, 'rgba(0,0,0,0)');
        g.strokeStyle = '#000000';
        g.lineWidth = 1;
        g.strokeRect(906.5, 22.5, 7, 7);
        rect(906, 22, 8, 2, '#000000');
        g.lineWidth = 1.7;
        g.beginPath();
        g.moveTo(924, 23); g.lineTo(931, 30);
        g.moveTo(931, 23); g.lineTo(924, 30);
        g.stroke();
    } else {
        rect(16, 16, 928, 22, gradient(16, 928, T.navy, T.blue));
        text(LOC('app.title'), 25, 32, 12, true, '#000000');
        text(LOC('app.title'), 24, 31, 12, true, '#FFFFFF');
        panel(924, 19, 16, 14, T.bg, 'raised');
        text('\u2715', 932, 30, 10, true, T.text, 'center');
    }

    panel(22, 46, 916, cardH, T.bg, 'raised');
    header(34, 58, 892, LOC('republic.title'));

    rect(39, 88, 160, 200, '#A9A9A9');
    g.save();
    g.beginPath();
    g.rect(43, 92, 152, 192);
    g.clip();
    if (portraitImg) {
        const s = Math.max(152 / portraitImg.width, 192 / portraitImg.height);
        const dw = portraitImg.width * s, dh = portraitImg.height * s;
        g.drawImage(portraitImg, 43 + (152 - dw) / 2, 92 + (192 - dh) / 2, dw, dh);
    } else {
        const phLines = LOC('player.photo_placeholder').split('<br>');
        text(phLines[0], 119, 186, 10, false, '#555555', 'center');
        text(phLines[1] || '', 119, 200, 10, false, '#555555', 'center');
    }
    g.restore();
    rect(39, 88, 160, 4, '#808080');
    rect(39, 88, 4, 200, '#808080');
    rect(39, 284, 160, 4, '#FFFFFF');
    rect(195, 88, 4, 200, '#FFFFFF');
    text(LOC('player.title'), 119, 306, 12, true, T.text, 'center');
    text(LOC('player.full_name'), 119, 321, 12, true, T.text, 'center');
    const officeLines = LOC('republic.canvas_office').split('<br>');
    text(officeLines[0], 119, 335, 9.5, false, T.dim, 'center');
    text(officeLines[1] || '', 119, 347, 9.5, false, T.dim, 'center');

    const RX = 218, RW = 708;
    panel(RX, 88, RW, 66, T.well, 'sunken');
    text(LOC(sum.won ? 'republic.verdict_accepted' : 'republic.verdict_rejected'), RX + RW / 2, 111, 17, true, sum.won ? T.good : T.bad, 'center');
    const segs = [[LOC('republic.tally_for', { N: sum.forVotes }), T.good], [LOC('republic.tally_against', { N: sum.againstVotes }), T.bad], [LOC('republic.tally_blank', { N: sum.blankVotes }), T.dim]];
    g.font = font(12, true);
    const sep = '  \u00B7  ';
    const widths = segs.map(s => g.measureText(s[0]).width);
    const sepW = g.measureText(sep).width;
    let cx = RX + RW / 2 - (widths.reduce((a, b) => a + b, 0) + sepW * (segs.length - 1)) / 2;
    segs.forEach((s, i) => {
        text(s[0], cx, 129, 12, true, s[1]);
        cx += widths[i];
        if (i < segs.length - 1) { text(sep, cx, 129, 12, true, T.text); cx += sepW; }
    });
    const diff = (gameConfig && gameConfig.difficultySettings && gameConfig.difficultySettings[selectedDifficulty] && gameConfig.difficultySettings[selectedDifficulty].name)
        ? LOC.r(gameConfig.difficultySettings[selectedDifficulty].name) : String(selectedDifficulty).toUpperCase();
    text(LOC('republic.canvas_summary', { DIFF: diff, PC: stats.PC }), RX + RW / 2, 145, 9.5, false, T.dim, 'center');

    const total = Math.max(1, sum.totalSeats);
    panel(RX, 162, RW, 26, T.shadow, 'sunken');
    const bx = RX + 2, bw = RW - 4, by = 164, bh = 22;
    const stripes = (x, w, c1, c2) => {
        for (let p = 0; p < w; p += 10) {
            rect(x + p, by, Math.min(8, w - p), bh, c1);
            if (w - p > 8) rect(x + p + 8, by, Math.min(2, w - p - 8), bh, c2);
        }
    };
    const wFor = bw * sum.forVotes / total, wBlank = bw * sum.blankVotes / total, wAgainst = bw * sum.againstVotes / total;
    stripes(bx, wFor, '#008000', '#006400');
    rect(bx + wFor, by, wBlank, bh, '#A9A9A9');
    stripes(bx + bw - wAgainst, wAgainst, '#CC0000', '#8B0000');
    rect(bx + bw * 0.5014 - 1, by, 2, bh, '#FFFF00');

    const HX = RX, HY = 196, HW = 450, HH = 212;
    panel(HX, HY, HW, HH, T.wellAlt, 'sunken');
    const isCircleSeat = (window.extraSettings && window.extraSettings.seatShape === 'circle');
    const coords = generateHemicycleLayout(sum.totalSeats);
    const outcomes = getStateSeatOutcomes(sum);
    coords.forEach((pt, i) => {
        const pal = STATE_SEAT_PALETTE[outcomes[i]];
        const sz = STATE_SEAT_IMAGE_SIZE;
        if (isCircleSeat) {
            const cx = HX + pt.x / 100 * HW, cy = HY + pt.y / 100 * HH, r = sz / 2;
            g.beginPath();
            g.arc(cx, cy, r, 0, Math.PI * 2);
            g.fillStyle = pal.fill;
            g.fill();
            g.lineWidth = 1;
            g.strokeStyle = pal.light;
            g.beginPath();
            g.arc(cx, cy, r - 0.5, Math.PI * 0.75, Math.PI * 1.75);
            g.stroke();
            g.strokeStyle = '#222222';
            g.beginPath();
            g.arc(cx, cy, r - 0.5, Math.PI * 1.75, Math.PI * 2.75);
            g.stroke();
            return;
        }
        const sx = Math.round(HX + pt.x / 100 * HW - sz / 2), sy = Math.round(HY + pt.y / 100 * HH - sz / 2);
        rect(sx, sy, sz, sz, pal.fill);
        rect(sx, sy, sz, 1, pal.light);
        rect(sx, sy, 1, sz, pal.light);
        rect(sx, sy + sz - 1, sz, 1, '#222222');
        rect(sx + sz - 1, sy, 1, sz, '#222222');
    });
    text(`${sum.forVotes} \u2013 ${sum.againstVotes}`, HX + HW / 2, HY + HH - 36, 22, true, T.text, 'center');
    panel(HX + HW / 2 - 42, HY + HH - 24, 84, 16, T.bg, 'raised');
    text(LOC('parliament.rostrum'), HX + HW / 2, HY + HH - 12, 8.5, true, MAC ? T.navy : T.accent, 'center');

    [[LOC('republic.label_for'), sum.forVotes, 'for', T.good], [LOC('republic.label_against'), sum.againstVotes, 'against', T.bad], [LOC('republic.label_blank'), sum.blankVotes, 'blank', T.dim]].forEach((t, i) => {
        const y = HY + i * 72;
        panel(HX + HW + 14, y, RW - HW - 14, 64, T.well, 'sunken');
        rect(HX + HW + 18, y + 4, 6, 56, STATE_SEAT_PALETTE[t[2]].fill);
        text(String(t[1]), HX + HW + 36, y + 36, 28, true, t[3]);
        text(t[0], HX + HW + 36, y + 54, 12, true, T.text);
    });

    const { forList, againstList } = getStateFactionVoteLists(sum);
    const drawList = (x, title, kind, list, count) => {
        const w = 436, y = 420, boxY = y + 22, boxH = 228;
        header(x, y, w, LOC('republic.column_title', { TITLE: title, COUNT: count }));
        panel(x, boxY, w, boxH, T.surface, 'sunken');
        if (list.length === 0) {
            text(LOC('republic.no_delegates'), x + 12, boxY + 24, 11, false, T.dim, 'left', true);
            return;
        }
        const rowH = Math.min(21, (boxH - 16) / list.length);
        const tone = kind === 'for' ? T.good : T.bad;
        list.forEach((e, i) => {
            const ry = boxY + 8 + i * rowH;
            const h = rowH - 3;
            const f = e.f;
            const col = (typeof FACTION_HISTORICAL_COLORS !== 'undefined') ? FACTION_HISTORICAL_COLORS[f.key] : null;
            panel(x + 8, ry, w - 16, h, T.surface, 'status');
            const my = ry + h / 2;
            rect(x + 14, my - 5, 10, 10, col ? col.fill : '#808080');
            bevel(x + 14, my - 5, 10, 10, STYLE.status.layers);
            const label = getStateFactionLabel(f);
            text(label, x + 30, my + 4, 11, true, T.text);
            if (e.minority) {
                g.font = font(11, true);
                text(LOC('republic.defectors'), x + 30 + g.measureText(label + ' ').width, my + 4, 10, false, T.dim, 'left', true);
            }
            const ofTxt = ' ' + LOC('republic.of_seats', { SEATS: f.seats });
            text(ofTxt, x + w - 14, my + 4, 11, false, T.dim, 'right');
            g.font = font(11, false);
            const ofW = g.measureText(ofTxt).width;
            text(LOC('republic.faction_votes_' + kind, { N: e.n }), x + w - 14 - ofW, my + 4, 11, true, tone, 'right');
        });
    };
    drawList(34, LOC('republic.voted_for'), 'for', forList, sum.forVotes);
    drawList(490, LOC('republic.voted_against'), 'against', againstList, sum.againstVotes);

    header(34, GY, 892, LOC('gazette.title'));
    const GBY = GY + 22;
    panel(34, GBY, 892, GAZ.boxH, T.surface, 'sunken');
    if (GAZ.chips.length === 0) {
        text(LOC('republic.no_decrees'), 46, GBY + 22, 11, false, T.dim, 'left', true);
    } else {
        GAZ.chips.forEach(c => {
            const cy = GBY + 8 + c.row * GAZ.rowH;
            rect(46 + c.x, cy, c.w, GAZ.chipH, '#FFFFFF');
            bevel(46 + c.x, cy, c.w, GAZ.chipH, STYLE.status.layers);
            text('\u2713 ' + c.label, 46 + c.x + 7, cy + 13, 11, true, MAC ? '#000000' : '#000080');
        });
    }
    if (GAZ.dissolvedLines.length > 0) {
        const dy = GBY + 8 + Math.max(1, GAZ.rows) * GAZ.rowH + 2;
        g.fillStyle = '#808080';
        for (let dx = 46; dx < 914; dx += 4) g.fillRect(dx, dy, 2, 1);
        text(LOC('republic.dissolved_blocs'), 46, dy + 15, 11, true, T.bad);
        GAZ.dissolvedLines.forEach((ln, i) => text(ln, 46, dy + 30 + i * 14, 11, false, T.bad));
    }

    return canvas;
}

// Convert a canvas to a PNG blob
function stateCanvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Empty image'))), 'image/png');
        } catch (e) { reject(e); }
    });
}

// Render the card to a PNG, falling back to a placeholder portrait if the browser blocks the image
async function makeStateOfRepublicBlob() {
    const sum = window.lastElectionSummary;
    if (!sum) return null;
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { console.warn(e); } }
    const portraitImg = await loadStateImage(getPresidentPortraitSrc());
    const iconImg = (document.documentElement.getAttribute('data-wstyle') === 'win98') ? await loadStateImage('photo/icon.png') : null;
    try {
        return await stateCanvasToBlob(drawStateOfRepublicCanvas(sum, portraitImg, iconImg));
    } catch (e) {
        console.warn('Images could not be embedded:', e);
        return await stateCanvasToBlob(drawStateOfRepublicCanvas(sum, null, null));
    }
}

// Save the State of the Republic card as an HD PNG download
window.downloadStateOfRepublicImage = async function() {
    try {
        const blob = await makeStateOfRepublicBlob();
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = LOC('republic.download_filename');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
        console.warn(e);
        showCustomAlert(LOC('republic.image_failed'), null);
    }
};

// Build the State of the Republic dossier from the election summary
function buildStateOfTheRepublicHTML() {
    const sum = window.lastElectionSummary;
    const diffName = (gameConfig.difficultySettings[selectedDifficulty] && gameConfig.difficultySettings[selectedDifficulty].name)
        ? LOC.r(gameConfig.difficultySettings[selectedDifficulty].name)
        : selectedDifficulty.toUpperCase();

    const metricKeys = ['pop', 'mil', 'ref', 'econ', 'intl', 'stab', 'cendana'].map(k => ({ k: k, label: LOC('effect_name.' + k) }));

    // Flex-wrap instead of a fixed grid: the last row's cells stretch to fill it, so there is no empty slot.
    let metricsGridHTML = `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px;">`;
    metricKeys.forEach(m => {
        metricsGridHTML += `<div class="stat-row" style="margin-bottom: 0; padding: 5px 8px; flex: 1 1 220px; min-width: 0;">
            <span class="stat-label">${LOC('republic.dossier.metric_label', { LABEL: m.label })}</span>
            <span class="stat-value">${getVagueStatText(m.k, stats[m.k])}</span>
        </div>`;
    });
    metricsGridHTML += `<div class="stat-row" style="margin-bottom: 0; padding: 5px 8px; flex: 1 1 220px; min-width: 0;">
        <span class="stat-label">${LOC('republic.dossier.gov_stability')}</span>
        <span class="stat-value"><b>${getGovStabilityWord()}</b></span>
    </div></div>`;

    const enactedBadges = [];
    if (actionsData && Array.isArray(actionsData.decrees)) {
        actionsData.decrees.forEach(dec => {
            if (activeDecrees[dec.id]) {
                enactedBadges.push(`<span style="display: inline-block; background-color: var(--win95-window); padding: 3px 8px; margin: 2px 4px 2px 0; font-size: 11px; font-weight: bold; color: var(--win95-accent); box-shadow: var(--bevel-status-well);">&#10003; ${LOC.r(dec.text)}</span>`);
            }
        });
    }

    const dissolvedNames = [];
    INITIAL_PORTRAIT_FACTIONS.forEach(fk => {
        if (bannedFactions[fk] && initialFactionsSnapshot[fk]) {
            dissolvedNames.push(`<b>${stripLeaderParentheses(LOC.r(initialFactionsSnapshot[fk].name))}</b>`);
        }
    });

    const unlockedObjs = ACHIEVEMENTS.filter(a => unlockedAchievements.includes(a.id));
    let achvSummaryHTML = '';
    if (unlockedObjs.length > 0) {
        achvSummaryHTML = unlockedObjs.map(a =>
            `<span style="display: inline-flex; align-items: center; background-color: var(--win95-bg); color: var(--win95-text); box-shadow: var(--bevel-raised); padding: 3px 7px; margin: 2px; font-size: 11px;">
                <b>${LOC.r(a.title)}</b>
            </span>`
        ).join('');
    } else {
        achvSummaryHTML = `<i>${LOC('republic.dossier.no_achievements')}</i>`;
    }

    return `<div style="text-align: left; margin-top: 10px;">
        ${buildStateCardHTML(sum)}

        <div style="background-color: var(--win95-surface); color: var(--win95-text); box-shadow: var(--bevel-sunken); padding: 10px 12px; margin-bottom: 12px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--win95-shadow); padding-bottom: 6px; margin-bottom: 8px;">
                <span><b>${LOC('republic.dossier.administration_label')}</b> ${LOC('republic.dossier.administration_value')}</span>
                <span><b>${LOC('republic.dossier.difficulty_label')}</b> ${diffName}</span>
                <span><b>${LOC('republic.dossier.final_pc_label')}</b> ${LOC('republic.dossier.final_pc_value', { PC: stats.PC })}</span>
            </div>
            <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                <span><b>${LOC('republic.dossier.verdict_label')}</b> <b style="color: ${sum.won ? 'var(--tone-good)' : 'var(--tone-bad)'};">${LOC(sum.won ? 'republic.verdict_accepted' : 'republic.verdict_rejected')}</b></span>
                <span><b>${LOC('republic.dossier.tally_label')}</b> ${LOC('republic.dossier.tally_value', { FOR: sum.forVotes, AGAINST: sum.againstVotes, BLANK: sum.blankVotes })}</span>
            </div>
        </div>

        <h3 style="font-size: 13px; margin-bottom: 6px;">${LOC('republic.dossier.pillars_heading')}</h3>
        ${metricsGridHTML}

        <h3 style="font-size: 13px; margin-bottom: 6px;">${LOC('republic.dossier.gazette_heading')}</h3>
        <div class="state-gazette-box" style="margin-bottom: 12px;">
            ${enactedBadges.length > 0 ? enactedBadges.join('') : `<span style="font-size: 11px; color: var(--win95-text-dim); font-style: italic;">${LOC('republic.no_decrees')}</span>`}
            ${dissolvedNames.length > 0 ? `<div style="margin-top: 6px; padding-top: 5px; border-top: 1px dotted var(--win95-shadow); font-size: 11px; color: var(--tone-bad);"><b>${LOC('republic.dissolved_blocs')}</b> ${dissolvedNames.join(', ')}</div>` : ''}
        </div>

        <h3 style="font-size: 13px; margin-bottom: 6px;">${LOC('republic.dossier.achievements_heading', { COUNT: unlockedObjs.length, TOTAL: ACHIEVEMENTS.length })}</h3>
        <div style="background-color: var(--win95-surface); color: var(--win95-text); box-shadow: var(--bevel-sunken); padding: 8px; margin-bottom: 6px;">
            ${achvSummaryHTML}
        </div>
    </div>`;
}