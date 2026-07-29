// ============ UTILITY FUNCTIONS ============

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function extractVideoId(url) {
    if (!url) return null;
    url = url.trim();
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
    };

    toast.innerHTML = `<span style="font-weight:700;font-size:15px;">${icons[type] || icons.info}</span> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============ MAIN APP ============

class MelodyFlow {
    constructor() {
        this.playlists = [];
        this.currentPlaylistId = null;
        this.currentSongIndex = -1;
        this.playingPlaylistId = null;
        this.isPlaying = false;
        this.isShuffle = false;
        this.repeatMode = 'none'; // 'none', 'all', 'one'
        this.volume = 80;
        this.player = null;
        this.playerReady = false;
        this.progressAnimFrame = null;
        this.isSeeking = false;
        this.shuffleHistory = [];

        this.is8D = false;
        this.audioCtx = null;
        this.pannerNode = null;
        this.audioSourceNode = null;
        this.pannerAnimFrame = null;
        this.audio8D = null;

        this.loadData();
        this.cacheDOM();
        this.bindEvents();
        this.initYouTubeAPI();
        this.render();
    }

    // ---- Data Persistence ----

    loadData() {
        try {
            const data = JSON.parse(localStorage.getItem('melodyflow_data'));
            if (data) {
                this.playlists = data.playlists || [];
                this.volume = data.volume ?? 80;
                this.isShuffle = data.isShuffle || false;
                this.repeatMode = data.repeatMode || 'none';
                this.is8D = data.is8D || false;
            }
        } catch (e) {
            console.error('Failed to load data:', e);
        }

        // Try reading playlists.json from folder if localstorage was empty
        fetch('/api/data').then(res => res.json()).then(fileData => {
            if (fileData && fileData.playlists && (!this.playlists || this.playlists.length === 0)) {
                this.playlists = fileData.playlists || [];
                this.render();
            }
        }).catch(() => {});
    }

    saveData() {
        const payload = {
            playlists: this.playlists,
            volume: this.volume,
            isShuffle: this.isShuffle,
            repeatMode: this.repeatMode,
            is8D: this.is8D
        };
        try {
            localStorage.setItem('melodyflow_data', JSON.stringify(payload));
        } catch (e) {
            console.error('Failed to save data:', e);
        }

        // Sync directly to playlists.json file in project folder
        fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload, null, 2)
        }).catch(() => {});
    }

    // ---- DOM Cache ----

    cacheDOM() {
        this.dom = {
            playlistList: document.getElementById('playlistList'),
            welcomeState: document.getElementById('welcomeState'),
            playlistView: document.getElementById('playlistView'),
            playlistTitle: document.getElementById('playlistTitle'),
            songCount: document.getElementById('songCount'),
            songList: document.getElementById('songList'),
            emptyPlaylistState: document.getElementById('emptyPlaylistState'),
            songUrlInput: document.getElementById('songUrlInput'),
            addSongBtn: document.getElementById('addSongBtn'),
            newPlaylistBtn: document.getElementById('newPlaylistBtn'),
            welcomeCreateBtn: document.getElementById('welcomeCreateBtn'),
            renamePlaylistBtn: document.getElementById('renamePlaylistBtn'),
            deletePlaylistBtn: document.getElementById('deletePlaylistBtn'),
            // Player
            playerBar: document.getElementById('playerBar'),
            playerThumbnail: document.getElementById('playerThumbnail'),
            playerSongTitle: document.getElementById('playerSongTitle'),
            playerPlaylistName: document.getElementById('playerPlaylistName'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            playIcon: document.getElementById('playIcon'),
            pauseIcon: document.getElementById('pauseIcon'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            shuffleBtn: document.getElementById('shuffleBtn'),
            repeatBtn: document.getElementById('repeatBtn'),
            repeatBadge: document.getElementById('repeatBadge'),
            btn8D: document.getElementById('btn8D'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            progressBarWrapper: document.getElementById('progressBarWrapper'),
            progressBarFill: document.getElementById('progressBarFill'),
            progressBarHandle: document.getElementById('progressBarHandle'),
            volumeBtn: document.getElementById('volumeBtn'),
            volumeIcon: document.getElementById('volumeIcon'),
            volumeMuteIcon: document.getElementById('volumeMuteIcon'),
            volumeBarWrapper: document.getElementById('volumeBarWrapper'),
            volumeBarFill: document.getElementById('volumeBarFill'),
            volumeBarHandle: document.getElementById('volumeBarHandle'),
            // Modals
            modalOverlay: document.getElementById('modalOverlay'),
            modalTitle: document.getElementById('modalTitle'),
            modalInput: document.getElementById('modalInput'),
            modalCancel: document.getElementById('modalCancel'),
            modalConfirm: document.getElementById('modalConfirm'),
            confirmOverlay: document.getElementById('confirmOverlay'),
            confirmTitle: document.getElementById('confirmTitle'),
            confirmMessage: document.getElementById('confirmMessage'),
            confirmCancel: document.getElementById('confirmCancel'),
            confirmOk: document.getElementById('confirmOk'),
        };
    }

    // ---- Event Binding ----

    bindEvents() {
        // Playlist actions
        this.dom.newPlaylistBtn.addEventListener('click', () => this.promptCreatePlaylist());
        this.dom.welcomeCreateBtn.addEventListener('click', () => this.promptCreatePlaylist());
        this.dom.renamePlaylistBtn.addEventListener('click', () => this.promptRenamePlaylist());
        this.dom.deletePlaylistBtn.addEventListener('click', () => this.promptDeletePlaylist());

        // Song actions
        this.dom.addSongBtn.addEventListener('click', () => this.handleAddSong());
        this.dom.songUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleAddSong();
        });

        // Player controls
        this.dom.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.dom.prevBtn.addEventListener('click', () => this.prevSong());
        this.dom.nextBtn.addEventListener('click', () => this.nextSong());
        this.dom.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        this.dom.repeatBtn.addEventListener('click', () => this.toggleRepeat());
        if (this.dom.btn8D) this.dom.btn8D.addEventListener('click', () => this.toggle8DMode());
        this.dom.volumeBtn.addEventListener('click', () => this.toggleMute());

        // Progress bar interaction
        this.setupSlider(this.dom.progressBarWrapper, this.dom.progressBarFill, this.dom.progressBarHandle, (pct) => {
            this.isSeeking = true;
            this.dom.progressBarFill.style.width = pct + '%';
            this.dom.progressBarHandle.style.left = pct + '%';
            const duration = this.getDuration();
            if (duration > 0) {
                this.dom.currentTime.textContent = formatTime(duration * pct / 100);
            }
        }, (pct) => {
            this.isSeeking = false;
            const duration = this.getDuration();
            if (duration > 0) {
                const targetTime = duration * pct / 100;
                if (this.is8D && this.audio8D) {
                    this.audio8D.currentTime = targetTime;
                } else if (this.player && this.playerReady) {
                    this.player.seekTo(targetTime, true);
                }
            }
        });

        // Volume slider interaction
        this.setupSlider(this.dom.volumeBarWrapper, this.dom.volumeBarFill, this.dom.volumeBarHandle, (pct) => {
            this.setVolume(pct);
        }, (pct) => {
            this.setVolume(pct);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (this.player && this.playerReady) {
                        this.player.seekTo(this.player.getCurrentTime() + 5, true);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (this.player && this.playerReady) {
                        this.player.seekTo(Math.max(0, this.player.getCurrentTime() - 5), true);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.setVolume(Math.min(100, this.volume + 5));
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.setVolume(Math.max(0, this.volume - 5));
                    break;
                case 'n':
                case 'N':
                    this.nextSong();
                    break;
                case 'p':
                case 'P':
                    this.prevSong();
                    break;
                case 'm':
                case 'M':
                    this.toggleMute();
                    break;
            }
        });
    }

    setupSlider(wrapper, fill, handle, onDrag, onRelease) {
        let isDragging = false;

        const getPercent = (e) => {
            const rect = wrapper.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        };

        const start = (e) => {
            isDragging = true;
            const pct = getPercent(e);
            onDrag(pct);
            e.preventDefault();
        };

        const move = (e) => {
            if (!isDragging) return;
            const pct = getPercent(e);
            onDrag(pct);
        };

        const end = (e) => {
            if (!isDragging) return;
            isDragging = false;
            const rect = wrapper.getBoundingClientRect();
            const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            onRelease(pct);
        };

        wrapper.addEventListener('mousedown', start);
        wrapper.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', end);
        document.addEventListener('touchend', end);
    }

    // ---- YouTube API ----

    initYouTubeAPI() {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => {
            this.player = new YT.Player('ytPlayer', {
                height: '180',
                width: '320',
                playerVars: {
                    autoplay: 0,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    rel: 0,
                    modestbranding: 1
                },
                events: {
                    onReady: () => {
                        this.playerReady = true;
                        this.player.setVolume(this.volume);
                    },
                    onStateChange: (event) => this.onPlayerStateChange(event),
                    onError: (event) => this.onPlayerError(event)
                }
            });
        };
    }

    onPlayerStateChange(event) {
        switch (event.data) {
            case YT.PlayerState.PLAYING:
                this.isPlaying = true;
                this.updatePlayPauseUI();
                this.startProgressUpdate();
                // Try to update the song title from the player
                this.tryUpdateSongTitle();
                break;
            case YT.PlayerState.PAUSED:
                this.isPlaying = false;
                this.updatePlayPauseUI();
                this.stopProgressUpdate();
                break;
            case YT.PlayerState.ENDED:
                this.isPlaying = false;
                this.updatePlayPauseUI();
                this.stopProgressUpdate();
                this.onSongEnded();
                break;
            case YT.PlayerState.BUFFERING:
                break;
        }
    }

    onPlayerError(event) {
        const errors = {
            2: 'Invalid video ID',
            5: 'HTML5 player error',
            100: 'Video not found or private',
            101: 'Video cannot be embedded',
            150: 'Video cannot be embedded'
        };
        showToast(errors[event.data] || 'Playback error', 'error');
        // Auto-skip to next
        setTimeout(() => this.nextSong(), 1500);
    }

    tryUpdateSongTitle() {
        if (!this.player || !this.playerReady) return;
        try {
            const videoData = this.player.getVideoData();
            if (videoData && videoData.title) {
                const playlist = this.getPlayingPlaylist();
                if (playlist && this.currentSongIndex >= 0 && this.currentSongIndex < playlist.songs.length) {
                    const song = playlist.songs[this.currentSongIndex];
                    if (song.title.startsWith('Loading...') || song.title.startsWith('Video ')) {
                        song.title = videoData.title;
                        this.saveData();
                        this.renderSongs();
                        this.dom.playerSongTitle.textContent = videoData.title;
                    }
                }
            }
        } catch (e) { /* ignore */ }
    }

    // ---- Playlist Management ----

    getPlaylist(id) {
        return this.playlists.find(p => p.id === id);
    }

    getPlayingPlaylist() {
        return this.playlists.find(p => p.id === this.playingPlaylistId);
    }

    getCurrentPlaylist() {
        return this.playlists.find(p => p.id === this.currentPlaylistId);
    }

    async promptCreatePlaylist() {
        const name = await this.showInputModal('New Playlist', 'Create', 'My Playlist');
        if (name) this.createPlaylist(name);
    }

    createPlaylist(name) {
        const playlist = {
            id: generateId(),
            name: name.trim() || 'Untitled',
            songs: [],
            createdAt: Date.now()
        };
        this.playlists.push(playlist);
        this.saveData();
        this.selectPlaylist(playlist.id);
        this.renderPlaylists();
        showToast(`Playlist "${playlist.name}" created`, 'success');
    }

    async promptRenamePlaylist() {
        const playlist = this.getCurrentPlaylist();
        if (!playlist) return;
        const name = await this.showInputModal('Rename Playlist', 'Rename', playlist.name);
        if (name) {
            playlist.name = name.trim();
            this.saveData();
            this.renderPlaylists();
            this.dom.playlistTitle.textContent = playlist.name;
            if (this.playingPlaylistId === playlist.id) {
                this.dom.playerPlaylistName.textContent = playlist.name;
            }
            showToast('Playlist renamed', 'success');
        }
    }

    async promptDeletePlaylist() {
        const playlist = this.getCurrentPlaylist();
        if (!playlist) return;
        const confirmed = await this.showConfirmModal(
            'Delete Playlist',
            `Are you sure you want to delete "${playlist.name}"? This action cannot be undone.`
        );
        if (confirmed) {
            this.playlists = this.playlists.filter(p => p.id !== playlist.id);
            if (this.playingPlaylistId === playlist.id) {
                this.stopPlayback();
            }
            this.currentPlaylistId = null;
            this.saveData();
            this.render();
            showToast('Playlist deleted', 'success');
        }
    }

    selectPlaylist(id) {
        this.currentPlaylistId = id;
        this.render();
    }

    // ---- Song Management ----

    async handleAddSong() {
        const url = this.dom.songUrlInput.value.trim();
        if (!url) {
            showToast('Please paste a YouTube link', 'error');
            return;
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            showToast('Invalid YouTube URL', 'error');
            return;
        }

        const playlist = this.getCurrentPlaylist();
        if (!playlist) {
            showToast('Select a playlist first', 'error');
            return;
        }

        // Show loading state
        this.dom.addSongBtn.classList.add('loading');
        this.dom.addSongBtn.innerHTML = '<div class="spinner"></div> Adding...';

        // Fetch video info
        const info = await this.fetchVideoInfo(videoId);

        const song = {
            videoId: videoId,
            title: info.title,
            thumbnail: info.thumbnail,
            addedAt: Date.now()
        };

        playlist.songs.push(song);
        this.saveData();
        this.dom.songUrlInput.value = '';
        this.renderSongs();
        showToast(`"${song.title}" added`, 'success');

        // Reset button
        this.dom.addSongBtn.classList.remove('loading');
        this.dom.addSongBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add`;
    }

    async fetchVideoInfo(videoId) {
        const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        try {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
            const data = await res.json();
            return {
                title: data.title || `Video ${videoId}`,
                thumbnail
            };
        } catch (e) {
            return {
                title: `Loading... (${videoId})`,
                thumbnail
            };
        }
    }

    removeSong(index) {
        const playlist = this.getCurrentPlaylist();
        if (!playlist) return;

        const removedTitle = playlist.songs[index]?.title || 'Song';
        playlist.songs.splice(index, 1);

        // Adjust playing index if needed
        if (this.playingPlaylistId === playlist.id) {
            if (index === this.currentSongIndex) {
                this.stopPlayback();
            } else if (index < this.currentSongIndex) {
                this.currentSongIndex--;
            }
        }

        this.saveData();
        this.renderSongs();
        showToast(`"${removedTitle}" removed`, 'info');
    }

    // ---- 8D Audio Engine (Web Audio API) ----

    init8DAudioEngine() {
        if (this.audioCtx) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            this.audioCtx = new AudioContextClass();
            this.audio8D = document.getElementById('audio8D');
            if (!this.audio8D) return;

            this.audioSourceNode = this.audioCtx.createMediaElementSource(this.audio8D);

            if (this.audioCtx.createStereoPanner) {
                this.pannerNode = this.audioCtx.createStereoPanner();
            } else {
                this.pannerNode = this.audioCtx.createPanner();
                this.pannerNode.panningModel = 'HRTF';
            }

            // Lowpass filter for spatial depth
            this.filterNode = this.audioCtx.createBiquadFilter();
            this.filterNode.type = 'lowpass';
            this.filterNode.frequency.value = 16000;

            this.audioSourceNode.connect(this.filterNode);
            this.filterNode.connect(this.pannerNode);
            this.pannerNode.connect(this.audioCtx.destination);

            this.audio8D.addEventListener('ended', () => this.onSongEnded());
            this.audio8D.addEventListener('play', () => {
                this.isPlaying = true;
                this.updatePlayPauseUI();
                this.startProgressUpdate();
            });
            this.audio8D.addEventListener('pause', () => {
                if (this.is8D) {
                    this.isPlaying = false;
                    this.updatePlayPauseUI();
                }
            });
            this.audio8D.addEventListener('error', () => {
                if (this.is8D) {
                    this.is8D = false;
                    if (this.dom.btn8D) this.dom.btn8D.classList.remove('active');
                    this.saveData();
                    this.stop8DPanning();
                    showToast('Playing in Standard Mode (YouTube stream restricted)', 'info');
                    const playlist = this.getPlayingPlaylist();
                    const song = (playlist && this.currentSongIndex >= 0) ? playlist.songs[this.currentSongIndex] : null;
                    if (song && this.player && this.playerReady) {
                        this.player.loadVideoById(song.videoId, this.audio8D.currentTime || 0);
                        this.isPlaying = true;
                        this.updatePlayPauseUI();
                    }
                }
            });
        } catch (e) {
            console.error('Failed to init 8D Audio Engine:', e);
        }
    }

    start8DPanning() {
        this.stop8DPanning();
        let angle = 0;
        const animate = () => {
            if (this.is8D && this.pannerNode && this.isPlaying) {
                angle += 0.015; // Smooth rotation speed
                const pan = Math.sin(angle);
                if (this.pannerNode.pan) {
                    this.pannerNode.pan.value = pan;
                } else if (this.pannerNode.setPosition) {
                    this.pannerNode.setPosition(pan, 0, 1 - Math.abs(pan));
                }
            }
            this.pannerAnimFrame = requestAnimationFrame(animate);
        };
        this.pannerAnimFrame = requestAnimationFrame(animate);
    }

    stop8DPanning() {
        if (this.pannerAnimFrame) {
            cancelAnimationFrame(this.pannerAnimFrame);
            this.pannerAnimFrame = null;
        }
        if (this.pannerNode && this.pannerNode.pan) {
            this.pannerNode.pan.value = 0;
        }
    }

    toggle8DMode(forceState = null) {
        this.is8D = forceState !== null ? forceState : !this.is8D;
        if (this.dom.btn8D) this.dom.btn8D.classList.toggle('active', this.is8D);
        this.saveData();

        const playlist = this.getPlayingPlaylist();
        const song = (playlist && this.currentSongIndex >= 0) ? playlist.songs[this.currentSongIndex] : null;
        const currentTime = this.getCurrentTime();

        if (this.is8D) {
            this.init8DAudioEngine();
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            showToast('8D Audio Mode Enabled 🎧 (Best with headphones)', 'info');
            if (this.isPlaying && song) {
                if (this.player && this.playerReady) this.player.pauseVideo();
                this.play8DSong(song, currentTime);
            }
        } else {
            showToast('8D Audio Mode Disabled', 'info');
            if (this.audio8D) this.audio8D.pause();
            this.stop8DPanning();
            if (this.isPlaying && song) {
                if (this.player && this.playerReady) {
                    this.player.loadVideoById(song.videoId, currentTime);
                }
            }
        }
    }

    play8DSong(song, startSeconds = 0) {
        this.init8DAudioEngine();
        if (!this.audio8D) return;
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        this.audio8D.src = `/stream?v=${song.videoId}`;
        this.audio8D.volume = this.volume / 100;
        if (startSeconds > 0) {
            this.audio8D.currentTime = startSeconds;
        }
        this.audio8D.play().catch(e => {
            console.error('8D audio play error:', e);
            this.is8D = false;
            if (this.dom.btn8D) this.dom.btn8D.classList.remove('active');
            this.saveData();
            this.stop8DPanning();
            showToast('Playing in Standard Mode (YouTube stream restricted)', 'info');
            if (this.player && this.playerReady) {
                this.player.loadVideoById(song.videoId, startSeconds);
            }
        });
        this.start8DPanning();
    }

    getCurrentTime() {
        if (this.is8D && this.audio8D) {
            return this.audio8D.currentTime || 0;
        }
        if (this.player && this.playerReady && typeof this.player.getCurrentTime === 'function') {
            return this.player.getCurrentTime() || 0;
        }
        return 0;
    }

    getDuration() {
        if (this.is8D && this.audio8D) {
            return this.audio8D.duration || 0;
        }
        if (this.player && this.playerReady && typeof this.player.getDuration === 'function') {
            return this.player.getDuration() || 0;
        }
        return 0;
    }

    // ---- Playback ----

    playSong(index, playlistId = null) {
        const plId = playlistId || this.currentPlaylistId;
        const playlist = this.getPlaylist(plId);
        if (!playlist || index < 0 || index >= playlist.songs.length) return;

        this.playingPlaylistId = plId;
        this.currentSongIndex = index;
        const song = playlist.songs[index];

        this.updatePlayerInfo(song, playlist);
        this.updatePlayPauseUI();
        this.renderSongs();

        if (this.is8D) {
            if (this.player && this.playerReady) this.player.pauseVideo();
            this.play8DSong(song, 0);
        } else {
            if (this.audio8D) this.audio8D.pause();
            if (this.player && this.playerReady) {
                this.player.loadVideoById(song.videoId);
                this.isPlaying = true;
                this.updatePlayPauseUI();
            } else {
                showToast('Player is loading, please try again...', 'info');
            }
        }
    }

    togglePlay() {
        if (this.currentSongIndex < 0) {
            const playlist = this.getCurrentPlaylist();
            if (playlist && playlist.songs.length > 0) {
                this.playSong(0);
                return;
            }
        }

        if (this.is8D && this.audio8D) {
            if (this.audio8D.paused) {
                this.audio8D.play();
            } else {
                this.audio8D.pause();
            }
            return;
        }

        if (!this.player || !this.playerReady) return;

        if (this.isPlaying) {
            this.player.pauseVideo();
        } else {
            this.player.playVideo();
        }
    }

    nextSong() {
        const playlist = this.getPlayingPlaylist();
        if (!playlist || playlist.songs.length === 0) return;

        let nextIndex;
        if (this.isShuffle) {
            nextIndex = this.getShuffleIndex(playlist);
        } else {
            nextIndex = this.currentSongIndex + 1;
            if (nextIndex >= playlist.songs.length) {
                if (this.repeatMode === 'all') {
                    nextIndex = 0;
                } else {
                    this.stopPlayback();
                    return;
                }
            }
        }

        this.playSong(nextIndex, this.playingPlaylistId);
    }

    prevSong() {
        const playlist = this.getPlayingPlaylist();
        if (!playlist || playlist.songs.length === 0) return;

        // If past 3 seconds, restart the song
        if (this.getCurrentTime() > 3) {
            if (this.is8D && this.audio8D) {
                this.audio8D.currentTime = 0;
            } else if (this.player && this.playerReady) {
                this.player.seekTo(0, true);
            }
            return;
        }

        let prevIndex = this.currentSongIndex - 1;
        if (prevIndex < 0) {
            if (this.repeatMode === 'all') {
                prevIndex = playlist.songs.length - 1;
            } else {
                prevIndex = 0;
            }
        }

        this.playSong(prevIndex, this.playingPlaylistId);
    }

    onSongEnded() {
        if (this.repeatMode === 'one') {
            if (this.is8D && this.audio8D) {
                this.audio8D.currentTime = 0;
                this.audio8D.play();
            } else if (this.player && this.playerReady) {
                this.player.seekTo(0, true);
                this.player.playVideo();
            }
        } else {
            this.nextSong();
        }
    }

    stopPlayback() {
        if (this.player && this.playerReady) {
            this.player.stopVideo();
        }
        if (this.audio8D) {
            this.audio8D.pause();
        }
        this.stop8DPanning();
        this.isPlaying = false;
        this.currentSongIndex = -1;
        this.playingPlaylistId = null;
        this.updatePlayPauseUI();
        this.stopProgressUpdate();
        this.dom.playerSongTitle.textContent = 'No song playing';
        this.dom.playerPlaylistName.textContent = '';
        this.dom.playerThumbnail.classList.remove('visible');
        this.dom.progressBarFill.style.width = '0%';
        this.dom.progressBarHandle.style.left = '0%';
        this.dom.currentTime.textContent = '0:00';
        this.dom.totalTime.textContent = '0:00';
        this.renderSongs();
    }

    getShuffleIndex(playlist) {
        if (playlist.songs.length <= 1) return 0;
        let next;
        do {
            next = Math.floor(Math.random() * playlist.songs.length);
        } while (next === this.currentSongIndex);
        return next;
    }

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        this.dom.shuffleBtn.classList.toggle('active', this.isShuffle);
        this.saveData();
        showToast(this.isShuffle ? 'Shuffle on' : 'Shuffle off', 'info');
    }

    toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentIdx = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIdx + 1) % modes.length];
        this.dom.repeatBtn.classList.toggle('active', this.repeatMode !== 'none');
        this.dom.repeatBadge.style.display = this.repeatMode === 'one' ? 'flex' : 'none';
        this.saveData();

        const labels = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
        showToast(labels[this.repeatMode], 'info');
    }

    setVolume(vol) {
        this.volume = Math.round(vol);
        if (this.player && this.playerReady) {
            this.player.setVolume(this.volume);
        }
        if (this.audio8D) {
            this.audio8D.volume = this.volume / 100;
        }
        this.dom.volumeBarFill.style.width = this.volume + '%';
        this.dom.volumeBarHandle.style.left = this.volume + '%';
        this.updateVolumeIcon();
        this.saveData();
    }

    toggleMute() {
        if (this.volume > 0) {
            this._prevVolume = this.volume;
            this.setVolume(0);
        } else {
            this.setVolume(this._prevVolume || 80);
        }
    }

    updateVolumeIcon() {
        const isMuted = this.volume === 0;
        this.dom.volumeIcon.style.display = isMuted ? 'none' : 'block';
        this.dom.volumeMuteIcon.style.display = isMuted ? 'block' : 'none';

        // Update volume wave visibility
        const wave1 = document.getElementById('volumeWave1');
        const wave2 = document.getElementById('volumeWave2');
        if (wave1) wave1.style.opacity = this.volume > 50 ? '1' : '0.2';
        if (wave2) wave2.style.opacity = this.volume > 20 ? '1' : '0.2';
    }

    // ---- Progress ----

    startProgressUpdate() {
        this.stopProgressUpdate();
        const update = () => {
            if (!this.isSeeking && this.isPlaying) {
                const current = this.getCurrentTime();
                const duration = this.getDuration();
                if (duration > 0) {
                    const pct = (current / duration) * 100;
                    this.dom.progressBarFill.style.width = pct + '%';
                    this.dom.progressBarHandle.style.left = pct + '%';
                    this.dom.currentTime.textContent = formatTime(current);
                    this.dom.totalTime.textContent = formatTime(duration);
                }
            }
            this.progressAnimFrame = requestAnimationFrame(update);
        };
        this.progressAnimFrame = requestAnimationFrame(update);
    }

    stopProgressUpdate() {
        if (this.progressAnimFrame) {
            cancelAnimationFrame(this.progressAnimFrame);
            this.progressAnimFrame = null;
        }
    }

    // ---- UI Updates ----

    updatePlayerInfo(song, playlist) {
        this.dom.playerSongTitle.textContent = song.title;
        this.dom.playerPlaylistName.textContent = playlist.name;
        this.dom.playerThumbnail.src = song.thumbnail;
        this.dom.playerThumbnail.classList.add('visible');

        // Update document title
        document.title = `${song.title} - MelodyFlow`;
    }

    updatePlayPauseUI() {
        this.dom.playIcon.style.display = this.isPlaying ? 'none' : 'block';
        this.dom.pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
        this.dom.playPauseBtn.title = this.isPlaying ? 'Pause' : 'Play';

        // Update song list playing state
        this.renderSongs();
    }

    // ---- Rendering ----

    render() {
        this.renderPlaylists();
        this.renderMainView();
        this.renderShuffleRepeatUI();
        this.updateVolumeIcon();
    }

    renderPlaylists() {
        const container = this.dom.playlistList;
        container.innerHTML = '';

        this.playlists.forEach(playlist => {
            const item = document.createElement('div');
            item.className = `playlist-item ${playlist.id === this.currentPlaylistId ? 'active' : ''}`;
            item.innerHTML = `
                <div class="playlist-item-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>
                <div class="playlist-item-info">
                    <div class="playlist-item-name">${this.escapeHTML(playlist.name)}</div>
                    <div class="playlist-item-count">${playlist.songs.length} song${playlist.songs.length !== 1 ? 's' : ''}</div>
                </div>`;
            item.addEventListener('click', () => this.selectPlaylist(playlist.id));
            container.appendChild(item);
        });
    }

    renderMainView() {
        if (this.currentPlaylistId) {
            this.dom.welcomeState.style.display = 'none';
            this.dom.playlistView.style.display = 'flex';
            const playlist = this.getCurrentPlaylist();
            if (playlist) {
                this.dom.playlistTitle.textContent = playlist.name;
                this.dom.songCount.textContent = `${playlist.songs.length} song${playlist.songs.length !== 1 ? 's' : ''}`;
            }
            this.renderSongs();
        } else {
            this.dom.welcomeState.style.display = 'flex';
            this.dom.playlistView.style.display = 'none';
        }
    }

    renderSongs() {
        const playlist = this.getCurrentPlaylist();
        if (!playlist) return;

        const container = this.dom.songList;
        const isEmpty = playlist.songs.length === 0;

        this.dom.emptyPlaylistState.style.display = isEmpty ? 'flex' : 'none';
        this.dom.songList.style.display = isEmpty ? 'none' : 'block';
        this.dom.songCount.textContent = `${playlist.songs.length} song${playlist.songs.length !== 1 ? 's' : ''}`;

        container.innerHTML = '';

        playlist.songs.forEach((song, index) => {
            const isPlayingThis = this.playingPlaylistId === playlist.id && this.currentSongIndex === index;
            const item = document.createElement('div');
            item.className = `song-item ${isPlayingThis ? 'playing' : ''} ${isPlayingThis && !this.isPlaying ? 'paused' : ''}`;
            item.innerHTML = `
                <div class="song-index">
                    <span class="song-index-number">${index + 1}</span>
                    <span class="song-index-play">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </span>
                    <div class="equalizer">
                        <div class="equalizer-bar"></div>
                        <div class="equalizer-bar"></div>
                        <div class="equalizer-bar"></div>
                    </div>
                </div>
                <img class="song-thumbnail" src="${song.thumbnail}" alt="" loading="lazy" onerror="this.style.opacity='0.3'">
                <div class="song-info">
                    <span class="song-title">${this.escapeHTML(song.title)}</span>
                </div>
                <div class="song-actions">
                    <button class="song-action-btn open-yt" title="Open on YouTube" data-action="open" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </button>
                    <button class="song-action-btn delete" title="Remove" data-action="delete" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>`;

            // Play on click (main area)
            item.addEventListener('click', (e) => {
                if (e.target.closest('.song-actions')) return;
                this.playSong(index);
            });

            // Action buttons
            item.querySelectorAll('.song-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const idx = parseInt(btn.dataset.index);
                    if (action === 'delete') this.removeSong(idx);
                    if (action === 'open') window.open(`https://www.youtube.com/watch?v=${song.videoId}`, '_blank');
                });
            });

            container.appendChild(item);
        });
    }

    renderShuffleRepeatUI() {
        this.dom.shuffleBtn.classList.toggle('active', this.isShuffle);
        this.dom.repeatBtn.classList.toggle('active', this.repeatMode !== 'none');
        this.dom.repeatBadge.style.display = this.repeatMode === 'one' ? 'flex' : 'none';
        if (this.dom.btn8D) this.dom.btn8D.classList.toggle('active', this.is8D);
    }

    // ---- Modals ----

    showInputModal(title, confirmText, defaultValue = '') {
        return new Promise((resolve) => {
            this.dom.modalTitle.textContent = title;
            this.dom.modalConfirm.textContent = confirmText;
            this.dom.modalInput.value = defaultValue;
            this.dom.modalOverlay.classList.add('visible');

            setTimeout(() => this.dom.modalInput.focus(), 100);

            const cleanup = () => {
                this.dom.modalOverlay.classList.remove('visible');
                this.dom.modalCancel.removeEventListener('click', onCancel);
                this.dom.modalConfirm.removeEventListener('click', onConfirm);
                this.dom.modalInput.removeEventListener('keydown', onKeydown);
            };

            const onCancel = () => { cleanup(); resolve(null); };
            const onConfirm = () => {
                const val = this.dom.modalInput.value.trim();
                cleanup();
                resolve(val || null);
            };
            const onKeydown = (e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); };

            this.dom.modalCancel.addEventListener('click', onCancel);
            this.dom.modalConfirm.addEventListener('click', onConfirm);
            this.dom.modalInput.addEventListener('keydown', onKeydown);
        });
    }

    showConfirmModal(title, message) {
        return new Promise((resolve) => {
            this.dom.confirmTitle.textContent = title;
            this.dom.confirmMessage.textContent = message;
            this.dom.confirmOverlay.classList.add('visible');

            const cleanup = () => {
                this.dom.confirmOverlay.classList.remove('visible');
                this.dom.confirmCancel.removeEventListener('click', onCancel);
                this.dom.confirmOk.removeEventListener('click', onConfirm);
            };

            const onCancel = () => { cleanup(); resolve(false); };
            const onConfirm = () => { cleanup(); resolve(true); };

            this.dom.confirmCancel.addEventListener('click', onCancel);
            this.dom.confirmOk.addEventListener('click', onConfirm);
        });
    }

    // ---- Helpers ----

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MelodyFlow();

    // Heartbeat: keep server alive while page is open
    setInterval(() => {
        fetch('/heartbeat').catch(() => {});
    }, 5000);
    // Send initial heartbeat
    fetch('/heartbeat').catch(() => {});
});
