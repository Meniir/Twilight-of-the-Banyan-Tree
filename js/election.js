// SUMMARY: The October 1999 MPR election night. Runs the roll call with seat-by-seat results, draws the hemicycle, builds the TAP MPR document,
// the post-election verdict screen and the epilogue slides.

// Tuning knobs for election-night unpredictability
const ELECTION_DRAMA = {
    moodSwing: 7,
    wildcardChance: 0.50,
    wildcardMin: 20,
    wildcardMax: 50,
    crossoverRate: 0.35,
    surgeBias: 15,
    blocBias: 10
};

// Stop the running vote-tally animation timer
function clearTallyInterval() {
    if (window.activeTallyInterval) {
        clearInterval(window.activeTallyInterval);
        window.activeTallyInterval = null;
    }
}

// Set the tally animation speed and redraw the speed buttons
window.setTallySpeed = function(speed) {
    window.tallySpeed = speed;
    const speedBtnsContainer = document.getElementById('speed-controls-container');
    if (speedBtnsContainer) {
        let html = '<b style="font-family: MS Sans Serif; font-size: 12px;">' + LOC('election.speed') + ' </b>';
        [1, 2, 5, 10].forEach(s => {
            html += `<button class="${window.tallySpeed === s ? 'is-selected' : ''}" style="width: 45px; --py: 3px; --px: 3px; margin: 0 3px; display: inline-block; text-align: center;" onclick="setTallySpeed(${s})">${s}x</button>`;
        });
        speedBtnsContainer.innerHTML = html;
    }
};

// Strips leader names or notes inside parentheses — e.g. "Golkar (Akbar Tandjung)" -> "Golkar"
function stripLeaderParentheses(nameStr) {
    if (!nameStr) return '';
    return String(nameStr)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Renders a color-coded party label without leader names in parentheses
function renderElectionPartyBadge(factionKey, fallbackName) {
    const f = (typeof factions !== 'undefined' && factions[factionKey]) ? factions[factionKey] : null;
    const rawName = (f && f.name) ? f.name : (fallbackName || factionKey);
    const cleanName = stripLeaderParentheses(rawName);
    const col = (typeof getFactionColors === 'function' && getFactionColors(factionKey))
        ? getFactionColors(factionKey)
        : { fill: '#808080' };
    const textCol = (typeof getFactionTextColor === 'function' && getFactionTextColor(factionKey))
        ? getFactionTextColor(factionKey)
        : '#111111';

    return `<span style="display: inline-flex; align-items: center; gap: 6px;">
        <span class="faction-color-swatch" style="background-color: ${col.fill};"></span>
        <b style="color: ${textCol};">${cleanName}</b>
    </span>`;
}

// Generates the 700-seat semi-circular MPR hemicycle
function generateHemicycleLayout(totalSeats) {
    const numRows = 13;
    const numSectors = 5;
    const radiiX = [];
    let weightSum = 0;

    for (let r = 0; r < numRows; r++) {
        const rx = 21 + (r / (numRows - 1)) * 26.5;
        radiiX.push(rx);
        weightSum += rx;
    }

    const rowCounts = [];
    const remainders = [];
    let allocated = 0;

    for (let r = 0; r < numRows; r++) {
        const exact = (radiiX[r] / weightSum) * totalSeats;
        const flo = Math.floor(exact);
        rowCounts.push(flo);
        remainders.push({ r: r, rem: exact - flo });
        allocated += flo;
    }

    remainders.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < totalSeats - allocated; i++) {
        rowCounts[remainders[i].r]++;
    }

    const REM_PATTERNS = [
        [0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 1, 0, 1, 0],
        [0, 1, 1, 1, 0],
        [1, 1, 0, 1, 1]
    ];

    const seats = [];
    const aisleGap = 0.042;
    const totalAisleAngle = (numSectors - 1) * aisleGap;
    const startMargin = 0.045;
    const usableSpan = Math.PI - (2 * startMargin) - totalAisleAngle;
    const sectorSpan = usableSpan / numSectors;

    for (let r = 0; r < numRows; r++) {
        const count = rowCounts[r];
        if (count <= 0) continue;

        const rx = radiiX[r];
        const ry = rx * 1.90;

        const basePerSector = Math.floor(count / numSectors);
        const remPattern = REM_PATTERNS[count % numSectors];

        for (let s = 0; s < numSectors; s++) {
            const secCount = basePerSector + remPattern[s];
            if (secCount <= 0) continue;

            const sectorStartTheta = (Math.PI - startMargin) - s * (sectorSpan + aisleGap);

            for (let k = 0; k < secCount; k++) {
                const u = (k + 0.5) / secCount;
                const theta = sectorStartTheta - (u * sectorSpan);

                const xPct = 50 + rx * Math.cos(theta);
                const yPct = 92 - ry * Math.sin(theta);
                seats.push({ x: xPct, y: yPct, theta: theta, row: r, sector: s });
            }
        }
    }

    seats.sort((a, b) => (a.sector - b.sector) || (b.theta - a.theta) || (a.row - b.row));
    return seats;
}

