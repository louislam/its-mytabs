<script>
import * as alphaTab from "@coderline/alphatab";
import { ScrollMode, StaveProfile } from "@coderline/alphatab";
import {baseURL, checkFetch, connectSocketIO, getInstrumentName} from "../app.js";
import { defineComponent } from "vue";
import { BDropdown, BDropdownDivider, BDropdownItem } from "bootstrap-vue-next";
import { notify } from "@kyvg/vue3-notification";
import {FontAwesomeIcon} from "@fortawesome/vue-fontawesome";

export default defineComponent({
    components: {FontAwesomeIcon, BDropdownDivider, BDropdownItem, BDropdown },
    data() {
        return {
            title: "",
            artist: "",
            /**
             * @type {alphaTab.AlphaTabApi}
             */
            api: null,
            /**
             * @type {SocketIOClient.Socket}
             */
            socket: null,
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
            ready: false,
            selectedTrack: 0,
            soloTrackID: -1,
            muteTrackList: {},
            currentAudio: "synth",
            youtubeList: [],
            youtubePlayer: null,
            alphaTabYoutubeHandler: null,
            keyEvents: (e) => {
                if (e.code === "Space") {
                    e.preventDefault();
                    this.playPause();
                }
            },
        };
    },
    computed: {

    },
    
    // Mounted
    async mounted() {
        this.tabID = this.$route.params.id;

        try {
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
            
            await checkFetch(res);

            const data = await res.json();
            if (data.tab) {
                this.tab = data.tab;
                this.youtubeList = data.youtubeList;
            }

            const tempToken = await this.getTempToken();
            await this.initContainer(tempToken, trackID);
            
            this.setConfig("trackID", trackID);
        },
        
        countIn() {
            if (!this.api) {
                return
            }

            this.enableCountIn = !this.enableCountIn
            
            if (this.enableCountIn) {
                this.api.countInVolume = 1;
            } else {
                this.api.countInVolume = 0;
            }
        },
        
        metronome() {
            if (!this.api) {
                return
            }
            this.enableMetronome = !this.enableMetronome;
            
            if (this.enableMetronome) {
                this.api.metronomeVolume = 1;
            } else {
                this.api.metronomeVolume = 0;
            }
        },

        loop() {
            if (!this.api) {
                return
            }
            this.isLooping = !this.isLooping;
            this.api.isLooping = this.isLooping;
        },
        
        playPause() {
            if (!this.api || !this.ready) {
                return
            }

            this.api.settings.player.scrollMode = ScrollMode.Continuous;
            this.api.updateSettings();

            this.playing = !this.playing;
            
            if (this.playing) {
                this.api.play();
            } else  {
                this.api.pause();
            }
            
        },
        
        pause() {
            if (!this.api || !this.ready) {
                return
            }
            this.playing = false;
            this.api.pause();
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

        initContainer(tempToken, trackID) {
            return new Promise((resolve, reject) => {
                if (this.api) {
                    this.destroyContainer();
                }

                if (!(this.$refs.bassTabContainer instanceof HTMLElement)) {
                    reject(new Error("Container element not found"));
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
                        tracks: [trackID],
                        fontDirectory: "/font/",
                        engine: "html5",
                    },
                    player: {
                        enablePlayer: true,
                        enableCursor: true,
                        enableAnimatedBeatCursor: false,
                        enableUserInteraction: true,
                        soundFont: "/soundfont/sonivox.sf2",
                        //nativeBrowserSmoothScroll: true,
                        scrollMode: ScrollMode.Off,
                        scrollOffsetY: -50,
                        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
                    },
                    display: {
                        staveProfile: StaveProfile.Tab,
                        resources: {
                            staffLineColor: "#6D6D6D",
                            barSeparatorColor: "#6D6D6D",
                            mainGlyphColor: "#A4A4A4",
                            secondaryGlyphColor: "#A4A4A4",
                            scoreInfoColor: "#A4A4A4",
                            barNumberColor: "#6D6D6D",
                            tablatureFont: "bold 14px Arial",
                        },
                    },
                });

                // Score Loaded
                this.api.scoreLoaded.on(async (score) => {
                    this.applyColors(score);


                    // Set Audio source
                    this.currentAudio = this.getConfig("audio", "synth");
                    if (this.currentAudio === "synth") {
                        await this.initSynth();
                    } else if (this.currentAudio === "backingTrack") {
                        await this.initBackingTrack();
                    } else if (this.currentAudio.startsWith("youtube-")) {
                        const videoID = this.currentAudio.substring(8);
                        await this.initYoutube(videoID);
                    } else {
                        // Unknown audio source, fallback to synth
                        await this.initSynth();
                    }
                    
                    
                    this.tracks = [];
              
                    // List all tracks
                    score.tracks.forEach((track) => {
                        this.tracks.push({
                            id: track.index,
                            name: getInstrumentName(track.playbackInfo.program),
                            program: track.playbackInfo.program,
                        });
                    });
                    
                    this.enableBackingTrack = this.hasBackingTrack();
                    this.selectedTrack = trackID;
                    this.ready = true;
                    
                    resolve();
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
            this.ready = false;
            this.playing = false;
            this.soloTrackID = -1;
            this.muteTrackList = {};
            
        },
        
        simpleSync(offset) {
            // Apply sync points
            const syncPoints = [
                { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": offset },
            ];
            this.api.score.applyFlatSyncPoints(syncPoints);
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

                                for (const note of beat.notes) {
                                    note.style = new alphaTab.model.NoteStyle();
                                    note.style.colors.set(alphaTab.model.NoteSubElement.StandardNotationNoteHead, stringColors[note.string]);
                                    note.style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, stringColors[note.string]);
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
        
        async initYoutube(videoID) {
            this.closeAllList();
            
            if (!this.youtubePlayer) {
                await this.initYoutubePlayer(videoID);
            }
            
            // Get offset from youtubeList
            let offset = 0;
            for (const yt of this.youtubeList) {
                if (yt.videoID === videoID) {
                    offset = yt.simpleSync;
                    break;
                }
            }

            // Bug? If change to EnabledExternalMedia, andthis.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();
            this.simpleSync(offset);
            
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();
            
            this.api.player.output.handler = this.alphaTabYoutubeHandler;
            
            this.youtubePlayer.cueVideoById(videoID);

            this.currentAudio = "youtube-" + videoID;
            this.setConfig("audio", this.currentAudio);
            this.pause();
        },

        async initYoutubePlayer(videoID) {
            
            const ytWarning = setTimeout(() => {
                notify({
                    type: "warning",
                    title: "Warning",
                    text: "If YouTube is taking too long to load, please refresh the page.",
                });
            }, 5000);
            
            this.$refs.youtube.innerHTML = "";
            
            const isScriptLoaded = typeof YT !=="undefined";
            console.log("isScriptLoaded:", isScriptLoaded);

            // Create playerElement inside this.$refs.youtube
            const playerElement = document.createElement("div");
            this.$refs.youtube.appendChild(playerElement);
            
           if (!isScriptLoaded) {
               const tag = document.createElement("script");
               tag.src = "https://www.youtube.com/player_api";
               const firstScriptTag = document.getElementsByTagName('script')[0];
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
                                this.api?.play();
                                break;
                            case YT.PlayerState.ENDED:
                                window.clearInterval(currentTimeInterval);
                                this.api?.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                window.clearInterval(currentTimeInterval);
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
                    player.pauseVideo();
                },
            };
            
            this.youtubePlayer = player;
            this.alphaTabYoutubeHandler = alphaTabYoutubeHandler;
            clearTimeout(ytWarning);
        },

        async initSynth() {
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();
            this.currentAudio = "synth";
            this.setConfig("audio", this.currentAudio);
            this.pause();
            this.closeAllList();
        },
        
        async initBackingTrack() {
            if (!this.hasBackingTrack()) {
                notify({
                    type: "error",
                    title: "Error",
                    text: "No backing track found in this tab.",
                });
                return;
            }
            
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack;
            this.api.updateSettings();
            this.currentAudio = "backingTrack";
            this.setConfig("audio", this.currentAudio);
            this.pause();
            this.closeAllList();
        },

        /**
         * TODO
         */
        async initMPC() {
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
                this.api.score.tracks[trackID]
            ], mute);
        },

        edit() {
            this.$router.push(`/tab/${this.tabID}/edit/info`);
        },
        
        hasBackingTrack() {
            return !!this.api.score.backingTrack
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

    },
});
</script>

<template>
    <div class="main">
        <h1>{{ tab.title }}</h1>
        <h2>{{ tab.artist }}</h2>
        <div ref="bassTabContainer" v-pre></div>
        
        <div :class="{'yt-margin': currentAudio.startsWith(`youtube-`)}">
            
        </div>

        <div class="toolbar">
            <div class="track-selector selector">
                <div class="button" @click="showList('track')">
                    <span v-if="tracks.length > 0">{{ tracks[selectedTrack].name }}</span>
                    <span v-else>Loading...</span>
                </div>

                <div class="track-list list" v-if="showTrackList">
                    <div class="p-2 text-end">
                        <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showTrackList = false" />
                    </div>
                    
                    <div class="track item" v-for="track in tracks" :key="track.id" :class="{ active: selectedTrack === track.id }">
                        <div class="name" @click="changeTrack(track.id)">{{ track.name }}</div>
                        <div class="list-button solo" @click="toggleSolo(track.id)" :class="{ active: soloTrackID === track.id}">Solo</div>
                        <div class="list-button mute" @click="toggleMute(track.id)"  :class="{ active: muteTrackList[track.id]}">Mute</div>
                    </div>
                </div>
            </div>

            <div class="audio-selector selector">
                <div class="button" @click="showList('audio')">
                    Audio
                </div>

                <div class="audio-list list" v-if="showAudioList">
                    <div class="p-2 text-end">
                        <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showAudioList = false" />
                    </div>
                    
                    <div class="audio item" @click="initSynth" :class="{ active: currentAudio === 'synth' }">
                        <div class="name">Synth</div>
                    </div>

                    <div class="audio item" @click="initBackingTrack" :class="{ active: currentAudio === 'backingTrack' }" v-if="enableBackingTrack">
                        <div class="name">Embedded Backing Track</div>
                    </div>

                    <div class="audio item" @click="initYoutube(youtube.videoID)" v-for="youtube in youtubeList" :key="youtube.id" :class="{ active: currentAudio === 'youtube-' + youtube.videoID }">
                        <div class="name">Youtube: {{ youtube.videoID }}</div>
                    </div>
    
                    <div class="ms-4 me-4 mt-3 mb-3">
                        <router-link :to="`/tab/${tab.id}/edit/audio`">Add Youtube or Audio File...</router-link>
                    </div>
                    
                </div>
            </div>

            <button class="btn btn-primary" @click="playPause" :class="{active: playing }">
                <span v-if="!playing">
                    <font-awesome-icon :icon='["fas", "play"]' />
                    Play
                </span>
                <span v-else>
                    <font-awesome-icon :icon='["fas", "pause"]' />
                    Pause
                </span>
            </button>
            <button class="btn btn-secondary" @click="loop()" :class="{active: isLooping }">
                <font-awesome-icon :icon='["fas", "check"]' v-if="isLooping" />
                Loop
            </button>
            <button class="btn btn-secondary" @click="countIn()" :class="{active: enableCountIn }">
                <font-awesome-icon :icon='["fas", "check"]' v-if="enableCountIn" />
                Count in
            </button>
            <button class="btn btn-secondary" @click="metronome()"  :class="{active: enableMetronome }">
                <font-awesome-icon :icon='["fas", "check"]' v-if="enableMetronome" />
                Metronome
            </button>

            <div class="speed">
                    Speed: <input type="number"  min="10" max="200" step="1" /> (%)
            </div>

            <div class="btn-edit">
                <button class="btn btn-secondary" @click="edit()">
                    Edit
                </button>
            </div>

            <div ref="youtube" v-show="currentAudio.startsWith('youtube-')" class="youtube-player-container"></div>
        </div>


    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

$toolbar-height: 75px;
$youtube-height: 200px;

.main {
    width: 95%;
    color: #d6d6d6;
    margin: 0 auto $toolbar-height auto;
}

.yt-margin {
    width: 1px;
    height: $youtube-height !important;
}

.toolbar {
    height: $toolbar-height;
    padding: 20px 15px;
    display: flex;
    align-items: center;
    flex-grow: 4;
    column-gap: 10px;
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #3c3b40;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    z-index: 1;
    
    .btn-edit {
        flex-grow: 1;
        text-align: right;
    }
    
    .button, .btn {
        height: 44px;
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
    
    .youtube-player-container {
        position: absolute;
        bottom: 100%;
        right: 0;
        height: 180px;
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
    
    .list {
        position: absolute;
        background-color: $color;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(10px);
        border-radius: 3px;
        bottom: 130%;
        width: 400px;
        overflow: hidden;
        
        // TODO: No matter how big it is, the tab cursor (z-index: 1000) is always on top of it for unknown reason.
        z-index: 1;
        
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
}

.audio-selector {
    position: relative;
}

.track-selector {
    position: relative;
    
    .track-list {
        .track {
    
            .name {
 
            }

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
}
</style>
