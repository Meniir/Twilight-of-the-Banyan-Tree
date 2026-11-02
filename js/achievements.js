// SUMMARY: Achievement system: tracking flags, unlock rules checked against the game state, a one-at-a-time toast queue
// and the Achievements screen. Load order: after storage.js, before game.js.

// Counters and flags that achievement rules read (also saved with the campaign by storage.js).
let lowestGovStability = 100;
let bankBaliCleanSteps = {};
let timorPromiseSteps = {};
let sp3UpheldWithHighCendana = false;
let helpedRaisSpeaker = false;

// Ids of unlocked achievements (loaded from storage) and the achievement definitions (filled by game.js from achievements.json).
let unlockedAchievements = loadUnlockedAchievements();
let ACHIEVEMENTS = [];

// Final Appeals, one per faction that has one. They are open on the last two action turns (the Speech and the Night of the Long Knives), one per turn, so a run can use at most two.
const FINAL_APPEAL_IDS = ['tni_final_appeal', 'golkar_final_appeal', 'loyalist_final_stand', 'pdip_final_appeal', 'axis_final_deal', 'others_final_appeal', 'daerah_final_appeal', 'golongan_final_appeal'];

// True if every listed decree is enacted / every listed routine action was used at least once.
function allDecreesEnacted(ids) { return ids.every(id => activeDecrees[id]); }
function allRoutinesUsed(ids) { return ids.every(id => (actionUsageCount[id] || 0) > 0); }

// Evaluates every unlock rule against the current game state; stat-based ones only count on medium, high and historical difficulty.
function checkAchievements() {
    if (!gameStarted) return;

    const curGovStab = getGovStability();
    if (curGovStab < lowestGovStability) {
        lowestGovStability = curGovStab;
    }

    if (['medium', 'high', 'historical'].includes(selectedDifficulty)) {
        if (stats.pop >= 90) unlockAchievement('pop_max');
        if (stats.cendana <= 0) unlockAchievement('cendana_zero');
        if (factions['pdip'] && factions['pdip'].affinity >= 100) unlockAchievement('pdip_max');
        if (stats.stab >= 90) unlockAchievement('aman_terkendali');

        const hasIMFDurability = activeDecrees['imf_fuel_subsidy'] && activeDecrees['imf_bulog_deregulation'] && activeDecrees['imf_ibra_liquidation'];
        if (stats.intl >= 100 && stats.econ <= 15 && stats.pop <= 30 && hasIMFDurability) {
            unlockAchievement('always_more_austerity');
        }
    }

    if (sp3UpheldWithHighCendana) {
        unlockAchievement('halo_andi');
    }

    if (bankBaliCleanSteps.frozeEGP && bankBaliCleanSteps.pwcAccess && completedInteractions['pdip_pansus_bankbali'] && bankBaliCleanSteps.declassifiedPwC) {
        unlockAchievement('baligate_clean');
    }

    if (activeDecrees['ban_pdip_subversion']) {
        unlockAchievement('kudatuli_redux');
    }
    if (activeDecrees['dissolve_golkar_old_guard']) {
        unlockAchievement('beringin_tumbang');
    }
    if (activeDecrees['abolish_abri_mpr_seats'] && activeDecrees['abolish_kodam_territorial']) {
        unlockAchievement('back_to_the_barracks');
    }
    if (activeDecrees['enforce_asas_tunggal_ban']) {
        unlockAchievement('asas_tunggal_restored');
    }
    if (activeDecrees['unify_golkar_slipi']) {
        unlockAchievement('unify_golkar');
    }
    if (activeDecrees['rainbow_coalition_accord']) {
        unlockAchievement('rainbow_coalition');
    }

    // Decree and routine-action sets.
    if (allDecreesEnacted(['anti_corruption', 'civil_service_neutrality', 'direct_presidential_amendment', 'suharto_asset_seizure_tribunal', 'political_prisoner_release', 'human_rights_commission_powers', 'broadcast_liberalization'])) {
        unlockAchievement('total_reformasi');
    }
    if (allDecreesEnacted(['civilian_defense_ministry', 'police_military_separation', 'abolish_kodam_territorial', 'abolish_abri_mpr_seats'])) {
        unlockAchievement('finis_dwifungsi');
    }
    if (allDecreesEnacted(['regional_autonomy', 'aceh_special_status_law', 'maluku_irja_division'])) {
        unlockAchievement('nkri_terms');
    }
    if (activeDecrees['chinese_cultural_ban_repeal'] &&
        allRoutinesUsed(['trisakti_semanggi_commemoration', 'chinatown_reconciliation', 'womens_commission', 'sbkri_review', 'declassify_1965_files'])) {
        unlockAchievement('tolak_lupa');
    }
    if (activeDecrees['suharto_asset_seizure_tribunal'] && allRoutinesUsed(['seize_cendana_tolls', 'audit_kodam_foundations'])) {
        unlockAchievement('cendana_cashback');
    }
    if (allDecreesEnacted(['ratify_kamra_militia_bill', 'reinstate_siupp_censorship', 'purge_utusan_golongan']) && allRoutinesUsed(['mobilize_pam_swakarsa'])) {
        unlockAchievement('empire_strikes_beringin');
    }
    if (activeDecrees['reinstate_siupp_censorship']) {
        unlockAchievement('siupp_is_back');
    }

    // Faction play: the finale telephone calls and banked Favors.
    if (FINAL_APPEAL_IDS.filter(id => completedInteractions[id]).length >= 2) {
        unlockAchievement('halo_halo_senayan');
    }
    if (Object.keys(factions).filter(k => (factions[k].favor || 0) >= 1).length >= 6) {
        unlockAchievement('utang_budi');
    }
}