// Builds the condensed translation of TAP MPR No. III/MPR/1999 (text lives in data/language/*/tap_mpr.json)
function buildTapMprDocumentHTML(accepted, forVotes, againstVotes, blankVotes) {
    const verdictWord = LOC(accepted ? 'election.verdict_accepted' : 'election.verdict_rejected');
    const verdictColor = accepted ? '#006400' : '#8B0000';
    const verdictHTML = `<span style="color: ${verdictColor}; font-weight: bold; text-decoration: underline;">${verdictWord}</span>`;
    const considering = ['a', 'b', 'c', 'd']
        .map(k => `<li style="margin-bottom: 4px;">${LOC('tap.considering.' + k)}</li>`)
        .join('\n                ');

    return `<div class="tap-mpr-document">
        <div class="tap-mpr-header">
            <img src="photo/pancasila.png" alt="${escapeHtml(LOC('tap.garuda_alt'))}" style="width: 96px; height: auto; display: block; margin: 0 auto 8px auto;" onerror="this.style.display='none'">
            <div style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px;">${LOC('tap.org')}</div>
            <div style="font-size: 12px; font-weight: bold; margin-top: 26px;">${LOC('tap.decree_title')}</div>
            <div style="font-size: 11px; font-weight: bold; margin-top: 13px;">${LOC('tap.concerning')}</div>
        </div>

        <hr style="border-top: 1px solid #444; margin: 10px 0;">

        <div class="tap-mpr-body">
            <div style="text-align: center; font-weight: bold; margin-bottom: 8px;">${LOC('tap.grace')}</div>

            <p style="margin: 6px 0;"><b>${LOC('tap.considering_heading')}</b></p>
            <ol type="a" style="margin: 4px 0 8px 18px; padding-left: 6px;">
                ${considering}
            </ol>

            <p style="margin: 6px 0;">${LOC('tap.observed', { FOR: forVotes, AGAINST: againstVotes, BLANK: blankVotes })}</p>

            <div style="text-align: center; font-weight: bold; margin: 10px 0 6px 0; letter-spacing: 0.5px;">${LOC('tap.decides')}</div>
            <p style="margin: 4px 0;">${LOC('tap.to_enact')}</p>

            <div class="tap-mpr-article-box">
                <div style="text-align: center; font-weight: bold; margin-bottom: 4px;">${LOC('tap.article1_heading')}</div>
                <div>${LOC('tap.article1', { VERDICT: verdictHTML })}</div>
                <div style="text-align: center; font-weight: bold; margin-top: 8px; margin-bottom: 2px;">${LOC('tap.article2_heading')}</div>
                <div style="text-align: center;">${LOC('tap.article2')}</div>
            </div>

            <div class="tap-mpr-signatures">
                <div style="text-align: right; margin-bottom: 8px;">
                    ${LOC('tap.enacted')}
                </div>
                <div style="text-align: center; font-weight: bold; margin-bottom: 8px;">
                    ${LOC('tap.chairman')}<br>
                    <span style="font-weight: normal; font-style: italic;">${LOC('tap.signed')}</span><br>
                    <b>${LOC('tap.chairman_name')}</b>
                </div>
                <div style="font-size: 10.5px; color: #333; text-align: center; line-height: 1.45;">
                    <b>${LOC('tap.vice_chairmen_label')}</b> ${LOC('tap.vice_chairmen')}
                </div>
            </div>
        </div>
    </div>`;
}

