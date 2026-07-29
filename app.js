// ============ UTILITY FUNCTIONS ============

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
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

function getUserId() {
    let id = localStorage.getItem('melodyflow_userId');
    if (!id) {
        id = 'u_' + generateId();
        localStorage.setItem('melodyflow_userId', id);
    }
    return id;
}

function getNickname() {
    return localStorage.getItem('melodyflow_nickname') || '';
}

function setNickname(name) {
    localStorage.setItem('melodyflow_nickname', name);
}

const AVATAR_COLORS = [
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
];

function getAvatarColor(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span style="font-weight:700;font-size:15px;">${icons[type] || icons.info}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============ FIREBASE ROOM MANAGER ============

class RoomManager {
    constructor() {
        this.db = null;
        this.roomRef = null;
        this.roomCode = null;
        this.userId = getUserId();
        this.isHost = false;
        this.listeners = [];
        this.initFirebase();
    }

    initFirebase() {
        try {
            if (typeof firebase === 'undefined' || !firebaseConfig || firebaseConfig.apiKey === 'YOUR_API_KEY') {
                console.warn('Firebase not configured');
                return;
            }
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            this.db = firebase.database();
        } catch (e) {
            console.error('Firebase init failed:', e);
        }
    }

    isReady() {
        return !!this.db;
    }

    async createRoom(roomName, nickname) {
        if (!this.db) throw new Error('Firebase not configured');

        const code = generateRoomCode();
        this.roomCode = code;
        this.isHost = true;
        this.roomRef = this.db.ref('rooms/' + code);

        await this.roomRef.set({
            name: roomName || 'MelodyFlow Room',
            host: this.userId,
            createdAt: Date.now(),
            playlist: [],
            state: {
                currentIndex: -1,
                isPlaying: false,
                seekTime: 0,
                updatedAt: Date.now()
            }
        });

        // Add self to users
        await this.roomRef.child('users/' + this.userId).set({
            name: nickname,
            joinedAt: Date.now()
        });

        // Setup presence (auto-remove on disconnect)
        this.roomRef.child('users/' + this.userId).onDisconnect().remove();

        // If host disconnects, remove entire room
        this.roomRef.onDisconnect().remove();

        return code;
    }

    async joinRoom(code, nickname) {
        if (!this.db) throw new Error('Firebase not configured');

        code = code.toUpperCase().trim();
        this.roomRef = this.db.ref('rooms/' + code);

        // Check if room exists
        const snapshot = await this.roomRef.once('value');
        if (!snapshot.exists()) {
            throw new Error('Room not found');
        }

        this.roomCode = code;
        const roomData = snapshot.val();
        this.isHost = roomData.host === this.userId;

        // Add self to users
        await this.roomRef.child('users/' + this.userId).set({
            name: nickname,
            joinedAt: Date.now()
        });

        // Auto-remove on disconnect
        this.roomRef.child('users/' + this.userId).onDisconnect().remove();

        return roomData;
    }

    // Listen for real-time changes
    onPlaylistChange(callback) {
        if (!this.roomRef) return;
        const ref = this.roomRef.child('playlist');
        ref.on('value', snap => callback(snap.val() || []));
        this.listeners.push({ ref, event: 'value' });
    }

    onStateChange(callback) {
        if (!this.roomRef) return;
        const ref = this.roomRef.child('state');
        ref.on('value', snap => callback(snap.val()));
        this.listeners.push({ ref, event: 'value' });
    }

    onUsersChange(callback) {
        if (!this.roomRef) return;
        const ref = this.roomRef.child('users');
        ref.on('value', snap => callback(snap.val() || {}));
        this.listeners.push({ ref, event: 'value' });
    }

    onRoomDeleted(callback) {
        if (!this.roomRef) return;
        this.roomRef.on('value', snap => {
            if (!snap.exists()) callback();
        });
    }

    // Write operations
    async addSong(song) {
        if (!this.roomRef) return;
        const snap = await this.roomRef.child('playlist').once('value');
        const playlist = snap.val() || [];
        playlist.push(song);
        await this.roomRef.child('playlist').set(playlist);
    }

    async removeSong(index) {
        if (!this.roomRef) return;
        const snap = await this.roomRef.child('playlist').once('value');
        const playlist = snap.val() || [];
        playlist.splice(index, 1);
        await this.roomRef.child('playlist').set(playlist);
    }

    async updateState(state) {
        if (!this.roomRef) return;
        await this.roomRef.child('state').update({
            ...state,
            updatedAt: Date.now()
        });
    }

    async getRoomInfo() {
        if (!this.roomRef) return null;
        const snap = await this.roomRef.once('value');
        return snap.val();
    }

    async leaveRoom() {
        if (!this.roomRef) return;

        // Remove listeners
        this.listeners.forEach(({ ref }) => ref.off());
        this.listeners = [];

        // Remove user
        await this.roomRef.child('users/' + this.userId).remove();

        // If host, delete room
        if (this.isHost) {
            await this.roomRef.remove();
        }

        this.roomRef = null;
        this.roomCode = null;
        this.isHost = false;
    }
}

// ============ MAIN APP ============

class MelodyFlow {
    constructor() {
        this.roomManager = new RoomManager();
        this.playlist = [];
        this.currentSongIndex = -1;
        this.isPlaying = false;
        this.isShuffle = false;
        this.repeatMode = 'none';
        this.volume = 80;
        this.player = null;
        this.playerReady = false;
        this.progressAnimFrame = null;
        this.isSeeking = false;
        this.ignoreNextStateUpdate = false;
        this.lastStateUpdate = 0;

        this.cacheDOM();
        this.bindEvents();
        this.initYouTubeAPI();
        this.checkNickname();
    }

    // ---- DOM Cache ----

    cacheDOM() {
        this.dom = {
            // Landing
            landing: document.getElementById('landing'),
            roomApp: document.getElementById('roomApp'),
            createRoomBtn: document.getElementById('createRoomBtn'),
            joinRoomBtn: document.getElementById('joinRoomBtn'),
            // Room info
            roomCodeDisplay: document.getElementById('roomCodeDisplay'),
            copyCodeBtn: document.getElementById('copyCodeBtn'),
            hostBadge: document.getElementById('hostBadge'),
            roomName: document.getElementById('roomName'),
            userCount: document.getElementById('userCount'),
            userList: document.getElementById('userList'),
            leaveRoomBtn: document.getElementById('leaveRoomBtn'),
            // Songs
            songCount: document.getElementById('songCount'),
            songList: document.getElementById('songList'),
            emptyPlaylistState: document.getElementById('emptyPlaylistState'),
            songUrlInput: document.getElementById('songUrlInput'),
            addSongBtn: document.getElementById('addSongBtn'),
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
            nicknameOverlay: document.getElementById('nicknameOverlay'),
            nicknameInput: document.getElementById('nicknameInput'),
            nicknameConfirm: document.getElementById('nicknameConfirm'),
            joinOverlay: document.getElementById('joinOverlay'),
            joinCodeInput: document.getElementById('joinCodeInput'),
            joinCancel: document.getElementById('joinCancel'),
            joinConfirm: document.getElementById('joinConfirm'),
            confirmOverlay: document.getElementById('confirmOverlay'),
            confirmTitle: document.getElementById('confirmTitle'),
            confirmMessage: document.getElementById('confirmMessage'),
            confirmCancel: document.getElementById('confirmCancel'),
            confirmOk: document.getElementById('confirmOk'),
        };
    }

    // ---- Events ----

    bindEvents() {
        // Landing buttons
        this.dom.createRoomBtn.addEventListener('click', () => this.handleCreateRoom());
        this.dom.joinRoomBtn.addEventListener('click', () => this.showJoinModal());

        // Room actions
        this.dom.copyCodeBtn.addEventListener('click', () => this.copyRoomCode());
        this.dom.leaveRoomBtn.addEventListener('click', () => this.handleLeaveRoom());

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
        this.dom.volumeBtn.addEventListener('click', () => this.toggleMute());

        // Nickname modal
        this.dom.nicknameConfirm.addEventListener('click', () => this.confirmNickname());
        this.dom.nicknameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmNickname();
        });

        // Join modal
        this.dom.joinCancel.addEventListener('click', () => {
            this.dom.joinOverlay.classList.remove('visible');
        });
        this.dom.joinConfirm.addEventListener('click', () => this.handleJoinRoom());
        this.dom.joinCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleJoinRoom();
        });

        // Progress bar
        this.setupSlider(this.dom.progressBarWrapper, this.dom.progressBarFill, this.dom.progressBarHandle, (pct) => {
            this.isSeeking = true;
            this.dom.progressBarFill.style.width = pct + '%';
            this.dom.progressBarHandle.style.left = pct + '%';
            const duration = this.getDuration();
            if (duration > 0) this.dom.currentTime.textContent = formatTime(duration * pct / 100);
        }, (pct) => {
            this.isSeeking = false;
            if (!this.roomManager.isHost) return;
            const duration = this.getDuration();
            if (duration > 0) {
                const targetTime = duration * pct / 100;
                if (this.player && this.playerReady) this.player.seekTo(targetTime, true);
                this.syncState({ seekTime: targetTime });
            }
        });

        // Volume slider
        this.setupSlider(this.dom.volumeBarWrapper, this.dom.volumeBarFill, this.dom.volumeBarHandle, (pct) => {
            this.setVolume(pct);
        }, (pct) => {
            this.setVolume(pct);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!this.roomManager.isHost && ['p', 'P', 'n', 'N', ' '].includes(e.key)) {
                if (e.key === ' ') e.preventDefault();
                return;
            }
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.setVolume(Math.min(100, this.volume + 5));
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.setVolume(Math.max(0, this.volume - 5));
                    break;
                case 'n': case 'N': this.nextSong(); break;
                case 'p': case 'P': this.prevSong(); break;
                case 'm': case 'M': this.toggleMute(); break;
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
        const start = (e) => { isDragging = true; onDrag(getPercent(e)); e.preventDefault(); };
        const move = (e) => { if (isDragging) onDrag(getPercent(e)); };
        const end = (e) => {
            if (!isDragging) return;
            isDragging = false;
            const rect = wrapper.getBoundingClientRect();
            const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            onRelease(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
        };
        wrapper.addEventListener('mousedown', start);
        wrapper.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', end);
        document.addEventListener('touchend', end);
    }

    // ---- Nickname ----

    checkNickname() {
        const name = getNickname();
        if (!name) {
            this.dom.nicknameOverlay.classList.add('visible');
            setTimeout(() => this.dom.nicknameInput.focus(), 100);
        }
        // Check URL for room code
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get('room');
        if (roomCode && name) {
            this.autoJoinRoom(roomCode);
        }
    }

    confirmNickname() {
        const name = this.dom.nicknameInput.value.trim();
        if (!name) {
            showToast('Please enter a nickname', 'error');
            return;
        }
        setNickname(name);
        this.dom.nicknameOverlay.classList.remove('visible');

        // Check if there's a room code in URL
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get('room');
        if (roomCode) {
            this.autoJoinRoom(roomCode);
        }
    }

    async autoJoinRoom(code) {
        try {
            await this.joinRoom(code);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    // ---- Room Management ----

    async handleCreateRoom() {
        if (!getNickname()) {
            this.dom.nicknameOverlay.classList.add('visible');
            return;
        }
        if (!this.roomManager.isReady()) {
            showToast('Firebase not configured. Check firebase-config.js', 'error');
            return;
        }

        try {
            const code = await this.roomManager.createRoom('MelodyFlow Room', getNickname());
            this.enterRoom(code);
            showToast(`Room created! Code: ${code}`, 'success');
        } catch (e) {
            showToast('Failed to create room: ' + e.message, 'error');
        }
    }

    showJoinModal() {
        if (!getNickname()) {
            this.dom.nicknameOverlay.classList.add('visible');
            return;
        }
        if (!this.roomManager.isReady()) {
            showToast('Firebase not configured. Check firebase-config.js', 'error');
            return;
        }
        this.dom.joinCodeInput.value = '';
        this.dom.joinOverlay.classList.add('visible');
        setTimeout(() => this.dom.joinCodeInput.focus(), 100);
    }

    async handleJoinRoom() {
        const code = this.dom.joinCodeInput.value.trim().toUpperCase();
        if (!code || code.length < 4) {
            showToast('Please enter a valid room code', 'error');
            return;
        }

        try {
            await this.joinRoom(code);
            this.dom.joinOverlay.classList.remove('visible');
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    async joinRoom(code) {
        const roomData = await this.roomManager.joinRoom(code, getNickname());
        this.enterRoom(code);
        showToast(`Joined room: ${code}`, 'success');
        return roomData;
    }

    enterRoom(code) {
        // Switch UI
        this.dom.landing.style.display = 'none';
        this.dom.roomApp.style.display = 'flex';
        this.dom.playerBar.style.display = 'flex';

        // Display room code
        this.dom.roomCodeDisplay.textContent = code;
        this.dom.hostBadge.style.display = this.roomManager.isHost ? 'flex' : 'none';

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('room', code);
        window.history.replaceState({}, '', url);

        // Disable controls for guests
        this.updateControlPermissions();

        // Listen for real-time updates
        this.roomManager.onPlaylistChange((playlist) => {
            this.playlist = playlist || [];
            this.renderSongs();
        });

        this.roomManager.onStateChange((state) => {
            if (!state) return;
            if (this.ignoreNextStateUpdate) {
                this.ignoreNextStateUpdate = false;
                return;
            }
            // Only sync if update is recent (within 3 seconds) or it's a new song
            const timeSinceUpdate = Date.now() - (state.updatedAt || 0);
            if (timeSinceUpdate > 10000 && state.currentIndex === this.currentSongIndex) return;

            this.handleRemoteStateChange(state);
        });

        this.roomManager.onUsersChange((users) => {
            this.renderUsers(users);
        });

        this.roomManager.onRoomDeleted(() => {
            if (!this.roomManager.isHost) {
                showToast('Room was closed by the host', 'info');
                this.exitToLanding();
            }
        });

        // Get initial room info
        this.roomManager.getRoomInfo().then(info => {
            if (info) {
                this.dom.roomName.textContent = info.name || 'MelodyFlow Room';
            }
        });
    }

    updateControlPermissions() {
        const isHost = this.roomManager.isHost;
        // Only host can control playback
        if (!isHost) {
            this.dom.playPauseBtn.classList.add('disabled');
            this.dom.prevBtn.classList.add('disabled');
            this.dom.nextBtn.classList.add('disabled');
            this.dom.shuffleBtn.classList.add('disabled');
            this.dom.repeatBtn.classList.add('disabled');
        } else {
            this.dom.playPauseBtn.classList.remove('disabled');
            this.dom.prevBtn.classList.remove('disabled');
            this.dom.nextBtn.classList.remove('disabled');
            this.dom.shuffleBtn.classList.remove('disabled');
            this.dom.repeatBtn.classList.remove('disabled');
        }
    }

    handleRemoteStateChange(state) {
        const songChanged = state.currentIndex !== this.currentSongIndex;

        this.currentSongIndex = state.currentIndex;
        this.isPlaying = state.isPlaying;

        if (songChanged && state.currentIndex >= 0 && state.currentIndex < this.playlist.length) {
            const song = this.playlist[state.currentIndex];
            if (this.player && this.playerReady) {
                this.player.loadVideoById(song.videoId, state.seekTime || 0);
                if (!state.isPlaying) {
                    setTimeout(() => this.player.pauseVideo(), 500);
                }
            }
            this.updatePlayerInfo(song);
        } else if (!songChanged && this.player && this.playerReady) {
            // Sync play/pause state
            if (state.isPlaying && !this.isPlayerPlaying()) {
                this.player.playVideo();
            } else if (!state.isPlaying && this.isPlayerPlaying()) {
                this.player.pauseVideo();
            }

            // Sync seek if difference is > 3 seconds
            if (state.seekTime !== undefined && !this.roomManager.isHost) {
                const currentTime = this.getCurrentTime();
                if (Math.abs(currentTime - state.seekTime) > 3) {
                    this.player.seekTo(state.seekTime, true);
                }
            }
        }

        this.updatePlayPauseUI();
        this.renderSongs();
    }

    isPlayerPlaying() {
        if (!this.player || !this.playerReady) return false;
        return this.player.getPlayerState() === YT.PlayerState.PLAYING;
    }

    async handleLeaveRoom() {
        const confirmed = await this.showConfirmModal(
            this.roomManager.isHost ? 'Close Room?' : 'Leave Room?',
            this.roomManager.isHost
                ? 'This will close the room for everyone.'
                : 'Are you sure you want to leave this room?'
        );
        if (confirmed) {
            await this.roomManager.leaveRoom();
            this.exitToLanding();
            showToast('Left the room', 'info');
        }
    }

    exitToLanding() {
        this.dom.roomApp.style.display = 'none';
        this.dom.playerBar.style.display = 'none';
        this.dom.landing.style.display = 'flex';
        this.stopPlayback();

        // Clear URL params
        const url = new URL(window.location);
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url);
    }

    copyRoomCode() {
        const code = this.roomManager.roomCode;
        if (!code) return;

        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('Room link copied!', 'success');
        }).catch(() => {
            navigator.clipboard.writeText(code).then(() => {
                showToast('Room code copied!', 'success');
            });
        });
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
                if (this.roomManager.isHost) this.onSongEnded();
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
        if (this.roomManager.isHost) setTimeout(() => this.nextSong(), 1500);
    }

    tryUpdateSongTitle() {
        if (!this.player || !this.playerReady) return;
        try {
            const videoData = this.player.getVideoData();
            if (videoData && videoData.title && this.currentSongIndex >= 0 && this.currentSongIndex < this.playlist.length) {
                const song = this.playlist[this.currentSongIndex];
                if (song.title.startsWith('Loading...') || song.title.startsWith('Video ')) {
                    song.title = videoData.title;
                    this.renderSongs();
                    this.dom.playerSongTitle.textContent = videoData.title;
                }
            }
        } catch (e) { /* ignore */ }
    }

    // ---- Song Management ----

    async handleAddSong() {
        const url = this.dom.songUrlInput.value.trim();
        if (!url) { showToast('Please paste a YouTube link', 'error'); return; }

        const videoId = extractVideoId(url);
        if (!videoId) { showToast('Invalid YouTube URL', 'error'); return; }

        this.dom.addSongBtn.classList.add('loading');
        this.dom.addSongBtn.innerHTML = '<div class="spinner"></div> Adding...';

        const info = await this.fetchVideoInfo(videoId);

        const song = {
            videoId,
            title: info.title,
            thumbnail: info.thumbnail,
            addedBy: getNickname(),
            addedAt: Date.now()
        };

        try {
            await this.roomManager.addSong(song);
            showToast(`"${song.title}" added`, 'success');
        } catch (e) {
            showToast('Failed to add song', 'error');
        }

        this.dom.songUrlInput.value = '';
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
            return { title: data.title || `Video ${videoId}`, thumbnail };
        } catch (e) {
            return { title: `Loading... (${videoId})`, thumbnail };
        }
    }

    async removeSong(index) {
        const song = this.playlist[index];
        try {
            await this.roomManager.removeSong(index);
            showToast(`"${song?.title || 'Song'}" removed`, 'info');
        } catch (e) {
            showToast('Failed to remove song', 'error');
        }
    }

    // ---- Playback ----

    playSong(index) {
        if (!this.roomManager.isHost) return;
        if (index < 0 || index >= this.playlist.length) return;

        this.currentSongIndex = index;
        const song = this.playlist[index];

        this.updatePlayerInfo(song);

        if (this.player && this.playerReady) {
            this.player.loadVideoById(song.videoId);
            this.isPlaying = true;
            this.updatePlayPauseUI();
        }

        this.syncState({
            currentIndex: index,
            isPlaying: true,
            seekTime: 0
        });

        this.renderSongs();
    }

    togglePlay() {
        if (!this.roomManager.isHost) return;

        if (this.currentSongIndex < 0 && this.playlist.length > 0) {
            this.playSong(0);
            return;
        }

        if (!this.player || !this.playerReady) return;

        if (this.isPlaying) {
            this.player.pauseVideo();
            this.syncState({ isPlaying: false, seekTime: this.getCurrentTime() });
        } else {
            this.player.playVideo();
            this.syncState({ isPlaying: true, seekTime: this.getCurrentTime() });
        }
    }

    nextSong() {
        if (!this.roomManager.isHost) return;
        if (this.playlist.length === 0) return;

        let nextIndex;
        if (this.isShuffle) {
            nextIndex = this.getShuffleIndex();
        } else {
            nextIndex = this.currentSongIndex + 1;
            if (nextIndex >= this.playlist.length) {
                if (this.repeatMode === 'all') {
                    nextIndex = 0;
                } else {
                    this.stopPlayback();
                    return;
                }
            }
        }
        this.playSong(nextIndex);
    }

    prevSong() {
        if (!this.roomManager.isHost) return;
        if (this.playlist.length === 0) return;

        if (this.getCurrentTime() > 3) {
            if (this.player && this.playerReady) this.player.seekTo(0, true);
            this.syncState({ seekTime: 0 });
            return;
        }

        let prevIndex = this.currentSongIndex - 1;
        if (prevIndex < 0) {
            prevIndex = this.repeatMode === 'all' ? this.playlist.length - 1 : 0;
        }
        this.playSong(prevIndex);
    }

    onSongEnded() {
        if (this.repeatMode === 'one') {
            if (this.player && this.playerReady) {
                this.player.seekTo(0, true);
                this.player.playVideo();
            }
            this.syncState({ seekTime: 0, isPlaying: true });
        } else {
            this.nextSong();
        }
    }

    stopPlayback() {
        if (this.player && this.playerReady) this.player.stopVideo();
        this.isPlaying = false;
        this.currentSongIndex = -1;
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

        if (this.roomManager.isHost) {
            this.syncState({ currentIndex: -1, isPlaying: false, seekTime: 0 });
        }
    }

    getShuffleIndex() {
        if (this.playlist.length <= 1) return 0;
        let next;
        do { next = Math.floor(Math.random() * this.playlist.length); } while (next === this.currentSongIndex);
        return next;
    }

    toggleShuffle() {
        if (!this.roomManager.isHost) return;
        this.isShuffle = !this.isShuffle;
        this.dom.shuffleBtn.classList.toggle('active', this.isShuffle);
        showToast(this.isShuffle ? 'Shuffle on' : 'Shuffle off', 'info');
    }

    toggleRepeat() {
        if (!this.roomManager.isHost) return;
        const modes = ['none', 'all', 'one'];
        const currentIdx = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIdx + 1) % modes.length];
        this.dom.repeatBtn.classList.toggle('active', this.repeatMode !== 'none');
        this.dom.repeatBadge.style.display = this.repeatMode === 'one' ? 'flex' : 'none';
        const labels = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
        showToast(labels[this.repeatMode], 'info');
    }

    syncState(stateUpdate) {
        if (!this.roomManager.isHost) return;
        this.ignoreNextStateUpdate = true;
        this.roomManager.updateState(stateUpdate);
    }

    // ---- Volume ----

    setVolume(vol) {
        this.volume = Math.round(vol);
        if (this.player && this.playerReady) this.player.setVolume(this.volume);
        this.dom.volumeBarFill.style.width = this.volume + '%';
        this.dom.volumeBarHandle.style.left = this.volume + '%';
        this.updateVolumeIcon();
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
        const wave1 = document.getElementById('volumeWave1');
        const wave2 = document.getElementById('volumeWave2');
        if (wave1) wave1.style.opacity = this.volume > 50 ? '1' : '0.2';
        if (wave2) wave2.style.opacity = this.volume > 20 ? '1' : '0.2';
    }

    getCurrentTime() {
        if (this.player && this.playerReady && typeof this.player.getCurrentTime === 'function') {
            return this.player.getCurrentTime() || 0;
        }
        return 0;
    }

    getDuration() {
        if (this.player && this.playerReady && typeof this.player.getDuration === 'function') {
            return this.player.getDuration() || 0;
        }
        return 0;
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

    // ---- UI ----

    updatePlayerInfo(song) {
        this.dom.playerSongTitle.textContent = song.title;
        this.dom.playerPlaylistName.textContent = this.roomManager.roomCode ? `Room ${this.roomManager.roomCode}` : '';
        this.dom.playerThumbnail.src = song.thumbnail;
        this.dom.playerThumbnail.classList.add('visible');
        document.title = `${song.title} - MelodyFlow`;
    }

    updatePlayPauseUI() {
        this.dom.playIcon.style.display = this.isPlaying ? 'none' : 'block';
        this.dom.pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
        this.dom.playPauseBtn.title = this.isPlaying ? 'Pause' : 'Play';
        this.renderSongs();
    }

    renderSongs() {
        const container = this.dom.songList;
        const isEmpty = this.playlist.length === 0;

        this.dom.emptyPlaylistState.style.display = isEmpty ? 'flex' : 'none';
        this.dom.songList.style.display = isEmpty ? 'none' : 'block';
        this.dom.songCount.textContent = `${this.playlist.length} song${this.playlist.length !== 1 ? 's' : ''}`;

        container.innerHTML = '';

        this.playlist.forEach((song, index) => {
            const isPlayingThis = this.currentSongIndex === index;
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
                    ${song.addedBy ? `<span class="song-added-by">Added by ${this.escapeHTML(song.addedBy)}</span>` : ''}
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

            item.addEventListener('click', (e) => {
                if (e.target.closest('.song-actions')) return;
                if (this.roomManager.isHost) this.playSong(index);
            });

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

    renderUsers(users) {
        const container = this.dom.userList;
        container.innerHTML = '';
        const userEntries = Object.entries(users);
        this.dom.userCount.textContent = userEntries.length;

        userEntries.forEach(([userId, userData]) => {
            const isHost = userId === this.roomManager.roomRef?.parent?.key ? false : true;
            const item = document.createElement('div');
            item.className = 'user-item';
            const color = getAvatarColor(userId);
            const initial = (userData.name || '?')[0].toUpperCase();

            item.innerHTML = `
                <div class="user-avatar" style="background:${color}">${initial}</div>
                <span class="user-name">${this.escapeHTML(userData.name || 'Anonymous')}</span>
                ${userId === this.roomManager.userId ? '<span style="font-size:10px;color:var(--text-muted)">(you)</span>' : ''}`;

            container.appendChild(item);
        });
    }

    // ---- Modals ----

    showConfirmModal(title, message) {
        return new Promise((resolve) => {
            this.dom.confirmTitle.textContent = title;
            this.dom.confirmMessage.textContent = message;
            this.dom.confirmOk.textContent = this.roomManager.isHost ? 'Close Room' : 'Leave';
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

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MelodyFlow();
});