// Unlocks an achievement once, saves it and queues its toast.
function unlockAchievement(id) {
    if (!unlockedAchievements.includes(id)) {
        unlockedAchievements.push(id);
        saveUnlockedAchievements();
        const achv = ACHIEVEMENTS.find(a => a.id === id);
        if (achv) showAchievementToast(achv);
    }
}

// Toast queue state: toasts are shown one at a time.
const achievementToastQueue = [];
let achievementToastBusy = false;

// Adds a toast to the queue and starts showing it if nothing is showing.
function showAchievementToast(achv) {
    achievementToastQueue.push(achv);
    if (!achievementToastBusy) showNextAchievementToast();
}

// Shows the next queued toast with its sound for 3.5 seconds, then continues with the queue.
function showNextAchievementToast() {
    const toast = document.getElementById('achievement-toast');
    const achv = achievementToastQueue.shift();
    if (!toast || !achv) {
        achievementToastBusy = false;
        achievementToastQueue.length = 0;
        return;
    }
    achievementToastBusy = true;
    document.getElementById('toast-name').innerText = LOC.r(achv.title);
    toast.style.display = 'block';
    if (typeof window.playAchievementSfx === 'function') window.playAchievementSfx();
    setTimeout(() => {
        toast.style.display = 'none';
        if (achievementToastQueue.length > 0) setTimeout(showNextAchievementToast, 250);
        else achievementToastBusy = false;
    }, 3500);
} 

// Renders the Achievements screen with locked and unlocked entries.
window.showAchievementsMenu = function() {
    if (!enterMenuView()) return;
    scrollMainPanelToTop();
    let html = '<center><h2>' + LOC('title.achievements') + '</h2></center>';
    html += '<p style="font-family: MS Sans Serif; font-size: 13px; color: #333; text-align: center; margin-bottom: 20px;">' + LOC('achievements.intro') + '</p>';

    ACHIEVEMENTS.forEach(achv => {
        const rowClass = unlockedAchievements.includes(achv.id) ? 'unlocked' : 'locked';

        html += `<div class="achievement-row ${rowClass}">
                    <div class="achievement-details"> 
                        <div class="achievement-title">${LOC.r(achv.title)}</div>
                        <div class="achievement-desc">${LOC.r(achv.desc)}</div>
                    </div>
                 </div>`;
    });

    html += `<center><button style="width: 250px; margin-top: 20px; background-color: #ff9999; text-align: center;" onclick="returnToPreviousView()">${LOC('common.back')}</button></center>`;
    document.getElementById('main-panel').innerHTML = html;
};