// Run the MPR roll call: build the chamber, animate the tally and show the verdict
function runElection() {
    clearTallyInterval();
    window.electionPanelSnapshot = null;
    clearCampaignSave();
    scrollMainPanelToTop();
    document.getElementById('mpr-dashboard').style.display = 'none';
    document.getElementById('left-panel').style.display = 'none';
    document.getElementById('main-panel').style.width = '100%';
    updateMobileStatusBar();

    const finalData = [];
    let grandTotalFor = 0;
    let grandTotalAgainst = 0;
    let grandTotalBlank = 0;
    const govStability = getGovStability();

    const cendanaSabotage = Math.round((stats.cendana - 50) / 10);
    const stabilityFloorMod = Math.round((govStability - 50) / 10);

    const chamberMood = Math.round((Math.random() + Math.random() - 1) * ELECTION_DRAMA.moodSwing);

    for (let i = 0; i < portraitFactions.length; i++) {
        const key = portraitFactions[i];
        const f = factions[key];
        if (!f || f.seats <= 0 || bannedFactions[key]) continue;

        let blankVotes = Math.floor(Math.random() * (f.seats * 0.015 + 1));
        if (blankVotes > 2) blankVotes = Math.floor(Math.random() * 3);
        const activeSeats = f.seats - blankVotes;

        const unspentFavor = f.favor || 0;
        const favorBonus = unspentFavor * 8;

        let wildcard = 0;
        if (Math.random() < Math.min(1, ELECTION_DRAMA.wildcardChance)) {
            const span = ELECTION_DRAMA.wildcardMax - ELECTION_DRAMA.wildcardMin + 1;
            wildcard = (ELECTION_DRAMA.wildcardMin + Math.floor(Math.random() * span)) * (Math.random() < 0.5 ? 1 : -1);
        }
        const rawVariance = (Math.floor(Math.random() * 17) - 9) + stabilityFloorMod - cendanaSabotage + chamberMood + wildcard;
        const cushionedVariance = (rawVariance < 0 && unspentFavor > 0)
            ? Math.round(rawVariance / (1 + unspentFavor * 0.5))
            : rawVariance;

        const advAdj = window.OppositionEngine ? OppositionEngine.affinityAdjust(key) : 0;
        const finalAffinity = clampFaction(key, f.affinity + favorBonus + cushionedVariance + advAdj);

        let votesFor = 0;
        if (key === 'pdip' || key === 'poros_tengah' || key === 'abri') {
            if (finalAffinity >= 80) votesFor = Math.round(activeSeats * 0.96);
            else if (finalAffinity >= 65) votesFor = Math.round(activeSeats * 0.72);
            else if (finalAffinity >= 50) votesFor = Math.round(activeSeats * 0.42);
            else if (finalAffinity >= 35) votesFor = Math.round(activeSeats * 0.15);
            else votesFor = 0;
        } else {
            votesFor = Math.round(activeSeats * (finalAffinity / 100));
        }

        votesFor = Math.max(0, Math.min(activeSeats, votesFor));
        let votesAgainst = activeSeats - votesFor;

        let crossovers = Math.floor(Math.random() * (activeSeats * ELECTION_DRAMA.crossoverRate + 1));
        if (unspentFavor > 0) crossovers = Math.floor(crossovers / 2);
        if (votesFor >= votesAgainst) {
            crossovers = Math.min(crossovers, votesFor);
            votesFor -= crossovers;
            votesAgainst += crossovers;
        } else {
            crossovers = Math.min(crossovers, votesAgainst);
            votesFor += crossovers;
            votesAgainst -= crossovers;
        }

        if (window.OppositionEngine) {
            const adv = OppositionEngine.electionSeatAdjust(key, f, finalAffinity, votesFor, votesAgainst, blankVotes);
            votesFor = adv.votesFor; votesAgainst = adv.votesAgainst; blankVotes = adv.blankVotes;
        }

        let rebel = null;
        if (window.OppositionEngine && OppositionEngine.isVoteLocked(key)) rebel = null;
        else if (wildcard > 0) rebel = 'surge';
        else if (wildcard < 0) rebel = 'revolt';
        else if (crossovers >= 4) rebel = 'crossvote';

        grandTotalFor += votesFor;
        grandTotalAgainst += votesAgainst;
        grandTotalBlank += blankVotes;

        finalData.push({
            key: key,
            name: stripLeaderParentheses(f.name),
            short: stripLeaderParentheses(f.short || f.name),
            totalSeats: f.seats,
            targetFor: votesFor,
            targetAgainst: votesAgainst,
            targetBlank: blankVotes,
            rebel: rebel,
            curFor: 0,
            curAgainst: 0,
            curBlank: 0,
            seatPool: []
        });
    }

    const totalChamberSeats = Math.max(1, grandTotalFor + grandTotalAgainst + grandTotalBlank);
    const hemicycleCoords = generateHemicycleLayout(totalChamberSeats);

    let runningSeatOffset = 0;
    for (let i = 0; i < finalData.length; i++) {
        const pool = [];
        for (let s = 0; s < finalData[i].totalSeats; s++) {
            pool.push(runningSeatOffset + s);
        }
        for (let j = pool.length - 1; j > 0; j--) {
            const r = Math.floor(Math.random() * (j + 1));
            const tmp = pool[j];
            pool[j] = pool[r];
            pool[r] = tmp;
        }
        finalData[i].seatPool = pool;
        runningSeatOffset += finalData[i].totalSeats;
    }

    let clockTime = new Date("1999-10-19T20:30:00");
    let electionFinished = false;

    let html = '<div class="tally-box">';
    html += '<center><h2>' + LOC('election.plenary_title') + '</h2></center>';

    html += `<center><div id="tally-clock" class="tally-clock-fixed">${formatFixedClock(clockTime)}</div></center>`;

    html += '<div id="speed-controls-container" style="text-align: center; margin-bottom: 12px;">';
    html += '<b style="font-family: MS Sans Serif; font-size: 12px;">' + LOC('election.speed') + ' </b>';
    [1, 2, 5, 10].forEach(s => {
        html += `<button class="${window.tallySpeed === s ? 'is-selected' : ''}" style="width: 45px; --py: 3px; --px: 3px; margin: 0 3px; display: inline-block; text-align: center;" onclick="setTallySpeed(${s})">${s}x</button>`;
    });
    html += '</div>';

    html += '<div class="mpr-chamber-box">';
    html += '<div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-bottom: 3px;">';
    html += '<span style="color: #006400;">' + LOC('election.bar_accept') + ' <span id="bar-label-for">0</span></span>';
    html += '<span style="color: #333333;"></span>';
    html += '<span style="color: #8B0000;">' + LOC('election.bar_reject') + ' <span id="bar-label-against">0</span></span>';
    html += '</div>';

    html += '<div class="mpr-tug-container">';
    html += '<div id="tug-for" class="mpr-tug-for" style="width: 0%;"></div>';
    html += '<div id="tug-blank" class="mpr-tug-blank" style="width: 0%;"></div>';
    html += '<div id="tug-against" class="mpr-tug-against" style="width: 0%;"></div>';
    html += '<div class="mpr-majority-marker" title="' + escapeHtml(LOC('election.majority_marker')) + '"></div>';
    html += '</div>';

    html += '<div id="mpr-hemicycle" class="mpr-hemicycle-wrap">';
    for (let s = 0; s < hemicycleCoords.length; s++) {
        const pt = hemicycleCoords[s];
        html += `<div id="seat-dot-${s}" class="mpr-seat-dot" style="left: ${pt.x.toFixed(2)}%; top: ${pt.y.toFixed(2)}%;"></div>`;
    }
    html += '<div class="mpr-rostrum">' + LOC('parliament.rostrum') + '</div>';
    html += '</div>';
    html += '</div>';

    html += '<table width="100%" border="1" cellpadding="7" cellspacing="0" bordercolor="#808080">';
    html += '<tr bgcolor="#000080"><td width="36%"><font color="#FFFFFF"><b>' + LOC('election.col_caucus') + '</b></font></td><td width="16%" align="center"><font color="#FFFFFF"><b>' + LOC('election.col_accept') + '</b></font></td><td width="16%" align="center"><font color="#FFFFFF"><b>' + LOC('election.col_reject') + '</b></font></td><td width="16%" align="center"><font color="#FFFFFF"><b>' + LOC('election.col_blank') + '</b></font></td><td width="16%" align="center"><font color="#FFFFFF"><b>' + LOC('election.col_seats') + '</b></font></td></tr>';

    for (let i = 0; i < finalData.length; i++) {
        const d = finalData[i];
        const partyBadge = renderElectionPartyBadge(d.key, d.name);
        html += `<tr>
            <td>
                ${partyBadge}
                <div class="faction-mini-bar-wrap">
                    <div id="fbar-for-${i}" class="faction-mini-for" style="width: 0%;"></div>
                    <div id="fbar-against-${i}" class="faction-mini-against" style="width: 0%;"></div>
                </div>
            </td>
            <td align="center"><font color="#008000"><b id="f-for-${i}">0</b></font></td>
            <td align="center"><font color="#FF0000"><b id="f-against-${i}">0</b></font></td>
            <td align="center"><font color="#808080"><b id="f-blank-${i}">0</b></font></td>
            <td align="center"><b>${d.totalSeats}</b></td>
        </tr>`;
    }

    html += `<tr bgcolor="#FFFF00">
        <td><b>${LOC('election.tally')}</b></td>
        <td align="center"><font color="#008000" size="4"><b id="tot-for">0</b></font></td>
        <td align="center"><font color="#FF0000" size="4"><b id="tot-against">0</b></font></td>
        <td align="center"><font color="#808080" size="4"><b id="tot-blank">0</b></font></td>
        <td align="center"><b id="tot-counted">0 / ${totalChamberSeats}</b></td>
    </tr></table><br>`;

    html += '<div id="skip-btn-wrap" style="text-align: center;"><button id="skip-tally-btn" style="width: 250px; background-color: #ff9999; text-align: center;" onclick="skipTally()">' + LOC('election.skip_animation') + '</button></div>';
    html += '<div id="election-result-container"></div>';
    html += '</div>';

    document.getElementById('main-panel').innerHTML = html;

    const seatDots = [];
    for (let s = 0; s < hemicycleCoords.length; s++) {
        seatDots.push(document.getElementById(`seat-dot-${s}`));
    }
    const tallyEls = {
        totFor: document.getElementById('tot-for'),
        totAgainst: document.getElementById('tot-against'),
        totBlank: document.getElementById('tot-blank'),
        totCounted: document.getElementById('tot-counted'),
        labelFor: document.getElementById('bar-label-for'),
        labelAgainst: document.getElementById('bar-label-against'),
        tugFor: document.getElementById('tug-for'),
        tugBlank: document.getElementById('tug-blank'),
        tugAgainst: document.getElementById('tug-against'),
        clock: document.getElementById('tally-clock'),
        rows: finalData.map((d, i) => ({
            for: document.getElementById(`f-for-${i}`),
            against: document.getElementById(`f-against-${i}`),
            blank: document.getElementById(`f-blank-${i}`),
            barFor: document.getElementById(`fbar-for-${i}`),
            barAgainst: document.getElementById(`fbar-against-${i}`)
        }))
    };

    function formatFixedClock(dt) {
        let hrs = dt.getHours();
        const mins = String(dt.getMinutes()).padStart(2, '0');
        const ampm = LOC(hrs >= 12 ? 'election.clock.pm' : 'election.clock.am');
        hrs = hrs % 12;
        if (hrs === 0) hrs = 12;
        return LOC('election.clock', { DAY: dt.getDate() === 20 ? 20 : 19, HOUR: String(hrs).padStart(2, '0'), MIN: mins, AMPM: ampm });
    }

    function updateTallyDOM() {
        if (!tallyEls.totFor || !tallyEls.totFor.isConnected) {
            clearTallyInterval();
            return;
        }

        let curTotalFor = 0, curTotalAgainst = 0, curTotalBlank = 0;

        for (let i = 0; i < finalData.length; i++) {
            const d = finalData[i];
            const row = tallyEls.rows[i];
            curTotalFor += d.curFor;
            curTotalAgainst += d.curAgainst;
            curTotalBlank += d.curBlank;

            if (row.for) row.for.innerText = d.curFor;
            if (row.against) row.against.innerText = d.curAgainst;
            if (row.blank) row.blank.innerText = d.curBlank;
            if (row.barFor && d.totalSeats > 0) row.barFor.style.width = `${(d.curFor / d.totalSeats) * 100}%`;
            if (row.barAgainst && d.totalSeats > 0) row.barAgainst.style.width = `${(d.curAgainst / d.totalSeats) * 100}%`;
        }

        const curCounted = curTotalFor + curTotalAgainst + curTotalBlank;
        tallyEls.totFor.innerText = curTotalFor;
        tallyEls.totAgainst.innerText = curTotalAgainst;
        tallyEls.totBlank.innerText = curTotalBlank;
        tallyEls.totCounted.innerText = `${curCounted} / ${totalChamberSeats}`;

        tallyEls.labelFor.innerText = curTotalFor;
        tallyEls.labelAgainst.innerText = curTotalAgainst;

        tallyEls.tugFor.style.width = `${(curTotalFor / totalChamberSeats) * 100}%`;
        tallyEls.tugBlank.style.width = `${(curTotalBlank / totalChamberSeats) * 100}%`;
        tallyEls.tugAgainst.style.width = `${(curTotalAgainst / totalChamberSeats) * 100}%`;

        if (tallyEls.clock) {
            tallyEls.clock.innerText = formatFixedClock(clockTime);
        }

        if (curTotalFor === grandTotalFor && curTotalAgainst === grandTotalAgainst && curTotalBlank === grandTotalBlank) {
            finalizeElectionResult();
        }
    }

    function finalizeElectionResult() {
        if (electionFinished) return;
        electionFinished = true;
        clearTallyInterval();

        const speedCtrl = document.getElementById('speed-controls-container');
        if (speedCtrl) speedCtrl.style.display = 'none';
        const skipWrap = document.getElementById('skip-btn-wrap');
        if (skipWrap) skipWrap.style.display = 'none';

        unlockAchievement('complete_run');
        if (stats.PC >= 100) unlockAchievement('sedia_payung');

        if (
            factions['pdip'] && factions['pdip'].affinity >= 60 &&
            factions['poros_tengah'] && factions['poros_tengah'].affinity >= 60 &&
            factions['golkar_akbar'] && factions['golkar_akbar'].affinity >= 60 &&
            factions['abri'] && factions['abri'].affinity >= 60
        ) {
            unlockAchievement('bhinneka_coalition');
        }

        if (
            bankBaliCleanSteps.defiedIMF &&
            activeDecrees['currency_board'] &&
            stats.econ >= 60
        ) {
            unlockAchievement('camdessus_arms');
        }

        const accepted = grandTotalFor > grandTotalAgainst && (!window.OppositionEngine || OppositionEngine.meetsQuorum(grandTotalFor));
        let resHTML = '';
        if (!accepted && grandTotalFor > grandTotalAgainst && window.OppositionEngine) resHTML += OppositionEngine.quorumFailureHTML(grandTotalFor);

        if (accepted) {
            unlockAchievement('win_any');
            if (window.OppositionEngine) OppositionEngine.achievementsOnWin();
            if (selectedDifficulty === 'historical') unlockAchievement('win_historical');

            const hasIMFDurability = activeDecrees['imf_fuel_subsidy'] && activeDecrees['imf_bulog_deregulation'] && activeDecrees['imf_ibra_liquidation'];
            if (stats.intl >= 100 && stats.econ <= 15 && stats.pop <= 30 && hasIMFDurability) {
                unlockAchievement('bruning_impressed');
            }

            if (lowestGovStability < 35) unlockAchievement('mr_crack');
            if (completedInteractions['loyalist_bppt'] && completedInteractions['loyalist_n250']) unlockAchievement('cleared_for_takeoff');
            if (window.OppositionEngine && OppositionEngine.isMilitaryBroken() && activeDecrees['police_military_separation'] && activeDecrees['human_rights_commission_powers']) {
                unlockAchievement('dwifungsi_kaput');
            }
            if (timorPromiseSteps.countdown && timorPromiseSteps.votes && timorPromiseSteps.peacekeepers) {
                unlockAchievement('thankless_burden');
            }
            if (stats.cendana >= 85 && stats.ref <= 25) unlockAchievement('enak_jamanku');
            if (stats.PC === 0) unlockAchievement('fumes_in_the_tank');
            // Stat tiers below 15 are the bottom tier in stats.json (Bankruptcy, Pariah State, Universally Hated).
            if (stats.econ < 15) unlockAchievement('utang_nanti_dulu');
            if (stats.intl < 15) unlockAchievement('persona_non_grata');
            if (stats.pop < 15) unlockAchievement('sinetron_villain');
            if (!Object.keys(activeDecrees).some(id => activeDecrees[id])) unlockAchievement('presiden_rebahan');
            if (typeof recordDifficultyWin === 'function' && recordDifficultyWin(selectedDifficulty)) unlockAchievement('khatam');
            if (window.SSS && SSS.runMaxed()) unlockAchievement(SSS.ACH_ID);
            if (
                factions['poros_tengah'] && factions['poros_tengah'].affinity >= 85 &&
                factions['utusan_golongan'] && factions['utusan_golongan'].affinity >= 80 &&
                factions['other_parties'] && factions['other_parties'].affinity >= 80
            ) {
                unlockAchievement('habibi_ya_habibi');
            }

            const blocBacksYou = key => {
                const b = finalData.find(x => x.key === key);
                return Boolean(b) && b.totalSeats > 0 && b.targetFor > b.totalSeats / 2;
            };
            if (['golkar_habibie', 'golkar_akbar', 'utusan_daerah', 'utusan_golongan', 'other_parties', 'abri'].every(blocBacksYou)) {
                unlockAchievement('the_center_holds');
            }

            if (stats.ref >= 85 && stats.cendana <= 25) {
                unlockAchievement('singa_reformasi');
            }
            if (activeDecrees['invoke_supersemar_ii'] && activeDecrees['cendana_restoration_pact']) {
                unlockAchievement('orba_jilid_dua');
            }

            let title = '';
            let desc = "";

            if (grandTotalFor >= 450) {
                title = LOC('election.win_overwhelming.title');
                desc = LOC('election.win_overwhelming.desc');
                unlockAchievement('win_overwhelming');
            } else if (grandTotalFor >= 380) {
                title = LOC('election.win_comfortable.title');
                desc = LOC('election.win_comfortable.desc');
                unlockAchievement('win_comfortable');
            } else {
                title = LOC('election.win_narrow.title');
                desc = LOC('election.win_narrow.desc');
                unlockAchievement('win_narrow');
            }

            const winImg = (gameConfig && gameConfig.victoryImage) ? gameConfig.victoryImage : 'photo/victory.png';
            resHTML += `<center><h1 style="color:#008000; margin-bottom: 5px;">${LOC('election.result_heading', { TITLE: title, FOR: grandTotalFor, AGAINST: grandTotalAgainst })}</h1></center>
                <p align="center" style="font-family: MS Sans Serif; font-size: 13px; line-height: 1.5;">${desc}</p>
                <center><span class="glass-frame glass-top"><img src="${winImg}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-top: 10px; margin-bottom: 15px;" alt="${escapeHtml(LOC('election.victory_alt'))}"></span></center>`;
        } else {
            if (typeof getGovStabilityTier === 'function' && ['secure', 'stable'].includes(getGovStabilityTier().id)) unlockAchievement('dipecat_dengan_hormat');
            if (grandTotalFor >= 318 && grandTotalFor <= 326) {
                unlockAchievement('deja_vu_322');
            }
            // Within reach of 351: the blank ballots and absent delegates, not the "no" votes, were the margin.
            if (grandTotalFor >= 330 && grandTotalFor <= 350 && grandTotalFor + grandTotalBlank >= 351) {
                unlockAchievement('those_who_stayed_silent');
            }
            if (
                factions['golkar_habibie'] && factions['golkar_habibie'].affinity >= 85 &&
                factions['golkar_akbar'] && factions['golkar_akbar'].affinity < 35
            ) {
                unlockAchievement('et_tu_akbar');
            }
            if (helpedRaisSpeaker && factions['poros_tengah'] && factions['poros_tengah'].affinity >= 65) {
                unlockAchievement('gus_dur_twist');
            }

            let title = '';
            let desc = "";

            if (grandTotalFor >= 320) {
                title = LOC('election.lose_narrow.title');
                desc = LOC('election.lose_narrow.desc');
                unlockAchievement('lose_narrow');
            } else if (grandTotalFor >= 200) {
                title = LOC('election.lose_decisive.title');
                desc = LOC('election.lose_decisive.desc');
                unlockAchievement('lose_decisive');
            } else {
                title = LOC('election.lose_overwhelming.title');
                desc = LOC('election.lose_overwhelming.desc');
                unlockAchievement('lose_overwhelming');
            }

            const loseImg = (gameConfig && gameConfig.defeatImage) ? gameConfig.defeatImage : 'photo/defeat.png';
            resHTML += `<center><h1 style="color:#FF0000; margin-bottom: 5px;">${LOC('election.result_heading', { TITLE: title, FOR: grandTotalFor, AGAINST: grandTotalAgainst })}</h1></center>
                <p align="center" style="font-family: MS Sans Serif; font-size: 13px; line-height: 1.5;">${desc}</p>
                <center><span class="glass-frame glass-top"><img src="${loseImg}" class="content-image" style="width: 400px; height: 200px; object-fit: cover; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-top: 10px; margin-bottom: 15px;" alt="${escapeHtml(LOC('election.defeat_alt'))}"></span></center>`;
        }

        resHTML += buildTapMprDocumentHTML(accepted, grandTotalFor, grandTotalAgainst, grandTotalBlank);

        window.lastElectionSummary = {
            won: accepted,
            forVotes: grandTotalFor,
            againstVotes: grandTotalAgainst,
            blankVotes: grandTotalBlank,
            totalSeats: totalChamberSeats,
            factionBreakdown: finalData.map(d => ({
                key: d.key,
                name: d.name,
                short: d.short,
                seats: d.totalSeats,
                forVotes: d.targetFor,
                againstVotes: d.targetAgainst,
                blankVotes: d.targetBlank,
                note: d.rebel
            })),
            verdictHTML: resHTML
        };

        resHTML += getPostElectionNavHTML('verdict');
        const resContainer = document.getElementById('election-result-container');
        if (resContainer) resContainer.innerHTML = resHTML;
    }

    window.skipTally = function() {
        clearTallyInterval();
        for (let i = 0; i < finalData.length; i++) {
            const d = finalData[i];
            const remFor = d.targetFor - d.curFor;
            const remAgainst = d.targetAgainst - d.curAgainst;
            const remBlank = d.targetBlank - d.curBlank;

            const outcomes = [];
            for (let f = 0; f < remFor; f++) outcomes.push('for');
            for (let a = 0; a < remAgainst; a++) outcomes.push('against');
            for (let b = 0; b < remBlank; b++) outcomes.push('blank');

            for (let j = outcomes.length - 1; j > 0; j--) {
                const r = Math.floor(Math.random() * (j + 1));
                const tmp = outcomes[j];
                outcomes[j] = outcomes[r];
                outcomes[r] = tmp;
            }

            for (let k = 0; k < outcomes.length; k++) {
                const seatIdx = d.seatPool.pop();
                const dot = seatDots[seatIdx];
                if (!dot) continue;
                if (outcomes[k] === 'for') dot.className = 'mpr-seat-dot seat-for';
                else if (outcomes[k] === 'against') dot.className = 'mpr-seat-dot seat-against';
                else dot.className = 'mpr-seat-dot seat-blank';
            }

            d.curFor = d.targetFor;
            d.curAgainst = d.targetAgainst;
            d.curBlank = d.targetBlank;
        }
        clockTime = new Date("1999-10-20T00:53:00");
        updateTallyDOM();
    };

    const drama = { phase: 'neutral', last: '', left: 14, favorType: null, blocIdx: -1, pace: 1, paceAcc: 0 };

    function pickFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

    function currentTotals() {
        let f = 0, a = 0, b = 0;
        for (let i = 0; i < finalData.length; i++) {
            f += finalData[i].curFor;
            a += finalData[i].curAgainst;
            b += finalData[i].curBlank;
        }
        return { f: f, a: a, b: b };
    }

    function beginNextPhase() {
        const t = currentTotals();
        const lead = t.f - t.a;
        const remFor = grandTotalFor - t.f;
        const remAgainst = grandTotalAgainst - t.a;

        const opts = [];
        if (remFor > 0) opts.push({ kind: 'surge_for', w: lead < 0 ? 4 + Math.min(6, Math.abs(lead) / 6) : 1.2 });
        if (remAgainst > 0) opts.push({ kind: 'surge_against', w: lead > 0 ? 3 + Math.min(5, lead / 6) : 1.2 });
        opts.push({ kind: 'bloc', w: 3 }, { kind: 'lull', w: 1.5 }, { kind: 'neutral', w: 2.5 });

        const usable = opts.filter(o => o.kind !== drama.last || o.kind === 'neutral');
        let roll = Math.random() * usable.reduce((s, o) => s + o.w, 0);
        let kind = usable[usable.length - 1].kind;
        for (let i = 0; i < usable.length; i++) {
            roll -= usable[i].w;
            if (roll <= 0) { kind = usable[i].kind; break; }
        }

        drama.phase = kind;
        drama.last = kind;
        drama.favorType = null;
        drama.blocIdx = -1;

        if (kind === 'surge_for') {
            drama.favorType = 'for';
            drama.left = randInt(14, 34);
            drama.pace = 1.6;
        } else if (kind === 'surge_against') {
            drama.favorType = 'against';
            drama.left = randInt(14, 34);
            drama.pace = 1.6;
        } else if (kind === 'bloc') {
            const cands = [];
            for (let i = 0; i < finalData.length; i++) {
                const d = finalData[i];
                const rem = (d.targetFor - d.curFor) + (d.targetAgainst - d.curAgainst) + (d.targetBlank - d.curBlank);
                if (rem >= 3) cands.push({ idx: i, rem: rem, rebel: d.rebel });
            }
            if (cands.length === 0) {
                drama.phase = 'neutral';
                drama.left = randInt(8, 16);
                drama.pace = 1;
                return;
            }
            const rebels = cands.filter(c => c.rebel);
            const chosen = (rebels.length > 0 && Math.random() < 0.55) ? pickFrom(rebels) : pickFrom(cands);
            drama.blocIdx = chosen.idx;
            drama.left = Math.min(chosen.rem, randInt(8, 22));
            drama.pace = 1.15;
        } else if (kind === 'lull') {
            drama.left = randInt(5, 12);
            drama.pace = 0.35;
        } else {
            drama.left = randInt(12, 28);
            drama.pace = 1;
        }
    }

    function castOneBallot() {
        const avail = [];
        let totalW = 0;
        for (let i = 0; i < finalData.length; i++) {
            const d = finalData[i];
            const blocBoost = (drama.phase === 'bloc' && drama.blocIdx === i) ? ELECTION_DRAMA.blocBias : 1;
            const rems = {
                for: d.targetFor - d.curFor,
                against: d.targetAgainst - d.curAgainst,
                blank: d.targetBlank - d.curBlank
            };
            ['for', 'against', 'blank'].forEach(type => {
                if (rems[type] <= 0) return;
                const typeBoost = (type === drama.favorType) ? ELECTION_DRAMA.surgeBias : 1;
                const w = rems[type] * blocBoost * typeBoost;
                avail.push({ idx: i, type: type, w: w });
                totalW += w;
            });
        }
        if (avail.length === 0) return false;

        let roll = Math.random() * totalW;
        let pick = avail[avail.length - 1];
        for (let k = 0; k < avail.length; k++) {
            roll -= avail[k].w;
            if (roll <= 0) { pick = avail[k]; break; }
        }

        const facData = finalData[pick.idx];
        const dot = seatDots[facData.seatPool.pop()];

        if (pick.type === 'for') {
            facData.curFor++;
            if (dot) dot.className = 'mpr-seat-dot seat-for';
        } else if (pick.type === 'against') {
            facData.curAgainst++;
            if (dot) dot.className = 'mpr-seat-dot seat-against';
        } else {
            facData.curBlank++;
            if (dot) dot.className = 'mpr-seat-dot seat-blank';
        }

        clockTime.setSeconds(clockTime.getSeconds() + 22);

        drama.left--;
        if (drama.phase === 'bloc') {
            const b = finalData[drama.blocIdx];
            if (b.curFor >= b.targetFor && b.curAgainst >= b.targetAgainst && b.curBlank >= b.targetBlank) drama.left = 0;
        } else if (drama.favorType === 'for' && finalData.every(d => d.curFor >= d.targetFor)) {
            drama.left = 0;
        } else if (drama.favorType === 'against' && finalData.every(d => d.curAgainst >= d.targetAgainst)) {
            drama.left = 0;
        }
        if (drama.left <= 0) beginNextPhase();
        return true;
    }

    window.activeTallyInterval = setInterval(() => {
        drama.paceAcc += window.tallySpeed * drama.pace;
        const steps = Math.floor(drama.paceAcc);
        drama.paceAcc -= steps;

        for (let s = 0; s < steps; s++) {
            if (!castOneBallot()) {
                clearTallyInterval();
                updateTallyDOM();
                return;
            }
        }

        if (!electionFinished) {
            updateTallyDOM();
        }
    }, 120);
}

