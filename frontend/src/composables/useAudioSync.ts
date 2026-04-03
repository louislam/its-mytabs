import { ref, watch, computed, type Ref } from "vue";
import { ActionBuffer, baseURL, checkFetch, generalError } from "../app.js";
import { notify } from "@kyvg/vue3-notification";

const alphaTab = await import("@coderline/alphatab");

const syncOffsetYoutubeActionBuffer = new ActionBuffer(200);
const syncOffsetAudioActionBuffer = new ActionBuffer(200);

export function useAudioSync(
    api: Ref<any>,
    tabID: Ref<number | string>,
    youtubeList: Ref<any[]>,
    audioList: Ref<any[]>,
    simpleSync: (offset: number) => void,
    advancedSync: (syncPointsText: string) => void,
    pause: () => void,
    play: () => void,
    playing: Ref<boolean>,
    isLooping: Ref<boolean>,
    closeAllList: () => void,
    setConfig: (key: string, value: any) => void,
) {
    const currentAudio = ref("synth");
    const youtube = ref<Record<string, any>>({});
    const audio = ref<Record<string, any>>({});
    const simpleSyncSecond = ref(-1);
    const showAudioList = ref(false);

    let audioHandler: any = null;
    let alphaTabYoutubeHandler: any = null;
    let youtubePlayer: any = null;

    const syncMethod = computed(() => {
        if (currentAudio.value.startsWith("youtube-")) {
            return youtube.value.syncMethod;
        } else if (currentAudio.value.startsWith("audio-")) {
            return audio.value.syncMethod;
        } else {
            return undefined;
        }
    });

    watch(simpleSyncSecond, (newVal, oldVal) => {
        if (!api.value) {
            return;
        }

        let obj: any;

        if (currentAudio.value.startsWith("youtube-")) {
            if (!youtube.value) {
                return;
            }
            obj = youtube.value;
        } else if (currentAudio.value.startsWith("audio-")) {
            if (!audio.value) {
                return;
            }
            obj = audio.value;
        }

        pause();

        obj.simpleSync = simpleSyncSecond.value * 1000;

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
        api.value.updateSettings();

        simpleSync(obj.simpleSync);

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
        api.value.updateSettings();

        if (currentAudio.value.startsWith("youtube-")) {
            api.value.player.output.handler = alphaTabYoutubeHandler;
            syncOffsetYoutubeActionBuffer.run(() => {
                if (oldVal !== -1) {
                    saveYoutube();
                }
            });
        } else {
            api.value.player.output.handler = audioHandler;
            syncOffsetAudioActionBuffer.run(() => {
                if (oldVal !== -1) {
                    saveAudio();
                }
            });
        }
    });

    watch(() => youtube.value.simpleSync, () => {
        if (!api.value || !youtube.value) {
            return;
        }
        simpleSyncSecond.value = parseFloat((youtube.value.simpleSync / 1000).toFixed(2));
    });

    watch(() => audio.value.simpleSync, () => {
        if (!api.value || !audio.value) {
            return;
        }
        simpleSyncSecond.value = parseFloat((audio.value.simpleSync / 1000).toFixed(2));
    });

    // Switch Audio Source
    watch(currentAudio, async () => {
        console.log("Switching audio to:", currentAudio.value);

        if (!api.value) {
            return;
        }

        api.value.player.masterVolume = 1;

        if (currentAudio.value === "synth") {
            await initSynth();
        } else if (currentAudio.value === "backingTrack") {
            api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack;
            api.value.updateSettings();
            pause();
        } else if (currentAudio.value.startsWith("youtube-")) {
            const videoID = currentAudio.value.substring(8);
            await initYoutube(videoID);
        } else if (currentAudio.value.startsWith("audio-")) {
            const filename = currentAudio.value.substring(6);
            await initAudio(filename);
        } else if (currentAudio.value === "none") {
            api.value.player.masterVolume = 0;
            pause();
        } else {
            await initSynth();
            notify({
                type: "error",
                title: "Error",
                text: "Unknown audio source, fallback to synth.",
            });
            return;
        }

        setConfig("audio", currentAudio.value);
    });

    async function initSynth() {
        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
        api.value.updateSettings();
        pause();
    }

    async function initAudio(filename: string) {
        if (!api.value) {
            return;
        }

        closeAllList();

        // audioPlayerRef is set once via setAudioPlayerRef
        const audioPlayer = _audioPlayerRef;
        if (!audioPlayer) {
            return;
        }

        // Init the audio handler if not exists
        if (!audioHandler) {
            audioHandler = {
                get backingTrackDuration() {
                    const duration = audioPlayer.duration;
                    return Number.isFinite(duration) ? duration * 1000 : 0;
                },
                get playbackRate() {
                    return audioPlayer.playbackRate;
                },
                set playbackRate(value: number) {
                    audioPlayer.playbackRate = value;
                },
                get masterVolume() {
                    return audioPlayer.volume;
                },
                set masterVolume(value: number) {
                    audioPlayer.volume = value;
                },
                seekTo(time: number) {
                    audioPlayer.currentTime = time / 1000;
                },
                play() {
                    audioPlayer.play();
                },
                pause() {
                    audioPlayer.pause();
                },
            };

            let updateTimer = 0;
            const onTimeUpdate = () => {
                api.value?.player?.output?.updatePosition(
                    audioPlayer.currentTime * 1000,
                );
            };

            audioPlayer.addEventListener("timeupdate", onTimeUpdate);
            audioPlayer.addEventListener("seeked", onTimeUpdate);
            audioPlayer.addEventListener("play", () => {
                window.clearInterval(updateTimer);
                playing.value = true;
                api.value?.play();
                updateTimer = window.setInterval(onTimeUpdate, 50);
            });

            audioPlayer.addEventListener("pause", () => {
                if (audioPlayer.ended) {
                    return;
                }

                console.log("[audioPlayer] paused");
                playing.value = false;
                api.value?.pause();
                window.clearInterval(updateTimer);
            });
            audioPlayer.addEventListener("ended", () => {
                console.log("[audioPlayer] ended");

                if (isLooping.value) {
                    audioPlayer.currentTime = 0;
                    audioPlayer.play();
                } else {
                    playing.value = false;
                    api.value?.pause();
                    window.clearInterval(updateTimer);
                }
            });
            audioPlayer.addEventListener("volumechange", () => {
                api.value.masterVolume = audioPlayer.volume;
            });
            audioPlayer.addEventListener("ratechange", () => {
                api.value.playbackSpeed = audioPlayer.playbackRate;
            });
        }

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
        api.value.updateSettings();

        let found = false;

        for (const a of audioList.value) {
            if (a.filename === filename) {
                audio.value = a;
                if (a.syncMethod === "advanced") {
                    advancedSync(a.advancedSync);
                } else {
                    simpleSync(a.simpleSync);
                }
                found = true;
                break;
            }
        }

        if (!found) {
            notify({
                type: "error",
                title: "Error",
                text: "Audio file not found, fallback to synth.",
            });
            currentAudio.value = "synth";
            return;
        }

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
        api.value.updateSettings();

        api.value.player.output.handler = audioHandler;

        const path = baseURL + `/api/tab/${tabID.value}/audio/${encodeURIComponent(filename)}`;

        audioPlayer.src = path;
        audioPlayer.load();
        audioPlayer.playbackRate = api.value.playbackSpeed;

        pause();
    }

    async function initYoutube(videoID: string) {
        closeAllList();

        if (!youtubePlayer) {
            await initYoutubePlayer();
        }

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
        api.value.updateSettings();

        let found = false;

        for (const yt of youtubeList.value) {
            if (yt.videoID === videoID) {
                youtube.value = yt;
                if (yt.syncMethod === "advanced") {
                    advancedSync(yt.advancedSync);
                } else {
                    simpleSync(yt.simpleSync);
                }
                found = true;
                break;
            }
        }

        if (!found) {
            notify({
                type: "error",
                title: "Error",
                text: "YouTube video not found, fallback to synth.",
            });
            currentAudio.value = "synth";
            return;
        }

        api.value.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
        api.value.updateSettings();

        api.value.player.output.handler = alphaTabYoutubeHandler;
        youtubePlayer.cueVideoById(videoID);
        youtubePlayer.setPlaybackRate(api.value.playbackSpeed);
        pause();
    }

    let _youtubeRef: HTMLElement | null = null;
    let _audioPlayerRef: HTMLAudioElement | null = null;

    function setYoutubeRef(el: HTMLElement) {
        _youtubeRef = el;
    }

    function setAudioPlayerRef(el: HTMLAudioElement) {
        _audioPlayerRef = el;
    }

    async function initYoutubePlayer() {
        const ytWarning = setTimeout(() => {
            notify({
                type: "warning",
                title: "Warning",
                text: "If YouTube is taking too long to load, please refresh the page.",
            });
        }, 5000);

        if (_youtubeRef) {
            _youtubeRef.innerHTML = "";
        }

        const isScriptLoaded = typeof (window as any).YT !== "undefined";
        console.log("isScriptLoaded:", isScriptLoaded);

        const playerElement = document.createElement("div");
        if (_youtubeRef) {
            _youtubeRef.appendChild(playerElement);
        }

        if (!isScriptLoaded) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/player_api";
            const firstScriptTag = document.getElementsByTagName("script")[0];
            firstScriptTag.parentNode!.insertBefore(tag, firstScriptTag);
            console.log("Loading YouTube API");

            const youtubeApiReady = Promise.withResolvers<void>();
            (window as any).onYouTubePlayerAPIReady = youtubeApiReady.resolve;
            await youtubeApiReady.promise;
            console.log("YouTube API ready");
        } else {
            console.log("YouTube API already loaded");
        }

        const YT = (window as any).YT;
        const youtubePlayerReady = Promise.withResolvers<void>();
        let currentTimeInterval = 0;
        const player = new YT.Player(playerElement, {
            height: "180",
            width: "320",
            playerVars: { "autoplay": 0 },
            events: {
                "onReady": () => {
                    youtubePlayerReady.resolve();
                },

                "onStateChange": (e: any) => {
                    switch (e.data) {
                        case YT.PlayerState.PLAYING:
                            currentTimeInterval = window.setInterval(() => {
                                api.value?.player?.output?.updatePosition(player.getCurrentTime() * 1000);
                            }, 50);
                            playing.value = true;
                            api.value?.play();
                            break;
                        case YT.PlayerState.ENDED:
                            window.clearInterval(currentTimeInterval);
                            playing.value = false;
                            api.value?.stop();
                            break;
                        case YT.PlayerState.PAUSED:
                            window.clearInterval(currentTimeInterval);
                            playing.value = false;
                            api.value?.pause();
                            break;
                        default:
                            break;
                    }
                },
                "onPlaybackRateChange": (e: any) => {
                    api.value.playbackSpeed = e.data;
                },
                "onError": (e: any) => {
                    youtubePlayerReady.reject(e);
                },
            },
        });

        await youtubePlayerReady.promise;
        console.log("YouTube Player ready");

        let initialSeek = -1;
        alphaTabYoutubeHandler = {
            get backingTrackDuration() {
                return player.getDuration() * 1000;
            },
            get playbackRate() {
                console.log("Get playback rate:", player.getPlaybackRate());
                return player.getPlaybackRate();
            },
            set playbackRate(value: number) {
                console.log("Set playback rate:", value);
                player.setPlaybackRate(value);
            },
            get masterVolume() {
                return player.getVolume() / 100;
            },
            set masterVolume(value: number) {
                player.setVolume(value * 100);
            },
            seekTo(time: number) {
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

        youtubePlayer = player;
        clearTimeout(ytWarning);
    }

    function audioYoutube(videoID: string) {
        currentAudio.value = "youtube-" + videoID;
        closeAllList();
    }

    function audioFile(filename: string) {
        currentAudio.value = "audio-" + filename;
        closeAllList();
    }

    function audioSynth() {
        currentAudio.value = "synth";
        closeAllList();
    }

    function audioBackingTrack(hasBackingTrack: () => boolean) {
        if (!hasBackingTrack()) {
            notify({
                type: "error",
                title: "Error",
                text: "No backing track found in this tab.",
            });
            return;
        }
        currentAudio.value = "backingTrack";
        closeAllList();
    }

    async function saveYoutube() {
        let res;
        try {
            res = await fetch(baseURL + `/api/tab/${tabID.value}/youtube/${youtube.value.videoID}`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    syncMethod: youtube.value.syncMethod,
                    simpleSync: youtube.value.simpleSync,
                    advancedSync: youtube.value.advancedSync,
                }),
            });

            await checkFetch(res);
        } catch (e) {
            generalError(e);
        }
    }

    async function saveAudio() {
        let res;
        try {
            res = await fetch(baseURL + `/api/tab/${tabID.value}/audio/${audio.value.filename}`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    syncMethod: audio.value.syncMethod,
                    simpleSync: audio.value.simpleSync,
                    advancedSync: audio.value.advancedSync,
                }),
            });

            await checkFetch(res);
        } catch (e) {
            generalError(e);
        }
    }

    return {
        currentAudio,
        youtube,
        audio,
        simpleSyncSecond,
        showAudioList,
        syncMethod,
        audioYoutube,
        audioFile,
        audioSynth,
        audioBackingTrack,
        saveYoutube,
        saveAudio,
        setYoutubeRef,
        setAudioPlayerRef,
        initSynth,
    };
}
