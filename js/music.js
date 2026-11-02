// SUMMARY: Controls the background music player: track list setup, square album cover art display,
// Play/Pause, Next/Skip, Previous track, auto-advance on track end, seek bar, volume control and Settings toggle.

let currentTrackIndex = 0;
let musicAutoStarted = false;
let trackHistory = [];
window.musicSeeking = false;

// Genres offered in the genre dropdown. A track picks its genre with "genre" in music.json; 'all' shows everything.
const MUSIC_GENRES = ['all', 'national', 'critique', 'pop', 'international'];
let activeGenre = 'all';
try {
    const savedGenre = localStorage.getItem('habibie_music_genre');
    if (MUSIC_GENRES.includes(savedGenre)) activeGenre = savedGenre;
} catch (e) { /* storage unavailable: stay on all */ }

// Formats seconds into M:SS
function formatMusicTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// Updates the playback seek slider and current/duration time labels
function updateMusicProgress() {
    const audio = document.getElementById('bg-music');
    if (!audio) return;

    const curEl = document.getElementById('music-time-cur');
    const durEl = document.getElementById('music-time-dur');
    const seekEl = document.getElementById('music-seek');

    const cur = audio.currentTime || 0;
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

    if (curEl) curEl.innerText = formatMusicTime(cur);
    if (durEl) durEl.innerText = formatMusicTime(dur);

    if (seekEl && !window.musicSeeking) {
        seekEl.value = dur > 0 ? Math.round((cur / dur) * 1000) : 0;
    }
}

// Seeks the current track when the user drags the playback slider
window.seekMusic = function() {
    const audio = document.getElementById('bg-music');
    const seekEl = document.getElementById('music-seek');
    const curEl = document.getElementById('music-time-cur');
    if (!audio || !seekEl) return;

    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (dur > 0) {
        const targetTime = (parseFloat(seekEl.value) / 1000) * dur;
        audio.currentTime = targetTime;
        if (curEl) curEl.innerText = formatMusicTime(targetTime);
    }
};

// Syncs both the left-panel music player volume slider and the Settings volume slider
function syncVolumeSliders() {
    const audio = document.getElementById('bg-music');
    if (!audio) return;
    const pct = Math.round(audio.volume * 100);

    const playerSlider = document.getElementById('music-volume');
    const playerPct = document.getElementById('music-vol-pct');
    if (playerSlider) playerSlider.value = pct;
    if (playerPct) playerPct.innerText = pct + '%';

    const settingsSlider = document.getElementById('volume-slider');
    const settingsDisplay = document.getElementById('volume-display');
    if (settingsSlider) settingsSlider.value = pct;
    if (settingsDisplay) settingsDisplay.innerText = pct + '%';
}

// Indices into musicTracks that belong to the chosen genre (an empty list means the genre has no tracks yet)
function genreIndices(genre) {
    const g = genre || activeGenre;
    const out = [];
    (musicTracks || []).forEach((t, i) => { if (g === 'all' || (t.genre || 'pop') === g) out.push(i); });
    return out;
}

// The tracks the player cycles through: the chosen genre, or everything while that genre is empty
function playableIndices() {
    const list = genreIndices();
    return list.length > 0 ? list : (musicTracks || []).map((t, i) => i);
}

// Picks a random track index from the current genre, different from excludeIdx (when more than 1 track exists)
function getRandomTrackIndex(excludeIdx) {
    const list = playableIndices();
    if (list.length === 0) return 0;
    if (list.length === 1) return list[0];
    let nextIdx = excludeIdx;
    while (nextIdx === excludeIdx) {
        nextIdx = list[Math.floor(Math.random() * list.length)];
    }
    return nextIdx;
}

// Fills the genre dropdown (or just refreshes its labels after a language change)
function buildGenreSelect() {
    const sel = document.getElementById('music-genre-select');
    if (!sel) return;
    if (sel.options.length !== MUSIC_GENRES.length) {
        sel.innerHTML = '';
        MUSIC_GENRES.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            sel.appendChild(opt);
        });
    }
    MUSIC_GENRES.forEach((g, i) => {
        sel.options[i].text = LOC.has('music.genre.' + g) ? LOC('music.genre.' + g) : g;
    });
    sel.value = activeGenre;
    sel.title = LOC.has('music.genre_label') ? LOC('music.genre_label') : '';
}

// Fills the track dropdown with the tracks of the chosen genre (option values are indices into musicTracks)
function buildTrackSelect() {
    const select = document.getElementById('music-select');
    if (!select) return;
    select.innerHTML = '';
    const list = genreIndices();
    if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = String(currentTrackIndex);
        opt.text = LOC.has('music.genre_empty') ? LOC('music.genre_empty') : '(no tracks in this genre yet)';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }
    list.forEach(idx => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.text = musicTracks[idx].title;
        if (idx === currentTrackIndex) opt.selected = true;
        select.appendChild(opt);
    });
}