// Builds the navigation buttons that switch between the election verdict and the State of the Republic dossier.
function getPostElectionNavHTML(activeView) {
    const isVerdict = activeView === 'verdict';
    const isDossier = activeView === 'dossier';

    return `<div style="margin-top: 14px; padding-top: 12px; border-top: 2px solid var(--win95-shadow); text-align: center;">
        <button class="${isVerdict ? 'is-selected' : ''}" style="width: 220px; display: inline-block; text-align: center; margin: 4px;" onclick="showPostElectionSection('verdict')">${LOC('election.nav.verdict')}</button>
        <button class="${isDossier ? 'is-selected' : ''}" style="width: 230px; display: inline-block; text-align: center; margin: 4px;" onclick="showPostElectionSection('dossier')">${LOC('election.nav.dossier')}</button>
        <br>
        <button style="width: 250px; display: inline-block; text-align: center; margin-top: 10px; background-color: var(--tint-good);" onclick="showEpilogue()">${LOC('common.continue')}</button>
    </div>`;
}

// Show the chosen section of the post-election screen
window.showPostElectionSection = function(section) {
    const container = document.getElementById('election-result-container');
    if (!container || !window.lastElectionSummary) return;

    if (section === 'verdict') {
        container.innerHTML = window.lastElectionSummary.verdictHTML + getPostElectionNavHTML('verdict');
    } else if (section === 'dossier') {
        container.innerHTML = buildStateOfTheRepublicHTML() + getPostElectionNavHTML('dossier');
    }

    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Epilogue sections. Each one is an image id (photo/epilogue/epilogue_<id>.png is optional) plus text read from
// data/language/*/epilogue.json: epilogue.<id>.caption, epilogue.<id>.title and paragraphs epilogue.<id>.p1, p2, ...
const EPILOGUE_SECTIONS = ['end'].map(id => ({
    id: id,
    get caption() { return LOC(`epilogue.${id}.caption`); },
    get title() { return LOC(`epilogue.${id}.title`); },
    get text() {
        const paragraphs = [];
        for (let i = 1; LOC.has(`epilogue.${id}.p${i}`); i++) paragraphs.push(LOC(`epilogue.${id}.p${i}`));
        return paragraphs.join('<br><br>');
    }
}));

// Epilogue image block
function buildEpilogueImageHTML(sec) {
    const src = (gameConfig && gameConfig.epilogueImages && gameConfig.epilogueImages[sec.id]) || `photo/epilogue/epilogue_${sec.id}.png`;
    const cap = escapeHtml(sec.caption);
    return `<center><div style="position: relative; width: 100%; max-width: 880px; aspect-ratio: 2 / 1; max-height: 440px; box-sizing: border-box; border: 3px inset #FFFFFF; background-color: #A9A9A9; margin-bottom: 15px; overflow: hidden;">
        <span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 11px; color: #555; padding: 6px;">${LOC('dash.photo_placeholder', { NAME: cap })}</span>
        <img src="${escapeHtml(src)}" alt="${cap}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
    </div></center>`;
}

// Show the epilogue
window.showEpilogue = function() {
    const sum = window.lastElectionSummary;
    const mainPanel = document.getElementById('main-panel');
    const leftPanel = document.getElementById('left-panel');
    const mprDashboard = document.getElementById('mpr-dashboard');
    if (!mainPanel) return;

    if (mainPanel.querySelector('#election-result-container')) window.electionPanelSnapshot = mainPanel.innerHTML;
    window.epilogueActive = true;
    if (leftPanel) leftPanel.style.display = 'none';
    if (mprDashboard) mprDashboard.style.display = 'none';
    mainPanel.style.width = '100%';
    if (typeof updateMobileStatusBar === 'function') updateMobileStatusBar();

    const won = Boolean(sum && sum.won);
    const intro = LOC(won ? 'epilogue.intro_won' : 'epilogue.intro_lost');

    let html = '<center><h2>' + LOC('epilogue.title') + '</h2></center>';
    const bodyStyle = 'padding: 15px; margin-bottom: 10px; font-family: MS Sans Serif, sans-serif; font-size: 13px; line-height: 1.6; color: #333; text-align: justify;';

    html += `<div style="${bodyStyle}"><b>${LOC('situation.salutation')}</b><br><br>${intro} ${LOC('epilogue.intro_common')}</div>`;

    EPILOGUE_SECTIONS.forEach(sec => {
        html += buildEpilogueImageHTML(sec);
        html += `<center><h3 style="margin: 0 0 4px 0;">${sec.title}</h3></center>`;
        html += `<div style="${bodyStyle}">${sec.text}</div>`;
    });

    html += `<div style="${bodyStyle} text-align: center; font-style: italic;">${LOC('epilogue.closing')}</div>`;
    html += '<center>';
    html += '<button style="width: 300px; text-align: center; margin-bottom: 8px; --py: 10px; --px: 10px;" onclick="returnToTitleScreen()">' + LOC('epilogue.btn_title') + '</button><br>';
    html += '<button style="width: 300px; text-align: center; background-color: #ff9999; --py: 10px; --px: 10px;" onclick="closeEpilogue()">' + LOC('epilogue.btn_back') + '</button>';
    html += '</center>';
    mainPanel.innerHTML = html;
    scrollMainPanelToTop();
};

// Leave the epilogue and restore the election results with the side panels
window.closeEpilogue = function() {
    window.epilogueActive = false;
    syncSidebarVisibility();
    if (typeof updateMobileStatusBar === 'function') updateMobileStatusBar();
    const mainPanel = document.getElementById('main-panel');
    if (window.electionPanelSnapshot && mainPanel) {
        mainPanel.innerHTML = window.electionPanelSnapshot;
        scrollMainPanelToTop();
    } else {
        returnToTitleScreen();
    }
};