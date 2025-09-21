<script>
import * as alphaTab from "@coderline/alphatab";
import { ScrollMode, StaveProfile } from "@coderline/alphatab";
import {connectSocketIO} from "../app.js";
import {defineComponent} from "vue";
import {BDropdown, BDropdownDivider, BDropdownItem} from "bootstrap-vue-next";

/**
 * @type {alphaTab.AlphaTabApi}
 */
let api;

export default defineComponent({
    components: {BDropdownDivider, BDropdownItem, BDropdown},
    data() {
        return {
            title: "",
            artist: "",
        };
    },
    async mounted() {
        connectSocketIO();
        
        await this.initContainer();
        await this.initYoutube("VuKSlOT__9s");

        // Space key to play/pause
        window.addEventListener("keydown", (e) => {
            if (e.code === "Space") {
                e.preventDefault();
                this.playPause();
            }
        });
        console.log("Mounted");
    },
    beforeUnmount() {
        console.log("Before unmount");
        this.destroyContainer();
    },
    methods: {
        playPause() {
            api.settings.player.scrollMode = ScrollMode.Continuous; 
            api.updateSettings(); 
            api?.playPause();
        },

        initContainer() {
            return new Promise((resolve, reject) => {
                if (api) {
                    this.destroyContainer();
                }

                if (!(this.$refs.bassTabContainer instanceof HTMLElement)) {
                    reject(new Error("Container element not found"));
                }

                api = new alphaTab.AlphaTabApi(this.$refs.bassTabContainer, {
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
                        file: "/tabs/test.gp",
                        tracks: [2],
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

                api.scoreLoaded.on((score) => {
                    this.applyColors(score);

                    this.title = api.score.title;
                    this.artist = api.score.artist;

                    // Apply sync points
                    const syncPoints = [
                        { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": 3000 },
                    ];
                    score.applyFlatSyncPoints(syncPoints);
                    resolve();
                });
            });
        },
        
        destroyContainer() {
            api?.destroy();
            api = undefined;
        },

        // Style the score with custom colors
        applyColors(score) {
            const stringColors = {
                1: alphaTab.model.Color.fromJson("#bf3732"),
                2: alphaTab.model.Color.fromJson("#fff800"),
                3: alphaTab.model.Color.fromJson("#0080ff"),
                4: alphaTab.model.Color.fromJson("#e07b39"),
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

        async initYoutube(videoID) {
            api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            api.updateSettings();

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
                                    api.player.output.updatePosition(player.getCurrentTime() * 1000);
                                }, 50);
                                api.play();
                                break;
                            case YT.PlayerState.ENDED:
                                window.clearInterval(currentTimeInterval);
                                api.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                window.clearInterval(currentTimeInterval);
                                api.pause();
                                break;
                            default:
                                break;
                        }
                    },
                    "onPlaybackRateChange": (e) => {
                        api.playbackSpeed = e.data;
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

            api.player.output.handler = alphaTabYoutubeHandler;
        },
    },
});

if (import.meta.hot) {
    import.meta.hot.on("vite:afterUpdate", () => {
        console.log("Hot update - reloading page to reset AlphaTab");
        
        // tab page only
        const isTabPage = window.location.pathname.startsWith("/tab/");
        if (isTabPage) {
            window.location.reload();
        }
    });
}
</script>

<template>
    <div class="main">
        <h1>{{ title }}</h1>
        <h2>{{ artist }}</h2>
        <div ref="bassTabContainer" v-pre></div>


        <div ref="youtube"></div>
        
        <div class="toolbar">

            <div>
                <b-dropdown id="dropdown-1" text="Instruments">
                    <b-dropdown-item>
                        Bass <button>Test</button>
                    </b-dropdown-item>
                    <b-dropdown-item>Second Action</b-dropdown-item>
                    <b-dropdown-item>Third Action</b-dropdown-item>
                    <b-dropdown-divider></b-dropdown-divider>
                    <b-dropdown-item active>Active action</b-dropdown-item>
                    <b-dropdown-item disabled>Disabled action</b-dropdown-item>
                </b-dropdown>
            </div>

            <div>
                <b-dropdown id="dropdown-1" text="Music" class="me-4">
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
$toolbar-height: 75px;

.main {
    width: 95%;
    color: #d6d6d6;
    margin: 0 auto $toolbar-height auto;
}

.toolbar {
    height: $toolbar-height;
    padding: 20px 30px;
    display: flex;
    align-items: center;
    flex-grow: 4;
    column-gap: 10px;
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #3C3B40;
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
</style>
