<script>
import { ActionBuffer, baseURL, checkFetch, connectSocketIO, convertAlphaTexSyncPoint, generalError, getInstrumentName, getSetting } from "../app.js";
import { defineComponent } from "vue";
import { BDropdown, BDropdownDivider, BDropdownItem } from "bootstrap-vue-next";
import { notify } from "@kyvg/vue3-notification";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { isLoggedIn } from "../auth-client.js";

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode, StaveProfile } = alphaTab;

const speedActionBuffer = new ActionBuffer(1000);
const syncOffsetYoutubeActionBuffer = new ActionBuffer(200);
const syncOffsetAudioActionBuffer = new ActionBuffer(200);

export default defineComponent({
    /**
     * @type {SocketIOClient.Socket}
     */
    socket: null,
    /**
     * @type {alphaTab.AlphaTabApi}
     */
    api: null,
    
    audioHandler: null,

    alphaTabYoutubeHandler: null,

    youtubePlayer: null,
    
    components: { FontAwesomeIcon, BDropdownDivider, BDropdownItem, BDropdown },
    data() {
        return {
            isLoggedIn: false,
            title: "",
            artist: "",
            youtube: {},
            tabID: -1,
            tracks: [],
            showTrackList: false,
            showAudioList: false,
            tab: {},
            playing: false,
            enableCountIn: false,
            enableMetronome: false,
            enableBackingTrack: true,
            isLooping: false,
            speed: 100,
            ready: false,
            selectedTrack: 0,
            soloTrackID: -1,
            muteTrackList: {},
            currentAudio: "synth",
            youtubeList: [],
            audioList: [],
            audio: {},

            keyEvents: (e) => {
                if (e.code === "Space") {
                    e.preventDefault();
                    this.playPause();
                }
            },
            setting: {},
            simpleSyncSecond: -1,
        };
    },
    computed: {
        animatedCursor() {
            return this.setting.cursor === "animated";
        },
        
        syncMethod() {
            if (this.currentAudio.startsWith("youtube-"))  {  
                return this.youtube.syncMethod;
            } else if (this.currentAudio.startsWith("audio-")) {
                return this.audio.syncMethod;
            } else {
                return undefined;
            }
        }
    },

    watch: {
        simpleSyncSecond(newVal, oldVal) {
            if (!this.api) {
                return;
            }
            
            let obj;
            
            if (this.currentAudio.startsWith("youtube-"))  {  
                if (!this.youtube) {
                    return;
                }
                obj = this.youtube;
            } else if (this.currentAudio.startsWith("audio-")) {
                if (!this.audio) {
                    return;
                }
                obj = this.audio;
            }

            this.pause();

            obj.simpleSync = this.simpleSyncSecond * 1000;

            // Bug? If change to EnabledExternalMedia, andthis.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            this.simpleSync(obj.simpleSync);

            // Restore
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();
   

            // Save
            if (this.currentAudio.startsWith("youtube-"))  {
                this.api.player.output.handler = this.alphaTabYoutubeHandler;
                syncOffsetYoutubeActionBuffer.run(() => {
                    if (oldVal !== -1) {
                        this.saveYoutube();
                    }
                });
            } else {
                this.api.player.output.handler = this.audioHandler;
                syncOffsetAudioActionBuffer.run(() => {
                    if (oldVal !== -1) {
                        this.saveAudio();
                    }
                });
            }
        },

        "youtube.simpleSync"() {
            if (!this.api || !this.youtube) {
                return;
            }
            this.simpleSyncSecond = parseFloat((this.youtube.simpleSync / 1000).toFixed(2));
        },
        
        "audio.simpleSync"() {
            if (!this.api || !this.audio) {
                return;
            }
            this.simpleSyncSecond = parseFloat((this.audio.simpleSync / 1000).toFixed(2));
        },

        playing() {
            if (!this.api) {
                return;
            }

            if (this.playing) {
                this.api.settings.player.scrollMode = ScrollMode.Continuous;
                this.api.updateSettings();
                this.api.play();
            } else {
                this.api.pause();
            }

            // Hide the cursor when playing
            if (this.setting.cursor === "invisible" || this.setting.cursor === "bar") {
                const cursor = document.querySelector(".at-cursor-beat");
                if (cursor) {
                    if (this.playing) {
                        console.log("Hide cursor");
                        cursor.classList.add("invisible");
                    } else {
                        console.log("Show cursor");
                        cursor.classList.remove("invisible");
                    }
                }
            }

            // Show the bar cursor if enabled
            if (this.setting.cursor === "bar") {
                const barCursor = document.querySelector(".at-cursor-bar");
                if (barCursor) {
                    barCursor.classList.add("enable");
                }
            }
        },

        enableCountIn() {
            if (!this.api) {
                return;
            }
            if (this.enableCountIn) {
                this.api.countInVolume = 1;
            } else {
                this.api.countInVolume = 0;
            }
            this.setConfig("enableCountIn", this.enableCountIn);
        },

        enableMetronome() {
            if (!this.api) {
                return;
            }
            if (this.enableMetronome) {
                this.api.metronomeVolume = 1;
            } else {
                this.api.metronomeVolume = 0;
            }
            this.setConfig("enableMetronome", this.enableMetronome);
        },

        isLooping() {
            if (!this.api) {
                return;
            }
            this.api.isLooping = this.isLooping;
            this.setConfig("isLooping", this.isLooping);
        },

        speed(newVal) {
            if (!this.api) {
                return;
            }
            console.log("Speed changed to:", newVal);

            let speed = newVal;

            if (typeof speed !== "number" || isNaN(speed)) {
                speed = 100;
            } else if (speed < 20) {
                speed = 20;
            } else if (speed > 1000) {
                speed = 1000;
            }

            // Rate limit the speed change action
            speedActionBuffer.run(() => {
                this.api.playbackSpeed = parseFloat((speed / 100).toFixed(2));
                this.setConfig("speed", speed);
            });
        },

        // Switch Audio Source
        async currentAudio() {
            console.log("Switching audio to:", this.currentAudio);

            if (!this.api) {
                return;
            }

            this.api.player.masterVolume = 1;

            if (this.currentAudio === "synth") {
                await this.initSynth();
            } else if (this.currentAudio === "backingTrack") {
                this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack;
                this.api.updateSettings();
                this.pause();
            } else if (this.currentAudio.startsWith("youtube-")) {
                const videoID = this.currentAudio.substring(8);
                await this.initYoutube(videoID);
            } else if (this.currentAudio.startsWith("audio-")) {
                const filename = this.currentAudio.substring(6);
                await this.initAudio(filename);
            } else if (this.currentAudio === "none") {
                // Workaround: alphaTab.PlayerMode.Disabled is not working, so just mute the volume
                this.api.player.masterVolume = 0;
                this.pause();
            } else {
                // Unknown audio source, fallback to synth
                await this.initSynth();
                notify({
                    type: "error",
                    title: "Error",
                    text: "Unknown audio source, fallback to synth.",
                });
                return;
            }

            this.setConfig("audio", this.currentAudio);
        },
    },

    // Mounted
    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.setting = getSetting();
        this.tabID = this.$route.params.id;
        const urlParams = new URLSearchParams(window.location.search);

        try {
            // Override trackID if provided in URL
            const trackParam = urlParams.get("track");
            if (trackParam) {
                const id = parseInt(trackParam);
                if (!isNaN(id)) {
                    this.setConfig("trackID", id);
                }
            }

            // Override audio source if provided in URL
            const audioParam = urlParams.get("audio");
            if (audioParam) {
                this.setConfig("audio", audioParam);
            }

            const trackID = this.getConfig("trackID", 0);

            // Load the AlphaTab
            await this.load(trackID);

            window.addEventListener("keydown", this.keyEvents);
        } catch (e) {
            notify({
                type: "error",
                title: "Error",
                text: e.message,
            });
        }

        console.log("Mounted");
    },
    beforeUnmount() {
        console.log("Before unmount");
        this.destroyContainer();
        window.removeEventListener("keydown", this.keyEvents);
    },
    methods: {
        async load(trackID) {
            if (this.api) {
                this.destroyContainer();
            }

            const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                credentials: "include",
            });

            try {
                await checkFetch(res);
            } catch (e) {
                if (e.message === "Not logged in") {
                    this.$router.push("/login");
                    return;
                } else {
                    throw e;
                }
            }

            const data = await res.json();
            if (data.tab) {
                this.tab = data.tab;
                this.youtubeList = data.youtubeList;
                this.audioList = data.audioList;
            }

            const tempToken = await this.getTempToken();

            // Requested trackID may be invalid, so we need to get the actual trackID used
            trackID = await this.initContainer(tempToken, trackID);

            this.setConfig("trackID", trackID);
        },

        countIn() {
            this.enableCountIn = !this.enableCountIn;
        },

        metronome() {
            this.enableMetronome = !this.enableMetronome;
        },

        loop() {
            this.isLooping = !this.isLooping;
        },

        playPause() {
            if (!this.api || !this.ready) {
                return;
            }

            this.playing = !this.playing;
        },

        play() {
            if (!this.api || !this.ready) {
                return;
            }
            this.playing = true;
        },

        pause() {
            if (!this.api || !this.ready) {
                return;
            }
            this.playing = false;
        },

        getFileURL(tempToken) {
            return baseURL + `/api/tab/${this.tabID}/file?tempToken=${tempToken}`;
        },

        async getTempToken() {
            const fileURL = baseURL + `/api/tab/${this.tabID}/temp-token`;

            // fetch the file as array buffer
            const response = await fetch(fileURL, {
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error("Failed to get get temp token");
            }
            return (await response.json()).token;
        },

        /**
         * @param tempToken
         * @param trackID
         * @returns {Promise<number>} The actual trackID used
         */
        initContainer(tempToken, trackID) {
            return new Promise((resolve, reject) => {
                if (this.api) {
                    this.destroyContainer();
                }

                if (!(this.$refs.bassTabContainer instanceof HTMLElement)) {
                    reject(new Error("Container element not found"));
                }

                let displayResources = {
                    tablatureFont: "bold 14px Arial",
                    barNumberColor: "#6D6D6D",
                };

                if (this.setting.scoreColor === "dark") {
                    displayResources = {
                        ...displayResources,
                        staffLineColor: "#6D6D6D",
                        barSeparatorColor: "#6D6D6D",
                        mainGlyphColor: "#A4A4A4",
                        secondaryGlyphColor: "#A4A4A4",
                        scoreInfoColor: "#A4A4A4",
                        barNumberColor: "#6D6D6D",
                    };
                }

                this.api = new alphaTab.AlphaTabApi(this.$refs.bassTabContainer, {
                    notation: {
                        rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
                        //rhythmHeight: 30,
                        elements: {
                            scoreTitle: false,
                            scoreSubTitle: false,
                            scoreArtist: false,
                            scoreAlbum: false,
                            scoreWords: false,
                            scoreMusic: false,
                            scoreWordsAndMusic: false,
                            scoreCopyright: false,
                        },
                    },
                    core: {
                        file: this.getFileURL(tempToken),
                        //tracks: [trackID],
                        fontDirectory: "/font/",
                        engine: "html5",
                    },
                    player: {
                        enablePlayer: true,

                        // Always enable, so we can navigate to any position
                        enableCursor: true,
                        enableAnimatedBeatCursor: this.animatedCursor,
                        enableUserInteraction: true,
                        soundFont: "/soundfont/sonivox.sf2",
                        //nativeBrowserSmoothScroll: true,
                        scrollMode: ScrollMode.Off,
                        scrollOffsetY: -50,
                        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
                    },
                    display: {
                        staveProfile: this.getStaveProfile(),
                        resources: displayResources,
                    },
                });

                // Exposing api to window for debugging
                window.api = this.api;

                // Score Loaded
                this.api.scoreLoaded.on(async (score) => {
                    console.log("Score loaded");

                    this.applyColors(score);

                    // Track
                    if (trackID < 0 || trackID >= score.tracks.length) {
                        trackID = 0;
                    }
                    this.api.renderTracks([this.api.score.tracks[trackID]]);

                    // Set Audio source
                    this.currentAudio = this.getConfig("audio", "synth");

                    // Metronome
                    this.enableMetronome = this.getConfig("enableMetronome", false);

                    // Count in
                    this.enableCountIn = this.getConfig("enableCountIn", false);

                    // Looping
                    this.isLooping = this.getConfig("isLooping", false);

                    // Speed
                    this.speed = 100;
                    this.speed = this.getConfig("speed", 100);

                    this.tracks = [];

                    // List all tracks
                    score.tracks.forEach((track) => {
                        this.tracks.push({
                            id: track.index,
                            name: getInstrumentName(track.playbackInfo.program),
                            program: track.playbackInfo.program,
                        });
                    });

                    // Force score+tab if the current track program = 0 (probably drums)
                    if (score.tracks[trackID].playbackInfo.program === 0) {
                        this.api.settings.display.staveProfile = StaveProfile.ScoreTab;
                        this.api.updateSettings();
                    }

                    this.enableBackingTrack = this.hasBackingTrack();
                    this.selectedTrack = trackID;
                    this.ready = true;
                    resolve(trackID);
                });

                this.api.playerFinished.on(() => {
                    if (!this.isLooping) {
                        this.playing = false;
                    }
                });
            });
        },

        destroyContainer() {
            this.api?.destroy();
            this.api = undefined;

            // Reset states
            this.ready = false;
            this.playing = false;
            this.currentAudio = "synth";
            this.enableMetronome = false;
            this.enableCountIn = false;
            this.isLooping = false;
            this.speed = 100;
            this.soloTrackID = -1;
            this.youtube = {};
            this.simpleSyncSecond = -1;
            this.muteTrackList = {};
        },

        simpleSync(offset) {
            // Apply sync points
            const syncPoints = [
                { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": offset },
            ];
            this.api.score.applyFlatSyncPoints(syncPoints);
        },

        advancedSync(syncPointsText) {
            const syncPoints = convertAlphaTexSyncPoint(syncPointsText);
            this.api.score.applyFlatSyncPoints(syncPoints);
            console.log("Applying advanced sync points:", syncPoints);
        },

        // Style the score with custom colors
        applyColors(score) {
            const stringColors = {
                1: alphaTab.model.Color.fromJson("#bf3732"),
                2: alphaTab.model.Color.fromJson("#fff800"),
                3: alphaTab.model.Color.fromJson("#0080ff"),
                4: alphaTab.model.Color.fromJson("#e07b39"),
                5: alphaTab.model.Color.fromJson("#2A8E08"),
                6: alphaTab.model.Color.fromJson("#A349A4"),
            };

            if (this.setting.scoreColor === "light") {
                stringColors[2] = alphaTab.model.Color.fromJson("#b5a33a");
            }

            // traverse hierarchy and apply colors as desired
            for (const track of score.tracks) {
                for (const staff of track.staves) {
                    for (const bar of staff.bars) {
                        for (const voice of bar.voices) {
                            for (const beat of voice.beats) {
                                // on tuplets colors beam and tuplet bracket
                                if (beat.hasTuplet) {
                                    beat.style = new alphaTab.model.BeatStyle();
                                    const color = alphaTab.model.Color.fromJson("#00DD00");
                                    beat.style.colors.set(
                                        alphaTab.model.BeatSubElement.StandardNotationTuplet,
                                        color,
                                    );
                                    beat.style.colors.set(
                                        alphaTab.model.BeatSubElement.StandardNotationBeams,
                                        color,
                                    );
                                }

                                if (this.setting.noteColor === "rocksmith") {
                                    for (const note of beat.notes) {
                                        note.style = new alphaTab.model.NoteStyle();
                                        //note.style.colors.set(alphaTab.model.NoteSubElement.StandardNotationNoteHead, stringColors[note.string]);
                                        note.style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, stringColors[note.string]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        async initSocketIO() {
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            this.socket = connectSocketIO();

            this.socket.on("connect", () => {
                console.log("Connected to server");
            });

            this.socket.on("disconnect", () => {
                console.log("Disconnected from server");
            });
        },

        async audioYoutube(videoID) {
            this.currentAudio = "youtube-" + videoID;
            this.closeAllList();
        },
        
        async audioFile(filename) {
            this.currentAudio = "audio-" + filename;
            this.closeAllList();
        },
        
        async initAudio(filename) {
            if (!this.api) {
                return;
            }
            
            this.closeAllList();

            const audioPlayer = this.$refs.audioPlayer;
            
            // Init the audio handler if not exists
            if (!this.audioHandler) {
                
                this.audioHandler = {
                    get backingTrackDuration() {
                        const duration = audioPlayer.duration;
                        return Number.isFinite(duration) ? duration * 1000 : 0;
                    },
                    get playbackRate() {
                        return audioPlayer.playbackRate;
                    },
                    set playbackRate(value) {
                        audioPlayer.playbackRate = value;
                    },
                    get masterVolume() {
                        return audioPlayer.volume;
                    },
                    set masterVolume(value) {
                        audioPlayer.volume = value;
                    },
                    seekTo(time) {
                        audioPlayer.currentTime = time / 1000;
                    },
                    play() {
                        audioPlayer.play();
                    },
                    pause() {
                        audioPlayer.pause();
                    }
                };

                let updateTimer = 0;
                const onTimeUpdate = () => {
                    this.api?.player?.output?.updatePosition(
                        audioPlayer.currentTime * 1000
                    );
                }

                audioPlayer.addEventListener('timeupdate', onTimeUpdate);
                audioPlayer.addEventListener('seeked', onTimeUpdate);
                audioPlayer.addEventListener('play', () => {
                    window.clearInterval(updateTimer);
                    this.api?.play();
                    updateTimer = window.setInterval(onTimeUpdate, 50);
                });

                // state updates
                audioPlayer.addEventListener('pause', () => {
                    this.api.pause();
                    window.clearInterval(updateTimer.current);
                });
                audioPlayer.addEventListener('ended', () => {
                    this.api.pause();
                    window.clearInterval(updateTimer.current);
                });
                audioPlayer.addEventListener('volumechange', () => {
                    this.api.masterVolume = audioPlayer.volume;
                });
                audioPlayer.addEventListener('ratechange', () => {
                    this.api.playbackSpeed = audioPlayer.playbackRate;
                });
                
            }

            // Bug? If change to EnabledExternalMedia, and this.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            let found = false;

            // Get offset from youtubeList
            for (const audio of this.audioList) {
                if (audio.filename === filename) {
                    this.audio = audio;
                    if (audio.syncMethod === "advanced") {
                        this.advancedSync(audio.advancedSync);
                    } else {
                        this.simpleSync(audio.simpleSync);
                    }
                    found = true;
                    break;
                }
            }

            // Probably provided a video ID not in the list, switch to synth
            if (!found) {
                notify({
                    type: "error",
                    title: "Error",
                    text: "YouTube video not found, fallback to synth.",
                });
                this.currentAudio = "synth";
                return;
            }

            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();
            
            this.api.player.output.handler = this.audioHandler;
            
            const path = baseURL + `/api/tab/${this.tabID}/audio/${encodeURIComponent(filename)}`;
            
            audioPlayer.src = path;
            audioPlayer.load();
            audioPlayer.playbackRate = this.api.playbackSpeed;
            
            this.pause();
        },

        async initYoutube(videoID) {
            this.closeAllList();

            if (!this.youtubePlayer) {
                await this.initYoutubePlayer();
            }

            // Bug? If change to EnabledExternalMedia, andthis.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            let found = false;

            // Get offset from youtubeList
            for (const yt of this.youtubeList) {
                if (yt.videoID === videoID) {
                    this.youtube = yt;
                    if (yt.syncMethod === "advanced") {
                        this.advancedSync(yt.advancedSync);
                    } else {
                        this.simpleSync(yt.simpleSync);
                    }
                    found = true;
                    break;
                }
            }

            // Probably provided a video ID not in the list, switch to synth
            if (!found) {
                notify({
                    type: "error",
                    title: "Error",
                    text: "YouTube video not found, fallback to synth.",
                });
                this.currentAudio = "synth";
                return;
            }

            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            this.api.player.output.handler = this.alphaTabYoutubeHandler;
            this.youtubePlayer.cueVideoById(videoID);
            this.youtubePlayer.setPlaybackRate(this.api.playbackSpeed);
            this.pause();
        },

        async initYoutubePlayer() {
            const ytWarning = setTimeout(() => {
                notify({
                    type: "warning",
                    title: "Warning",
                    text: "If YouTube is taking too long to load, please refresh the page.",
                });
            }, 5000);

            this.$refs.youtube.innerHTML = "";

            const isScriptLoaded = typeof YT !== "undefined";
            console.log("isScriptLoaded:", isScriptLoaded);

            // Create playerElement inside this.$refs.youtube
            const playerElement = document.createElement("div");
            this.$refs.youtube.appendChild(playerElement);

            if (!isScriptLoaded) {
                const tag = document.createElement("script");
                tag.src = "https://www.youtube.com/player_api";
                const firstScriptTag = document.getElementsByTagName("script")[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
                console.log("Loading YouTube API");

                const youtubeApiReady = Promise.withResolvers();
                window.onYouTubePlayerAPIReady = youtubeApiReady.resolve;
                await youtubeApiReady.promise;
                console.log("YouTube API ready");

                // Now Youtube Script is loaded
                // The YT object is now available globally, even if vue route changed. Be careful.
            } else {
                console.log("YouTube API already loaded");
            }

            const youtubePlayerReady = Promise.withResolvers();
            let currentTimeInterval = 0;
            const player = new YT.Player(playerElement, {
                height: "180",
                width: "320",
                //videoId: videoID,
                playerVars: { "autoplay": 0 }, // we do not want autoplay
                events: {
                    "onReady": (e) => {
                        youtubePlayerReady.resolve();
                    },

                    // when the player state changes we update alphatab accordingly.
                    "onStateChange": (e) => {
                        //
                        switch (e.data) {
                            case YT.PlayerState.PLAYING:
                                currentTimeInterval = window.setInterval(() => {
                                    this.api?.player?.output?.updatePosition(player.getCurrentTime() * 1000);
                                }, 50);
                                this.playing = true;
                                this.api?.play();
                                break;
                            case YT.PlayerState.ENDED:
                                window.clearInterval(currentTimeInterval);
                                this.playing = false;
                                this.api?.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                window.clearInterval(currentTimeInterval);
                                this.playing = false;
                                this.api?.pause();
                                break;
                            default:
                                break;
                        }
                    },
                    "onPlaybackRateChange": (e) => {
                        this.api.playbackSpeed = e.data;
                    },
                    "onError": (e) => {
                        youtubePlayerReady.reject(e);
                    },
                },
            });

            await youtubePlayerReady.promise;
            console.log("YouTube Player ready");

            let initialSeek = -1;
            const alphaTabYoutubeHandler = {
                get backingTrackDuration() {
                    return player.getDuration() * 1000;
                },
                get playbackRate() {
                    console.log("Get playback rate:", player.getPlaybackRate());
                    return player.getPlaybackRate();
                },
                set playbackRate(value) {
                    console.log("Set playback rate:", value);
                    player.setPlaybackRate(value);
                },
                get masterVolume() {
                    return player.getVolume() / 100;
                },
                set masterVolume(value) {
                    player.setVolume(value * 100);
                },
                seekTo(time) {
                    if (
                        player.getPlayerState() !== YT.PlayerState.PAUSED &&
                        player.getPlayerState() !== YT.PlayerState.PLAYING
                    ) {
                        initialSeek = time / 1000;
                    } else {
                        player.seekTo(time / 1000);
                    }
                },
                play() {
                    player.playVideo();
                    if (initialSeek >= 0) {
                        player.seekTo(initialSeek);
                        initialSeek = -1;
                    }
                },
                pause() {
                    player.pauseVideo();
                },
            };

            this.youtubePlayer = player;
            this.alphaTabYoutubeHandler = alphaTabYoutubeHandler;
            clearTimeout(ytWarning);
        },

        getStaveProfile() {
            if (this.setting.scoreStyle === "tab") {
                return StaveProfile.Tab;
            } else if (this.setting.scoreStyle === "score") {
                return StaveProfile.Score;
            } else if (this.setting.scoreStyle === "score-tab") {
                return StaveProfile.ScoreTab;
            } else {
                return StaveProfile.Default;
            }
        },

        async audioSynth() {
            this.currentAudio = "synth";
            this.closeAllList();
        },

        async initSynth() {
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();
            this.pause();
        },

        async audioBackingTrack() {
            if (!this.hasBackingTrack()) {
                notify({
                    type: "error",
                    title: "Error",
                    text: "No backing track found in this tab.",
                });
                return;
            }
            this.currentAudio = "backingTrack";
            this.closeAllList();
        },

        /**
         * TODO
         */
        async initSocket() {
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            // check if connected to socket

            // websocket get info first
            this.socket.emit("waitMPC");

            const handler = {
                get backingTrackDuration() {
                    return 0;
                },
                get playbackRate() {
                    return player.getPlaybackRate();
                },
                set playbackRate(value) {
                    player.setPlaybackRate(value);
                },
                get masterVolume() {
                    return player.getVolume() / 100;
                },
                set masterVolume(value) {
                    player.setVolume(value * 100);
                },
                seekTo(time) {
                    if (
                        player.getPlayerState() !== YT.PlayerState.PAUSED &&
                        player.getPlayerState() !== YT.PlayerState.PLAYING
                    ) {
                        initialSeek = time / 1000;
                    } else {
                        player.seekTo(time / 1000);
                    }
                },
                play() {
                    player.playVideo();
                    if (initialSeek >= 0) {
                        player.seekTo(initialSeek);
                        initialSeek = -1;
                    }
                },
                pause() {
                },
            };

            this.api.player.output.handler = handler;
        },

        /**
         * As Docs suggested, I should use api.renderTrack() to change track
         * But for some reason, some slide notes are not rendered correctly
         * So I just reload the whole AlphaTab instance instead.
         * @param trackID
         * @returns {Promise<void>}
         */
        async changeTrack(trackID) {
            await this.load(trackID);
            this.closeAllList();
        },

        showList(type) {
            if (type === "track") {
                this.showTrackList = !this.showTrackList;
                this.showAudioList = false;
            } else if (type === "audio") {
                this.showAudioList = !this.showAudioList;
                this.showTrackList = false;
            }
        },

        closeAllList() {
            this.showTrackList = false;
            this.showAudioList = false;
        },

        toggleSolo(trackID) {
            if (!this.api) {
                return;
            }

            if (this.soloTrackID === trackID) {
                this.api.changeTrackMute(this.api.score.tracks, false);
                this.soloTrackID = -1;
                this.muteTrackList = {};
            } else {
                const muteList = [];
                const soloList = [];

                for (const track of this.api.score.tracks) {
                    if (track.index !== trackID) {
                        muteList.push(track);
                        this.muteTrackList[track.index] = true;
                    } else {
                        soloList.push(track);
                        this.muteTrackList[track.index] = false;
                    }
                }

                this.api.changeTrackMute(muteList, true);
                this.api.changeTrackMute(soloList, false);

                this.soloTrackID = trackID;
            }
        },

        toggleMute(trackID) {
            this.soloTrackID = -1;

            this.muteTrackList[trackID] = !this.muteTrackList[trackID];

            const mute = this.muteTrackList[trackID];

            this.api.changeTrackMute([
                this.api.score.tracks[trackID],
            ], mute);
        },

        edit() {
            this.$router.push(`/tab/${this.tabID}/edit/info`);
        },

        hasBackingTrack() {
            return !!this.api.score.backingTrack;
        },

        setConfig(key, value) {
            localStorage.setItem(`tab-${this.tabID}-${key}`, JSON.stringify(value));
        },

        getConfig(key, defaultValue) {
            const value = localStorage.getItem(`tab-${this.tabID}-${key}`);
            if (value === null) {
                return defaultValue;
            }
            return JSON.parse(value);
        },

        async saveYoutube() {
            let res;
            try {
                res = await fetch(baseURL + `/api/tab/${this.tabID}/youtube/${this.youtube.videoID}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: this.youtube.syncMethod,
                        simpleSync: this.youtube.simpleSync,
                        advancedSync: this.youtube.advancedSync,
                    }),
                });

                await checkFetch(res);
            } catch (e) {
                generalError(e);
            }
        },

        async saveAudio() {
            let res;
            try {
                res = await fetch(baseURL + `/api/tab/${this.tabID}/audio/${this.audio.filename}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: this.audio.syncMethod,
                        simpleSync: this.audio.simpleSync,
                        advancedSync: this.audio.advancedSync,
                    }),
                });

                await checkFetch(res);
            } catch (e) {
                generalError(e);
            }
        },
    },
});
</script>

<template>
    <div class="main" :class='{ "light": this.setting.scoreColor === "light" }'>
        <h1>{{ tab.title }}</h1>
        <h2>{{ tab.artist }}</h2>
        <div ref="bassTabContainer" v-pre></div>

        <!-- Just add a margin, don't let youtube player overlay the tab -->
        <div :class='{ "yt-margin": currentAudio.startsWith(`youtube-`) }'></div>

        <div class="toolbar">
            <div class="scroll">
                <div class="track-selector selector">
                    <div class="button" @click='showList("track")'>
                        <span v-if="tracks.length > 0">{{ tracks[selectedTrack].name }}</span>
                        <span v-else>Loading...</span>
                    </div>
                </div>

                <div class="audio-selector selector">
                    <div class="button" @click='showList("audio")'>
                        Audio
                    </div>
                </div>

                <button class="btn btn-primary" @click="playPause" :class="{ active: playing }">
                <span v-if="!playing">
                    <font-awesome-icon :icon='["fas", "play"]' />
                    Play
                </span>
                    <span v-else>
                    <font-awesome-icon :icon='["fas", "pause"]' />
                    Pause
                </span>
                </button>
                <button class="btn btn-secondary" @click="loop()" :class="{ active: isLooping }">
                    <font-awesome-icon :icon='["fas", "check"]' v-if="isLooping" />
                    Loop
                </button>
                <button class="btn btn-secondary" @click="countIn()" :class='{ active: enableCountIn, disabled: currentAudio !== "synth" }'>
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableCountIn" />
                    Count in
                </button>
                <button class="btn btn-secondary" @click="metronome()" :class='{ active: enableMetronome, disabled: currentAudio !== "synth" }'>
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableMetronome" />
                    Metronome
                </button>

                <div class="speed">
                    Speed: <input type="number" class="form-control" min="0" max="1000" step="1" v-model="speed" /> (%)
                </div>

                <div class="btn-edit" v-if="isLoggedIn">
                    <button class="btn btn-secondary" @click="edit()">
                        Edit
                    </button>
                </div>
            </div>

            <div class="track-list list" v-if="showTrackList">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showTrackList = false" />
                </div>

                <div class="track item" v-for="track in tracks" :key="track.id" :class="{ active: selectedTrack === track.id }">
                    <div class="name" @click="changeTrack(track.id)">{{ track.name }}</div>
                    <div class="list-button solo" @click="toggleSolo(track.id)" :class="{ active: soloTrackID === track.id }">Solo</div>
                    <div class="list-button mute" @click="toggleMute(track.id)" :class="{ active: muteTrackList[track.id] }">Mute</div>
                </div>
            </div>

            <div class="audio-list list" v-if="showAudioList">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showAudioList = false" />
                </div>

                <div class="audio item" @click="audioSynth" :class='{ active: currentAudio === "synth" }'>
                    <div class="name">Synth</div>
                </div>

                <div class="audio item" @click="audioBackingTrack" :class='{ active: currentAudio === "backingTrack" }' v-if="enableBackingTrack">
                    <div class="name">Embedded Backing Track</div>
                </div>

                <div class="audio item" @click="audioYoutube(youtube.videoID)" v-for="youtube in youtubeList" :key="youtube.id" :class='{ active: currentAudio === "youtube-" + youtube.videoID }'>
                    <div class="name">Youtube: {{ youtube.videoID }}</div>
                </div>

                <div class="audio item" @click="audioFile(audio.filename)" v-for="audio in audioList" :key="audio.filename" :class='{ active: currentAudio === "audio-" + audio.filename }'>
                    <div class="name">{{ audio.filename }}</div>
                </div>

                <!-- No Audio -->
                <div
                    class="audio item"
                    @click='
                            currentAudio = "none";
                            closeAllList();
                        '
                    :class='{ active: currentAudio === "none" }'
                >
                    <div class="name">No Audio (Mute)</div>
                </div>

                <div class="ms-4 me-4 mt-3 mb-3" v-if="isLoggedIn">
                    <router-link :to="`/tab/${tab.id}/edit/audio`">Add Youtube or Audio File...</router-link>
                </div>
            </div>

            <!-- USE v-show, because youtube player is not vue  -->
            <div v-show='currentAudio.startsWith("youtube-") || currentAudio.startsWith("audio-")' class="player-container">
                <!-- Simple sync edit -->
                <div class="sync-offset ps-3 pe-3 p-2" v-if='syncMethod === "simple" && isLoggedIn'>
                    Sync Offset: <input type="number" class="form-control" min="-100000" max="100000" step="0.1" v-model="simpleSyncSecond" /> s
                </div>
                
                <!-- Youtube Player -->
                <div v-show='currentAudio.startsWith("youtube-")'>
                    <div ref="youtube" class="player"></div>
                </div>
               
                
                <!-- Audio Player -->
                <audio ref="audioPlayer" class="player" controls v-show='currentAudio.startsWith("audio-")' hidden></audio>
              
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

$toolbar-height: 60px;
$youtube-height: 200px;

// Light Score

.main {
    width: 95%;
    color: #d6d6d6;
    margin: 0 auto $toolbar-height auto;

    &.light {
        background-color: #f1f1f1;
        padding-top: 30px;

        h1, h2 {
            color: #333;
        }
    }
}

.yt-margin {
    width: 1px;
    height: $youtube-height !important;
}

.toolbar {
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #3c3b40;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    z-index: 1;

    .light & {
        background-color: rgba(33, 37, 41, 0.8);
    }
    
    // Allow horizontal scroll
    .scroll {
        padding: 8px 15px;
        display: flex;
        align-items: center;
        flex-grow: 4;
        column-gap: 10px;
        
        .btn-edit {
            flex-grow: 1;
            text-align: right;
        }

        .button, .btn {
            height: 44px;
            white-space: nowrap;
        }

        .btn-secondary {
            &.active {
                //background-color: lighten($primary, 10%);
            }
        }

        .close {
            cursor: pointer;
            &:hover {
                color: white;
            }
        }
    }

    .player-container {
        position: absolute;
        bottom: 100%;
        right: 0;
        display: flex;

        // align bottom
        align-items: flex-end;

        white-space: nowrap;

        .player {
            height: 180px;
        }

        .sync-offset {
            color: white;
            display: flex;
            align-items: center;
            background-color: $dark1;

            input {
                margin: 0 5px;
                background-color: #32393e;
                border: 1px solid #555b60;
                color: white;
            }
        }
    }
}

.youtube {
    margin-top: 20px;
}

h1 {
    text-align: center;
    font-size: 45px;
    font-weight: 300;
    line-height: 45px;
    word-break: break-word;
}

h2 {
    text-align: center;
    margin-bottom: 0;
}

$color: #32393e;
$padding: 20px;

.selector {
    .button {
        cursor: pointer;
        padding: 10px 15px;
        border-radius: 3px;
        background-color: $color;
        user-select: none;
        transition: background-color 0.2s;
        white-space: nowrap;

        &:hover {
            background-color: lighten($color, 10%);
        }
    }
}

.list {
    position: absolute;
    background-color: $color;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(10px);
    border-radius: 3px;
    bottom: $toolbar-height;
    left: 15px;
    width: 400px;
    overflow: scroll;
    max-height: calc(100vh - 90px);

    // TODO: No matter how big it is, the tab cursor (z-index: 1000) is always on top of it for unknown reason.
    z-index: 1;

    .list-header {
        position: sticky;
        top: 0;
        background-color: $color;
        border-bottom: 1px solid darken($color, 5%);
    }

    .item {
        cursor: pointer;
        display: flex;
        align-items: center;
        border-bottom: 1px solid darken($color, 5%);

        &.active {
            background-color: lighten($color, 8%);
        }

        .name {
            flex-grow: 1;
            font-weight: bold;
            padding: $padding;
            height: 100%;
            border-right: 1px solid darken($color, 5%);

            &:hover {
                background-color: lighten($color, 2%);
            }
        }
    }
}

.track-list {
    .track {
        .list-button {
            background-color: lighten($color, 10%);
            border-right: 1px solid darken($color, 5%);
            padding: $padding;
            height: 100%;

            &:hover {
                background-color: lighten($primary, 5%);
            }

            &.active {
                background-color: lighten($primary, 8%);
            }
        }
    }
}

.audio-selector {
    position: relative;
}

.track-selector {
    position: relative;
}

.speed {
    display: flex;
    align-items: center;

    input {
        border: 0;
    }
}

.mobile {
    h1 {
        font-size: 20px;
    }
    
    h2 {
        font-size: 16px;
    }
    
    .list {
        width: 100%;
        left: 0;
    }
    
    .toolbar {
        .scroll {
            overflow-x: scroll;
        }
        
        .player-container {
            .sync-offset {
                display: none;
            }
        }
    }
    
    .speed {
        input {
            width: 100px;
        }
    }
}
</style>