// Switch to the genre chosen in the dropdown
window.changeMusicGenre = function() {
    const sel = document.getElementById('music-genre-select');
    if (!sel || !MUSIC_GENRES.includes(sel.value)) return;
    activeGenre = sel.value;
    try { localStorage.setItem('habibie_music_genre', activeGenre); } catch (e) { /* ignore */ }
    const audio = document.getElementById('bg-music');
    const wasPlaying = audio && !audio.paused;
    const list = genreIndices();
    buildTrackSelect();
    // Keep the current song if it belongs to the new genre, otherwise move on to one that does
    if (list.length > 0 && !list.includes(currentTrackIndex)) {
        trackHistory.push(currentTrackIndex);
        loadTrackByIndex(list[Math.floor(Math.random() * list.length)], Boolean((wasPlaying || gameStarted) && musicEnabled));
    }
};

// Syncs the Play/Pause button label, tooltips, album cover, sliders and taskbar speaker icon
window.syncMusicUI = function() {
    const audio = document.getElementById('bg-music');
    const btn = document.getElementById('play-pause-btn');
    if (btn && audio) {
        btn.innerText = (audio.paused || !musicEnabled) ? LOC('music.play') : LOC('music.pause');
    }
    const prevBtn = document.getElementById('prev-track-btn');
    if (prevBtn && LOC.has('music.prev')) prevBtn.title = LOC('music.prev');
    const nextBtn = document.getElementById('next-track-btn');
    if (nextBtn && LOC.has('music.next')) nextBtn.title = LOC('music.next');

    buildGenreSelect();
    updateMusicCover();
    syncVolumeSliders();
    updateMusicProgress();
    if (typeof updateWin95Taskbar === 'function') updateWin95Taskbar();
};

// Updates the square album cover image at the top of the music player
function updateMusicCover() {
    const imgEl = document.getElementById('music-cover-img');
    const placeholderEl = document.getElementById('music-cover-placeholder');
    if (!imgEl || !placeholderEl) return;

    const track = (typeof musicTracks !== 'undefined' && musicTracks[currentTrackIndex]) ? musicTracks[currentTrackIndex] : null;
    const coverSrc = (track && track.cover && String(track.cover).trim() !== '') ? String(track.cover).trim() : '';

    if (coverSrc) {
        imgEl.onerror = function() {
            imgEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
        };
        imgEl.onload = function() {
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        };
        if (imgEl.getAttribute('src') !== coverSrc) {
            imgEl.setAttribute('src', coverSrc);
        } else if (imgEl.complete && imgEl.naturalWidth > 0) {
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        }
        imgEl.alt = track.title || 'Album Cover';
    } else {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
        placeholderEl.style.display = 'flex';
    }
}

// Keep the music buttons, seek bar and volume sliders in sync with the audio element's events
function wireMusicStateEvents() {
    const audio = document.getElementById('bg-music');
    if (!audio || audio.dataset.wired) return;
    audio.dataset.wired = '1';
    ['play', 'pause', 'emptied'].forEach(evt => audio.addEventListener(evt, window.syncMusicUI));
    ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied'].forEach(evt => audio.addEventListener(evt, updateMusicProgress));
    audio.addEventListener('volumechange', syncVolumeSliders);
    window.syncMusicUI();
}

// Load a track by index and optionally start playback
function loadTrackByIndex(index, shouldPlay = false) {
    if (!musicTracks || musicTracks.length === 0) return;
    const select = document.getElementById('music-select');
    const audio = document.getElementById('bg-music');
    if (!audio) return;

    currentTrackIndex = ((index % musicTracks.length) + musicTracks.length) % musicTracks.length;
    const track = musicTracks[currentTrackIndex];

    if (select && select.value !== String(currentTrackIndex)) {
        const has = Array.from(select.options).some(o => o.value === String(currentTrackIndex) && !o.disabled);
        if (has) select.value = String(currentTrackIndex);
    }

    audio.src = track.file;
    updateMusicCover();
    updateMusicProgress();

    if (shouldPlay && musicEnabled) {
        audio.play().catch(() => {});
    } else {
        window.syncMusicUI();
    }
}

