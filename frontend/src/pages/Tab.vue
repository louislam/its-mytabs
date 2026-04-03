<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { BDropdown, BDropdownDivider, BDropdownItem } from "bootstrap-vue-next";
import { notify } from "@kyvg/vue3-notification";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { isLoggedIn as checkIsLoggedIn } from "../auth-client.js";
import { getSetting, connectSocketIO } from "../app.js";

import { useAlphaTab } from "../composables/useAlphaTab.ts";
import { usePlaybackControl } from "../composables/usePlaybackControl.ts";
import { useScrollBehavior } from "../composables/useScrollBehavior.ts";
import { useCursorMode } from "../composables/useCursorMode.ts";
import { useAudioSync } from "../composables/useAudioSync.ts";
import { useKeyboardShortcuts } from "../composables/useKeyboardShortcuts.ts";
import { useTrackSelection } from "../composables/useTrackSelection.ts";
import { useWakeLock } from "../composables/useWakeLock.ts";
import PlaybackControls from "../components/PlaybackControls.vue";

const emit = defineEmits(["setFixedHeader"]);

const route = useRoute();
const router = useRouter();

// Template refs
const bassTabContainer = ref(null);
const trackSelector = ref(null);
const trackList = ref(null);
const audioSelector = ref(null);
const audioListRef = ref(null);
const youtubeRef = ref(null);
const audioPlayer = ref(null);

// Local state
const isLoggedIn = ref(false);
const setting = ref({});
const toolbarAutoHide = ref(false);
const enableBackingTrack = ref(true);

// Config helpers (stay in Tab.vue - they use tabID)
function setConfig(key, value) {
    localStorage.setItem(`tab-${alphaTabState.tabID.value}-${key}`, JSON.stringify(value));
}

function getConfig(key, defaultValue) {
    const value = localStorage.getItem(`tab-${alphaTabState.tabID.value}-${key}`);
    if (value === null) {
        return defaultValue;
    }
    return JSON.parse(value);
}

// --- Composables ---

const { animatedCursor, applyCursorVisibility } = useCursorMode(setting);

const alphaTabState = useAlphaTab(
    setting,
    animatedCursor,
    getConfig,
    (val) => emit("setFixedHeader", val),
);

const {
    api, score, tracks, ready, tab, tabID, youtubeList, audioList,
    keySignature, playbackRange, load, destroyContainer,
    simpleSync, advancedSync, overrideHiddenStaves, onScoreLoaded, onPlayerFinished,
    ScrollMode, StaveProfile,
} = alphaTabState;

const scrollMode = ref(ScrollMode.Continuous);

const { applyScrollMode } = useScrollBehavior(scrollMode, api);

const wakeLock = useWakeLock();

function closeAllList() {
    trackSelection.showTrackList.value = false;
    audioSync.showAudioList.value = false;
}

function showList(type) {
    if (type === "track") {
        trackSelection.showTrackList.value = !trackSelection.showTrackList.value;
        audioSync.showAudioList.value = false;
    } else if (type === "audio") {
        audioSync.showAudioList.value = !audioSync.showAudioList.value;
        trackSelection.showTrackList.value = false;
    }
}

const trackSelection = useTrackSelection(
    api,
    async (trackID) => {
        await loadTab(trackID);
    },
    setConfig,
    closeAllList,
);

const {
    selectedTrack, soloTrackID, muteTrackList, showTrackList,
    isDrum, hasBackingTrack, changeTrack, toggleSolo, toggleMute, toggleVolume,
} = trackSelection;

const playback = usePlaybackControl(
    api,
    ready,
    selectedTrack,
    setConfig,
    (isPlaying) => {
        // Apply scroll mode when playing starts
        if (isPlaying) {
            applyScrollMode();
            wakeLock.acquire();
        } else {
            wakeLock.release();
        }

        // Apply cursor visibility
        applyCursorVisibility(isPlaying);
    },
);

const {
    playing, enableCountIn, enableMetronome, isLooping, speed,
    playPause, play, pause, countIn, metronome, loop,
    playFromHighlightedRange, playFromFirstBarContainingNotes, moveToBar,
} = playback;

const audioSync = useAudioSync(
    api,
    tabID,
    youtubeList,
    audioList,
    simpleSync,
    advancedSync,
    pause,
    play,
    playing,
    isLooping,
    closeAllList,
    setConfig,
);

