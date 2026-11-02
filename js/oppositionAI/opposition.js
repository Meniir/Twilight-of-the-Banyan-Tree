// SUMMARY: Opposition AI core. Tracks grievance, tainted seats, coalition tension and secret-ballot betrayal, runs the election-night
// adjustments, and exposes everything to the game as window.OppositionEngine. The military and PDI-P are separate modules that plug
// into this core: js/oppositionAI/tni.js (patience / anger meter, incidents) and js/oppositionAI/pdip.js (street mobilization meter).
// Text comes from the language files. Load order: this file first, then tni.js and pdip.js (all after game.js).

(function () {
    'use strict';

    // Tuning values: difficulty scale, grievance and election drama levels.
    const OPP_CONFIG = {
        scale: { easy: 0.25, medium: 0.6, high: 0.85, historical: 1.0 },
        grievanceCap: 20,
        tensionThreshold: 62,
        drama: {
            easy:       { moodSwing: 6,  wildcardChance: 0.25, wildcardMin: 12, wildcardMax: 25, crossoverRate: 0.12 },
            medium:     { moodSwing: 8,  wildcardChance: 0.35, wildcardMin: 15, wildcardMax: 35, crossoverRate: 0.20 },
            high:       { moodSwing: 10, wildcardChance: 0.45, wildcardMin: 18, wildcardMax: 45, crossoverRate: 0.28 },
            historical: { moodSwing: 12, wildcardChance: 1.0, wildcardMin: 25, wildcardMax: 50, crossoverRate: 0.55 }
        }
    };

    // Decrees that raise grievance, and the regional ones (the military module reacts to those).
    const GRIEVANCE_DECREES = {
        police_military_separation: 2,
        civilian_defense_ministry: 2,
        abolish_kodam_territorial: 3,
        aceh_special_status_law: 2,
        regional_autonomy: 1,
        maluku_irja_division: 1,
        dissolve_golkar_old_guard: 1
    };

    // Fresh opposition state: grievance, tainted seats, crisis flag and counters. Modules keep their own state.
    function freshState() {
        return {
            lastTurnCendana: 95,
            grievance: 0,
            tainted: {},
            crisis: false,
            abriAbolished: false,
            disruptionTurn: -1,
            coalitionTicks: 0,
            incidentCount: 0,
            log: []
        };
    }

    // The live opposition state and the plugged-in modules (tni, pdip).
    let state = freshState();
    const modules = {};

    // Keeps the old global that other scripts may still read.
    function syncGlobals() {
        window.lastTurnCendana = state.lastTurnCendana;
    }

    // Opposition strength multiplier for the current difficulty.
    function diffOpp() {
        const d = (typeof gameConfig !== 'undefined' && gameConfig.difficultySettings) ? gameConfig.difficultySettings[selectedDifficulty] : null;
        return (d && d.opposition) || null;
    }
    function sc() {
        const o = diffOpp();
        if (o && typeof o.scale === 'number') return o.scale;
        return OPP_CONFIG.scale[selectedDifficulty] !== undefined ? OPP_CONFIG.scale[selectedDifficulty] : 1;
    }
    // A number for the current difficulty: the difficulty's own "opposition" block first, then a per-difficulty table (Historical for unknown tiers).
    function diffValue(table, overrideKey) {
        const o = diffOpp();
        if (overrideKey && o && typeof o[overrideKey] === 'number') return o[overrideKey];
        return table[selectedDifficulty] !== undefined ? table[selectedDifficulty] : table.historical;
    }
    // Midpoint of a number, [min,max] pair or "a..b" string (effects may be ranges)
    function mid(v) {
        if (Array.isArray(v) && v.length === 2) return (Number(v[0]) + Number(v[1])) / 2 || 0;
        if (typeof v === 'string' && v.indexOf('..') >= 0) {
            const n = v.split(/\.+/).map(x => parseInt(x, 10)).filter(x => !isNaN(x));
            return n.length === 2 ? (n[0] + n[1]) / 2 : 0;
        }
        return Number(v) || 0;
    }
    function active(key) {
        const f = (typeof factions !== 'undefined') ? factions[key] : null;
        return Boolean(f && f.seats > 0 && !bannedFactions[key]);
    }
    function markDisruption() { state.disruptionTurn = currentTurn; }
    function quietTurn() { return state.disruptionTurn !== currentTurn; }

    // Applies the difficulty's election drama settings to the election tuning object.
    function applyDrama() {
        if (typeof ELECTION_DRAMA === 'undefined') return;
        const d = OPP_CONFIG.drama[selectedDifficulty] || OPP_CONFIG.drama.high;
        const o = diffOpp();
        Object.assign(ELECTION_DRAMA, d, (o && o.drama) || {});
    }

    // Looks up a text in the language files.
    function loc(key, params) { return LOC(key, params); }

    // Placeholder for popups (opposition effects are not active yet); called by the game for compatibility.
    function flushPopups() {}

    // Adds grievance (capped) and logs the reason.
    function addGrievance(n, why) {
        if (!n) return;
        state.grievance = Math.max(0, Math.min(OPP_CONFIG.grievanceCap, state.grievance + n));
        if (why) state.log.push({ turn: currentTurn, grievance: n, why });
    }

    // Everything a module can use from the core.
    const util = {
        sc, diffOpp, diffValue, mid, active, markDisruption, quietTurn, addGrievance, loc,
        state: () => state,
        clamp01: v => Math.max(0, Math.min(1, v)),
        // Rounds at random so small scaled amounts keep their expected value.
        stochRound: x => { const f = Math.floor(x); return f + (Math.random() < (x - f) ? 1 : 0); }
    };

    // Plugs a module into the core. A module may provide: name, api, reset(), getState(), restoreState(saved, fullSavedState),
    // onEndOfTurn(), onDecreeEnacted(type, def), onEventChoice(ev, idx, option), onAbriAbolished(), affinityAdjust(key),
    // electionSeatAdjust(key, f, finalAffinity, votesFor, votesAgainst, blankVotes).
    function register(mod) {
        if (!mod || !mod.name) return;
        modules[mod.name] = mod;
        if (mod.api) Object.keys(mod.api).forEach(k => { engine[k] = mod.api[k]; });
        if (mod.reset) mod.reset();
    }
    function eachModule(fn) {
        Object.keys(modules).forEach(n => { try { fn(modules[n]); } catch (e) { console.error('[opposition] module ' + n + ':', e); } });
    }

    // Triggers the constitutional crisis after ABRI's MPR seats are abolished.
    function triggerConstitutionalCrisis() {
        state.crisis = true;
        state.abriAbolished = true;
        eachModule(m => { if (m.onAbriAbolished) m.onAbriAbolished(); });
        syncGlobals();
        addGrievance(6, 'abolished_abri_seats');
        markDisruption();
    }

    // Records every faction's seat count before a decree or action.
    function snapshotSeats() {
        const snap = {};
        for (const k in factions) snap[k] = factions[k].seats || 0;
        return snap;
    }

    // Marks seats gained after a decree as tainted, so they may walk out in the vote.
    function recordSeatTransfer(snap, _decreeId) {
        if (!snap) return;
        for (const k in factions) {
            const gain = (factions[k].seats || 0) - (snap[k] || 0);
            if (gain > 0) state.tainted[k] = (state.tainted[k] || 0) + gain;
        }
    }

    // After a decree: adds grievance, may trigger the crisis, and lets the modules react.
    function onDecreeEnacted(type, def) {
        if (GRIEVANCE_DECREES[type]) addGrievance(GRIEVANCE_DECREES[type], 'decree:' + type);
        if (type === 'abolish_abri_mpr_seats') triggerConstitutionalCrisis();
        eachModule(m => { if (m.onDecreeEnacted) m.onDecreeEnacted(type, def); });
    }

    // Event choice hook: the modules may add grievance or change the outcome.
    function onEventChoice(ev, idx, option) {
        const out = { sabotaged: false, effects: null, suffix: '' };
        eachModule(m => { if (m.onEventChoice) m.onEventChoice(ev, idx, option, out); });
        return out;
    }

    // End-of-turn opposition step: module steps (incidents, meters), grievance changes, coalition tension and Cendana tracking.
    function onEndOfTurn() {
        if (!gameStarted) return;
        const lvl = engine.milHostility();
        state.log = state.log.slice(-60);

        eachModule(m => { if (m.onEndOfTurn) m.onEndOfTurn(); });

        if (lvl >= 2) addGrievance(lvl === 3 ? 2 : 1, 'hostile_military');
        else if (lvl === 0 && state.grievance > 0 && !state.crisis) state.grievance = Math.max(0, state.grievance - 0.5);

        if (sc() > 0.25 && active('pdip') && active('poros_tengah')) {
            const a = factions.pdip;
            const b = factions.poros_tengah;
            if (a.affinity >= OPP_CONFIG.tensionThreshold && b.affinity >= OPP_CONFIG.tensionThreshold) {
                state.coalitionTicks++;
            }
        }

        state.lastTurnCendana = stats.cendana;
        syncGlobals();
        flushPopups();
    }

    // Builds the Cendana warning or reassurance note for the whip count.
    function getCendanaWhipNoteHTML() {
        if (stats.cendana >= 70) {
            return `<div style="margin-top: 6px; color: #8B0000; font-weight: bold;">&#9888; ${loc('status.cendana_whip.high')}</div>`;
        }
        if (stats.cendana <= 30) {
            return `<div style="margin-top: 6px; color: #006400; font-weight: bold;">&#10003; ${loc('status.cendana_whip.low')}</div>`;
        }
        return '';
    }

    // Computes secret-ballot betrayal pressure from stability, economy, Cendana, popularity and reformasi credibility.
    function getBetrayalPressure() {
        let pressure = 0;
        if (stats.stab < 25) pressure += 14;
        else if (stats.stab < 45) pressure += 7;
        else if (stats.stab >= 75) pressure -= 5;

        if (stats.econ < 25) pressure += 12;
        else if (stats.econ < 45) pressure += 6;
        else if (stats.econ >= 75) pressure -= 4;

        if (stats.cendana >= 80) pressure += 14;
        else if (stats.cendana >= 60) pressure += 7;
        else if (stats.cendana <= 30) pressure -= 5;

        if (stats.pop < 30) pressure += 8;
        else if (stats.pop < 45) pressure += 4;
        if (stats.ref < 30) pressure += 8;
        else if (stats.ref < 45) pressure += 4;

        return Math.max(0, pressure * sc());
    }

    // Computes a faction's secret-ballot defection rate from pressure, susceptibility and loyalty.
    function getDefectionRate(key, effAff) {
        if (key === 'golkar_habibie') return 0.02;

        const pressure = getBetrayalPressure();
        let susceptibility = 1.0;
        if (key === 'golkar_akbar') susceptibility = 1.45;
        if (key === 'utusan_daerah') susceptibility = 1.30;
        if (key === 'poros_tengah') susceptibility = 1.35;
        if (key === 'other_parties') susceptibility = 1.25;
        if (key === 'abri') susceptibility = 0.5; // barrack discipline

        let loyaltyShield = 1.0;
        if (effAff >= 85) loyaltyShield = 0.20;
        else if (effAff >= 70) loyaltyShield = 0.50;
        else if (effAff >= 50) loyaltyShield = 0.90;
        else loyaltyShield = 1.25;

        const baseDefection = (pressure * 0.0085) * susceptibility * loyaltyShield;
        const o = diffOpp();
        const defMult = (o && typeof o.defectionMult === 'number') ? o.defectionMult : 1;
        return Math.max(0, Math.min(0.55, baseDefection * defMult));
    }

    // Computes the affinity adjustment for a faction from grievance, coalition double-dealing, the crisis and the modules.
    function affinityAdjust(key) {
        const s = sc();
        let adj = 0;

        if (s > 0) {
            if (key === 'pdip') {
                adj -= Math.min(18, Math.round(state.grievance * 1.35 * s));
            }

            if ((key === 'pdip' || key === 'poros_tengah') && active('pdip') && active('poros_tengah')) {
                const a = factions.pdip.affinity, b = factions.poros_tengah.affinity;
                if (a >= 65 && b >= 65) {
                    const me = key === 'pdip' ? a : b;
                    adj -= Math.round(Math.min(me - 60, 16) * 0.65 * s);
                }
            }

            if (state.crisis) {
                if (key === 'golkar_akbar') adj -= Math.round(12 * s);
                if (key === 'utusan_daerah') adj -= Math.round(6 * s);
            }
        }
        eachModule(m => { if (m.affinityAdjust) adj += m.affinityAdjust(key) || 0; });
        return adj;
    }

    // Computes votes lost from tainted seats.
    function taintLoss(key, voteRate) {
        const t = state.tainted[key] || 0;
        return t * 0.35 * sc() * voteRate;
    }

    // Adjusts election-night votes: betrayal flips accept votes to reject, tainted seats walk out, and a module may lock a bloc's vote.
    function electionSeatAdjust(key, f, finalAffinity, votesFor, votesAgainst, blankVotes) {
        const s = sc();
        let locked = false;
        if (s >= 0.5 && votesFor > 0) {
            const rate = getDefectionRate(key, finalAffinity) * 0.65;
            const flip = Math.min(votesFor, Math.round(votesFor * rate));
            votesFor -= flip;
            votesAgainst += flip;
        }
        const t = state.tainted[key] || 0;
        if (t > 0 && votesFor > 0) {
            const share = votesFor / Math.max(1, votesFor + votesAgainst);
            const lost = Math.min(votesFor, Math.round(t * 0.35 * s * share));
            votesFor -= lost;
            blankVotes += lost;
        }
        eachModule(m => {
            if (!m.electionSeatAdjust) return;
            const r = m.electionSeatAdjust(key, f, finalAffinity, votesFor, votesAgainst, blankVotes);
            if (r) {
                votesFor = r.votesFor; votesAgainst = r.votesAgainst; blankVotes = r.blankVotes;
                if (r.locked) locked = true;
            }
        });
        return { votesFor, votesAgainst, blankVotes, locked };
    }

    // True when a module has forced a bloc's whole vote (used by the whip forecast and the election screen).
    function isVoteLocked(key) {
        let locked = false;
        eachModule(m => { if (m.isVoteLocked && m.isVoteLocked(key)) locked = true; });
        return locked;
    }

    // The vote only carries with a majority of the ORIGINAL chamber (351 of 700), even when banned factions have shrunk the seated chamber.
    function meetsQuorum(forVotes) {
        let orig = 0;
        for (const k in initialFactionsSnapshot) orig += (initialFactionsSnapshot[k].seats || 0);
        return forVotes >= Math.floor(orig / 2) + 1;
    }

    // Builds the quorum failure message.
    function quorumFailureHTML(forVotes) {
        return `<div class="faction-summary" style="text-align:justify;color:var(--tone-bad);margin-bottom:8px;">${loc('election.quorum_failure', { VOTES: forVotes, votes: forVotes })}</div>`;
    }

    // Unlocks the opposition-related achievements after a winning vote.
    function achievementsOnWin() {
        if (typeof unlockAchievement !== 'function') return;
        if (engine.isPdipLocked()) unlockAchievement('kaos_merah');
        if (typeof engine.getMilitaryMeter === 'function' && engine.getMilitaryMeter().live && !engine.isMilitaryBroken()) unlockAchievement('ngopi_dulu');
        if (active('pdip') && active('poros_tengah') && state.coalitionTicks >= 2 &&
            factions.pdip.affinity >= 70 && factions.poros_tengah.affinity >= 70) {
            unlockAchievement('odd_bedfellows');
        }
    }

    // Resets the opposition state (and every module) for a new campaign.
    function reset() {
        state = freshState();
        eachModule(m => { if (m.reset) m.reset(); });
        syncGlobals();
        applyDrama();
    }

    // Returns a copy of the state for saving (modules under "mods").
    function getState() {
        const out = JSON.parse(JSON.stringify(state));
        out.mods = {};
        eachModule(m => { if (m.getState) out.mods[m.name] = JSON.parse(JSON.stringify(m.getState())); });
        return out;
    }

    // Restores a saved state; saves from before the split (military fields at the top level) are still understood.
    function restoreState(s) {
        s = s || {};
        const keep = Object.assign({}, s);
        delete keep.mods;
        ['wirantoLocked', 'wirantoStrain', 'milPhase', 'milValue', 'milTouched', 'timorFlare', 'acehFlare'].forEach(k => delete keep[k]);
        state = Object.assign(freshState(), keep);
        eachModule(m => { if (m.restoreState) m.restoreState((s.mods && s.mods[m.name]) || null, s); });
        syncGlobals();
        applyDrama();
    }

    // The public engine object used by the game, election and debug code. The defaults below are replaced when tni.js / pdip.js load,
    // so the game still runs (without those meters) if a module file is missing.
    const engine = {
        config: OPP_CONFIG,
        loc,
        util,
        register,
        reset,
        getState,
        restoreState,
        onEndOfTurn,
        onEventChoice,
        onDecreeEnacted,
        flushPopups,
        getCendanaWhipNoteHTML,
        snapshotSeats,
        recordSeatTransfer,
        getBetrayalPressure,
        getDefectionRate,
        affinityAdjust,
        taintLoss,
        electionSeatAdjust,
        isVoteLocked,
        meetsQuorum,
        quorumFailureHTML,
        achievementsOnWin,

        // ---- Defaults for the module APIs (military: tni.js, PDI-P: pdip.js) ----
        milHostility: () => 0,
        applyMilitaryDelta: delta => {
            if (typeof factions === 'undefined' || !factions['abri'] || !delta) return;
            factions['abri'].affinity = clampFaction('abri', factions['abri'].affinity + delta);
            stats.mil = Math.round(factions['abri'].affinity);
        },
        getMilitaryMeter: () => null,
        getMilitaryMeterHTML: () => '',
        getMilitaryResistanceNoteHTML: () => '',
        getMilitaryResistance: () => 0,
        getMilitaryGainMult: () => 1,
        onMilitaryInteraction: () => {},
        isMilitaryBroken: () => false,
        getPdipMeter: () => null,
        getPdipMeterHTML: () => '',
        getPdipTier: () => 0,
        getPdipCostMult: () => 1,
        getPdipCut: () => 0,
        getPdipGainMult: () => 1,
        isPdipLocked: () => false,
        onPdipInteraction: () => {},
        onPdipDelta: () => {},

        debug: {
            list: () => Object.keys(modules).map(n => (modules[n].debug && modules[n].debug.list ? modules[n].debug.list() : [])).reduce((a, b) => a.concat(b), []),
            fire: id => eachModule(m => { if (m.debug && m.debug.fire) m.debug.fire(id); }),
            crisis: () => { triggerConstitutionalCrisis(); flushPopups(); },
            modules: () => modules,
            state: () => state
        }
    };

    // Exposes the engine as window.OppositionEngine.
    window.OppositionEngine = engine;
})();