// Set up the music player dropdown, initial random track, cover art and track-end listener
function setupMusicPlayer() {
    if (!musicTracks || musicTracks.length === 0) return;
    const select = document.getElementById('music-select');
    const audio = document.getElementById('bg-music');
    if (!select || !audio) return;

    wireMusicStateEvents();

    if (!musicAutoStarted && trackHistory.length === 0) {
        const pool = playableIndices();
        currentTrackIndex = pool[Math.floor(Math.random() * pool.length)];
    }

    buildGenreSelect();
    buildTrackSelect();

    if (!window.volumeUserSet) audio.volume = 0.3;
    syncVolumeSliders();
    loadTrackByIndex(currentTrackIndex, false);

    audio.onended = function() {
        if (playableIndices().length > 1) {
            trackHistory.push(currentTrackIndex);
            loadTrackByIndex(getRandomTrackIndex(currentTrackIndex), true);
        } else if (playableIndices().length === 1) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    };

    if (!musicEnabled) {
        audio.pause();
    }
    window.syncMusicUI();
}

// Start the background music the first time a campaign begins or is resumed
function startBackgroundMusic() {
    if (musicAutoStarted) return;
    const audio = document.getElementById('bg-music');
    if (!audio || !musicEnabled || !musicTracks || musicTracks.length === 0) return;
    musicAutoStarted = true;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            window.syncMusicUI();
            const unlockAudio = () => {
                if (audio.paused && musicEnabled) {
                    audio.play().catch(() => {});
                }
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('keydown', unlockAudio);
                document.removeEventListener('touchstart', unlockAudio);
            };
            document.addEventListener('click', unlockAudio);
            document.addEventListener('keydown', unlockAudio);
            document.addEventListener('touchstart', unlockAudio);
        });
    }
}

// Switch to the track chosen in the dropdown
window.changeMusic = function() {
    const select = document.getElementById('music-select');
    if (!select || !musicTracks || musicTracks.length === 0) return;
    const idx = parseInt(select.value, 10);
    if (isNaN(idx) || !musicTracks[idx]) return;
    if (idx !== currentTrackIndex) trackHistory.push(currentTrackIndex);
    loadTrackByIndex(idx, Boolean(gameStarted && musicEnabled));
};

// Play or pause the current track
window.toggleMusic = function() {
    const audio = document.getElementById('bg-music');
    if (!audio || !musicEnabled || !musicTracks || musicTracks.length === 0) return;

    if (audio.paused) {
        audio.play().catch(() => {});
    } else {
        audio.pause();
    }
};

// Skip to a random next track
window.nextMusic = function() {
    if (!musicTracks || musicTracks.length === 0) return;
    const audio = document.getElementById('bg-music');
    const wasPlaying = audio && !audio.paused;
    trackHistory.push(currentTrackIndex);
    loadTrackByIndex(getRandomTrackIndex(currentTrackIndex), Boolean((wasPlaying || gameStarted) && musicEnabled));
};

// Go to the previous track in history (or a random track if no history, or restart if >3s in)
window.prevMusic = function() {
    if (!musicTracks || musicTracks.length === 0) return;
    const audio = document.getElementById('bg-music');
    const wasPlaying = audio && !audio.paused;
    if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        if (wasPlaying && musicEnabled) audio.play().catch(() => {});
        return;
    }
    const prevIdx = trackHistory.length > 0 ? trackHistory.pop() : getRandomTrackIndex(currentTrackIndex);
    loadTrackByIndex(prevIdx, Boolean((wasPlaying || gameStarted) && musicEnabled));
};

// Enable or disable the music player from Settings
window.toggleMusicEnabled = function() {
    const cb = document.getElementById('settings-music-toggle');
    if (cb) {
        musicEnabled = cb.checked;
        const player = document.querySelector('.music-player');
        const audio = document.getElementById('bg-music');

        if (musicEnabled) {
            if (player) player.style.display = 'block';
        } else {
            if (player) player.style.display = 'none';
            if (audio && !audio.paused) audio.pause();
        }
        window.syncMusicUI();
        saveUserSettings();
        showSettingsMenu(true);
    }
};

// Apply the volume slider from the left-panel music player (#music-volume)
window.setPlayerVolume = function() {
    const slider = document.getElementById('music-volume');
    const audio = document.getElementById('bg-music');
    if (slider && audio) {
        audio.volume = slider.value / 100;
        window.volumeUserSet = true;
        syncVolumeSliders();
        if (typeof saveUserSettings === 'function') saveUserSettings();
    }
};

// Apply the volume slider from Settings (#volume-slider)
window.updateVolume = function() {
    const slider = document.getElementById('volume-slider');
    const audio = document.getElementById('bg-music');
    if (slider && audio) {
        audio.volume = slider.value / 100;
        window.volumeUserSet = true;
        syncVolumeSliders();
        if (typeof saveUserSettings === 'function') saveUserSettings();
    }
};