const {
    currentAudio, youtube, audio, simpleSyncSecond, showAudioList,
    syncMethod, audioYoutube, audioFile, audioSynth, audioBackingTrack,
    setYoutubeRef, setAudioPlayerRef,
} = audioSync;

useKeyboardShortcuts({
    playPause,
    moveToBar,
    playFromHighlightedRange,
    playFromFirstBarContainingNotes,
});

// Wire up score loaded callback
onScoreLoaded((trackID) => {
    // Set Audio source
    currentAudio.value = getConfig("audio", "synth");

    // Metronome
    enableMetronome.value = getConfig("enableMetronome", false);

    // Count in
    enableCountIn.value = getConfig("enableCountIn", false);

    // Looping
    isLooping.value = getConfig("isLooping", false);

    // Speed
    speed.value = 100;
    speed.value = getConfig("speed", 100);

    // Scroll Mode
    if (setting.value.scoreStyle === "horizontal-tab") {
        scrollMode.value = ScrollMode.Smooth;
    } else {
        scrollMode.value = setting.value.scrollMode;
    }

    selectedTrack.value = trackID;

    // Force score+tab if the current track program = 0 (probably drums)
    if (isDrum()) {
        api.value.settings.display.staveProfile = StaveProfile.ScoreTab;
        api.value.updateSettings();
    } else {
        // This will break drum score
        overrideHiddenStaves(score.value);
    }

    enableBackingTrack.value = hasBackingTrack();
});

onPlayerFinished(() => {
    if (!isLooping.value) {
        playing.value = false;
    }
});

// Socket
let socket = null;

async function initSocketIO() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    socket = connectSocketIO();

    socket.on("connect", () => {
        console.log("Connected to server");
    });

    socket.on("disconnect", () => {
        console.log("Disconnected from server");
    });

    socket.on("play", () => {
        play();
    });

    socket.on("pause", () => {
        pause();
    });

    socket.on("seek", (time) => {
        if (!api.value) {
            return;
        }
        const diff = Math.abs(api.value.timePosition - time);
        console.log(api.value.timePosition, time, diff);
        if (diff < 100) {
            return;
        }
        api.value.timePosition = time;
    });

    socket.on("no-audio", () => {
        currentAudio.value = "none";
    });
}

function edit() {
    router.push(`/tab/${tabID.value}/edit/info`);
}

function resetAllState() {
    playing.value = false;
    currentAudio.value = "synth";
    enableMetronome.value = false;
    enableCountIn.value = false;
    isLooping.value = false;
    speed.value = 100;
    scrollMode.value = ScrollMode.Continuous;
    soloTrackID.value = -1;
    youtube.value = {};
    simpleSyncSecond.value = -1;
    muteTrackList.value = {};
}

function fullDestroy() {
    destroyContainer();
    resetAllState();
}

async function loadTab(trackID) {
    if (api.value) {
        fullDestroy();
    }
    return await load(trackID, bassTabContainer.value, router);
}

let _onDocumentClick = undefined;

onMounted(async () => {
    isLoggedIn.value = await checkIsLoggedIn();
    setting.value = getSetting();
    toolbarAutoHide.value = setting.value.toolbarAutoHide;
    tabID.value = route.params.id;

    // Set refs for audio sync
    setYoutubeRef(youtubeRef.value);
    setAudioPlayerRef(audioPlayer.value);

    const urlParams = new URLSearchParams(window.location.search);

    try {
        // Override trackID if provided in URL
        const trackParam = urlParams.get("track");
        if (trackParam) {
            const id = parseInt(trackParam);
            if (!isNaN(id)) {
                setConfig("trackID", id);
            }
        }

        // Override audio source if provided in URL
        const audioParam = urlParams.get("audio");
        if (audioParam) {
            setConfig("audio", audioParam);
        }

        const trackID = getConfig("trackID", 0);

        // Load the AlphaTab
        await loadTab(trackID);

        // Close open lists when clicking outside
        _onDocumentClick = (e) => {
            try {
                if (showTrackList.value) {
                    const sel = trackSelector.value;
                    const list = trackList.value;
                    if (!sel.contains(e.target) && !list.contains(e.target)) {
                        showTrackList.value = false;
                    }
                }

                if (showAudioList.value) {
                    const sel = audioSelector.value;
                    const list = audioListRef.value;
                    if (!sel.contains(e.target) && !list.contains(e.target)) {
                        showAudioList.value = false;
                    }
                }
            } catch (err) {
                console.error(err);
            }
        };
        window.addEventListener("click", _onDocumentClick);
    } catch (e) {
        notify({
            type: "error",
            title: "Error",
            text: e.message,
        });
    }

    await initSocketIO();

    console.log("Mounted");
});

