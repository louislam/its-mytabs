<script>
import * as alphaTab from "@coderline/alphatab";
import { ScrollMode, StaveProfile } from "@coderline/alphatab";
import { baseURL, connectSocketIO, getInstrumentName } from "../app.js";
import { defineComponent } from "vue";
import { BDropdown, BDropdownDivider, BDropdownItem } from "bootstrap-vue-next";
import { notify } from "@kyvg/vue3-notification";

export default defineComponent({
    components: { BDropdownDivider, BDropdownItem, BDropdown },
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
            tab: {},
        };
    },
    computed: {
        selectedTrack() {
            if (this.api?.tracks && this.api.tracks.length > 0) {
                return this.api.tracks[0].index;
            } else {
                return 0;
            }
        },
    },
    async mounted() {
        this.tabID = this.$route.params.id;

        try {
            await this.load(2);
            //await this.initYoutube("VuKSlOT__9s");
            //await this.initSocketIO();
            //await this.initMPC()

            // Space key to play/pause
            window.addEventListener("keydown", (e) => {
                if (e.code === "Space") {
                    e.preventDefault();
                    this.playPause();
                }
            });
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
    },
    methods: {
        async load(trackID) {
            if (this.api) {
                this.destroyContainer();
            }
            
            const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                credentials: "include",
            });
            if (!res.ok) {
                throw new Error("Failed to load tab info");
            } else {
                const tab = (await res.json()).tab;
                if (tab) {
                    this.tab = tab;
                }
            }

            const tempToken = await this.getTempToken();
            await this.initContainer(tempToken, trackID);
        },
        
        playPause() {
            if (!this.api) return;

            this.api.settings.player.scrollMode = ScrollMode.Continuous;
            this.api.updateSettings();
            this.api.playPause();
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

                this.api.scoreLoaded.on((score) => {
                    this.applyColors(score);

                    // Apply sync points
                    const syncPoints = [
                        { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": 3000 },
                    ];
                    score.applyFlatSyncPoints(syncPoints);

                    this.tracks = [];
                    
                    // List all tracks
                    score.tracks.forEach((track) => {
                        console.log(track);
                        this.tracks.push({
                            id: track.index,
                            altName: track.name,
                            name: getInstrumentName(track.playbackInfo.program),
                        });
                    });

                    resolve();
                });
            });
        },

        destroyContainer() {
            this.api?.destroy();
            this.api = undefined;
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
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            const playerElement = this.$refs.youtube;

            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/player_api";
            playerElement.parentNode.insertBefore(tag, playerElement);

            const youtubeApiReady = Promise.withResolvers();
            window.onYouTubePlayerAPIReady = youtubeApiReady.resolve;

            await youtubeApiReady.promise;

            const youtubePlayerReady = Promise.withResolvers();
            let currentTimeInterval = 0;
            const player = new YT.Player(playerElement, {
                height: "360",
                width: "640",
                videoId: videoID,
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
                                    this.api.player.output.updatePosition(player.getCurrentTime() * 1000);
                                }, 50);
                                this.api.play();
                                break;
                            case YT.PlayerState.ENDED:
                                window.clearInterval(currentTimeInterval);
                                this.api.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                window.clearInterval(currentTimeInterval);
                                this.api.pause();
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

            this.api.player.output.handler = alphaTabYoutubeHandler;
        },

        async initSynth() {
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();
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
            this.showTrackList = false;
        },
    },
});
</script>

<template>
    <div class="main">
        <h1>{{ tab.title }}</h1>
        <h2>{{ tab.artist }}</h2>
        <div ref="bassTabContainer" v-pre></div>

        <div ref="youtube"></div>

        <div class="toolbar">
            <div class="track-selector">
                <div class="button" @click="showTrackList = !showTrackList">
                    <span v-if="tracks.length > 0">{{ tracks[selectedTrack].name }}</span>
                    <span v-else>Loading...</span>
                </div>

                <div class="track-list" v-if="showTrackList">
                    <div class="track" v-for="track in tracks" :key="track.id">
                        <div class="name" @click="changeTrack(track.id)">{{ track.name }}</div>
                        <div class="list-button solo">Solo</div>
                        <div class="list-button mute">Mute</div>
                    </div>
                </div>
            </div>

            <div>
                <b-dropdown id="dropdown-1" text="Audio Source" class="me-4">
                    <b-dropdown-item>Youtube</b-dropdown-item>
                    <b-dropdown-item>Synth</b-dropdown-item>
                    <b-dropdown-item>bass.mp3</b-dropdown-item>
                </b-dropdown>
            </div>

            <button class="btn btn-primary" @click="playPause">Play/Pause</button>
            <button class="btn btn-primary" @click="playPause">Loop</button>
            <button class="btn btn-primary" @click="playPause">Count in</button>
            <!--<button class="btn btn-primary" @click="playPause">Edit Info</button>-->
        </div>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

$toolbar-height: 75px;

.main {
    width: 95%;
    color: #d6d6d6;
    margin: 0 auto $toolbar-height auto;
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
    z-index: 10000;
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

.track-selector {
    position: relative;
    $color: #32393e;

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

    .track-list {
        position: absolute;
        background-color: $color;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(10px);
        border-radius: 3px;
        bottom: 130%;
        width: 400px;

        .track {
            cursor: pointer;
            display: flex;
            align-items: center;

            $padding: 20px;
            border-bottom: 1px solid darken($color, 5%);

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

            .list-button {
                background-color: lighten($color, 10%);
                border-right: 1px solid darken($color, 5%);
                padding: $padding;
                height: 100%;

                &:hover {
                    background-color: lighten($primary, 5%);
                }

                &.active {
                    border-right-color: darken($color, 5%);
                }
            }
        }
    }
}
</style>