onBeforeUnmount(() => {
    console.log("Before unmount");
    fullDestroy();

    if (_onDocumentClick) {
        window.removeEventListener("click", _onDocumentClick);
        _onDocumentClick = undefined;
    }

    if (socket) {
        socket.disconnect();
    }
});
</script>

<template>
    <div class="main" :class='{ "light": setting.scoreColor === "light" }'>
        <h1>{{ tab.title }}</h1>
        <h2>{{ tab.artist }}</h2>
        <div class="key-signature badge bg-secondary" v-if="keySignature && setting.showKeySignature">
            {{ keySignature }}
        </div>
        <div ref="bassTabContainer" v-pre></div>

        <!-- Just add a margin, don't let youtube player overlay the tab -->
        <div :class='{ "yt-margin": currentAudio.startsWith(`youtube-`) }'></div>

        <div class="toolbar" :class='{ "auto-hide": setting.toolbarAutoHide }'>
            <div class="scroll">
                <div class="track-selector selector" ref="trackSelector">
                    <div class="button" @click='showList("track")'>
                        <span v-if="tracks.length > 0">{{ tracks[selectedTrack].name }}</span>
                        <span v-else>Loading...</span>
                    </div>
                </div>

                <div class="audio-selector selector" ref="audioSelector">
                    <div class="button" @click='showList("audio")'>
                        Audio
                    </div>
                </div>

                <PlaybackControls
                    :playing="playing"
                    :isLooping="isLooping"
                    :enableCountIn="enableCountIn"
                    :enableMetronome="enableMetronome"
                    v-model:speed="speed"
                    :playbackRange="playbackRange"
                    :currentAudio="currentAudio"
                    @play-pause="playPause"
                    @play-from-highlighted="playFromHighlightedRange()"
                    @toggle-loop="loop()"
                    @toggle-count-in="countIn()"
                    @toggle-metronome="metronome()"
                />

                <div class="btn-edit" v-if="isLoggedIn">
                    <button class="btn btn-secondary" @click="edit()">
                        Edit
                    </button>
                </div>
            </div>

            <div class="track-list list" v-if="showTrackList" ref="trackList">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showTrackList = false" />
                </div>

                <div class="track item" v-for="track in tracks" :key="track.id" :class="{ active: selectedTrack === track.id }">
                    <div class="name" @click="changeTrack(track.id)">{{ track.name }}</div>
                    <div class="list-button solo" @click="toggleSolo(track.id)" :class="{ active: soloTrackID === track.id }">Solo</div>
                    <div class="list-button mute" @click="toggleMute(track.id)" :class="{ active: muteTrackList[track.id] }">Mute</div>
                    <div class="list-button select-percentage">
                        Volume: <input type="number" min="0" max="1000" step="1" value="100" @change="toggleVolume(track.id, $event.target.value)" /> (%)
                    </div>
                </div>
            </div>

            <div class="audio-list list" v-if="showAudioList" ref="audioListRef">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showAudioList = false" />
                </div>

                <div class="audio item" @click="audioSynth" :class='{ active: currentAudio === "synth" }'>
                    <div class="name">Synth</div>
                </div>

                <div class="audio item" @click="audioBackingTrack(hasBackingTrack)" :class='{ active: currentAudio === "backingTrack" }' v-if="enableBackingTrack">
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
                    @click='currentAudio = "none";
                    closeAllList()'
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
                    <div ref="youtubeRef" class="player"></div>
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
    z-index: 1000;

    .light & {
        background-color: rgba(33, 37, 41, 0.8);
    }

    &.auto-hide {
        transition: transform 0.3s;
        transform: translateY(calc(100% - 5px));

        &:hover {
            transform: translateY(0);
        }
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
    min-width: 400px;
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

.select-percentage {
    display: flex;
    align-items: center;
    gap: 4px;

    input {
        min-width: 90px;
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

.key-signature {
    position: absolute;
    margin-left: 30px;
}
</style>
