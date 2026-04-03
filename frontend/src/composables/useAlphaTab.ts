import { ref, type Ref } from "vue";
import { baseURL, checkFetch, getInstrumentName } from "../app.js";
import { getKeySignature } from "../util.ts";
import { convertAlphaTexSyncPoint } from "../app.js";

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode, StaveProfile } = alphaTab;

export function useAlphaTab(
    setting: Ref<Record<string, any>>,
    animatedCursor: Ref<boolean>,
    getConfig: (key: string, defaultValue: any) => any,
    setFixedHeader: (val: boolean) => void,
) {
    const api = ref<InstanceType<typeof alphaTab.AlphaTabApi> | undefined>(undefined);
    const score = ref<any>(null);
    const tracks = ref<Array<{ id: number; name: string; program: number }>>([]);
    const ready = ref(false);
    const tab = ref<Record<string, any>>({});
    const youtubeList = ref<any[]>([]);
    const audioList = ref<any[]>([]);
    const keySignature = ref("");
    const playbackRange = ref<any>(null);

    function getFileURL(tempToken: string) {
        return baseURL + `/api/tab/${tabID.value}/file?tempToken=${tempToken}`;
    }

    const tabID = ref<number | string>(-1);

    async function getTempToken() {
        const fileURL = baseURL + `/api/tab/${tabID.value}/temp-token`;
        const response = await fetch(fileURL, {
            credentials: "include",
        });

        if (!response.ok) {
            throw new Error("Failed to get get temp token");
        }
        return (await response.json()).token;
    }

    function getStaveProfile() {
        if (setting.value.scoreStyle === "tab" || setting.value.scoreStyle === "horizontal-tab") {
            return StaveProfile.Tab;
        } else if (setting.value.scoreStyle === "score") {
            return StaveProfile.Score;
        } else if (setting.value.scoreStyle === "score-tab") {
            return StaveProfile.ScoreTab;
        } else {
            return StaveProfile.Default;
        }
    }

    function applyColors(scoreObj: any) {
        let stringColors: Record<number, any> = {
            1: alphaTab.model.Color.fromJson("#bf3732"),
            2: alphaTab.model.Color.fromJson("#fff800"),
            3: alphaTab.model.Color.fromJson("#0080ff"),
            4: alphaTab.model.Color.fromJson("#e07b39"),
            5: alphaTab.model.Color.fromJson("#2A8E08"),
            6: alphaTab.model.Color.fromJson("#A349A4"),
        };

        if (setting.value.scoreColor === "light") {
            stringColors[2] = alphaTab.model.Color.fromJson("#b5a33a");
        }

        for (const track of scoreObj.tracks) {
            for (const staff of track.staves) {
                console.log(setting.value.noteColor, staff.stringTuning.tunings.length);

                if (setting.value.noteColor === "louis-bass-v" && staff.stringTuning.tunings.length === 5) {
                    stringColors = {
                        1: alphaTab.model.Color.fromJson("#b1da68"),
                        2: alphaTab.model.Color.fromJson("#bf3732"),
                        3: alphaTab.model.Color.fromJson("#fff800"),
                        4: alphaTab.model.Color.fromJson("#0080ff"),
                        5: alphaTab.model.Color.fromJson("#e07b39"),
                    };
                }

                for (const bar of staff.bars) {
                    for (const voice of bar.voices) {
                        for (const beat of voice.beats) {
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

                            if (setting.value.noteColor !== "none") {
                                for (const note of beat.notes) {
                                    note.style = new alphaTab.model.NoteStyle();
                                    note.style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, stringColors[note.string]);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    function overrideHiddenStaves(scoreObj: any) {
        for (const track of scoreObj.tracks) {
            for (const staff of track.staves) {
                if (setting.value.scoreStyle === "tab" || setting.value.scoreStyle === "horizontal-tab") {
                    staff.showTablature = true;
                    staff.showStandardNotation = false;
                } else if (setting.value.scoreStyle === "score") {
                    staff.showTablature = false;
                    staff.showStandardNotation = true;
                } else if (setting.value.scoreStyle === "score-tab") {
                    staff.showTablature = true;
                    staff.showStandardNotation = true;
                }
            }
        }
    }

    function simpleSync(offset: number) {
        const syncPoints = [
            { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": offset },
        ];
        api.value!.score.applyFlatSyncPoints(syncPoints);
    }

    function advancedSync(syncPointsText: string) {
        const syncPoints = convertAlphaTexSyncPoint(syncPointsText);
        api.value!.score.applyFlatSyncPoints(syncPoints);
        console.log("Applying advanced sync points:", syncPoints);
    }

    /**
     * Callbacks to be invoked once score is loaded.
     * These are set by the caller (Tab.vue) to wire up cross-composable logic.
     */
    let onScoreLoadedCallback: ((trackID: number) => void) | null = null;

    function onScoreLoaded(cb: (trackID: number) => void) {
        onScoreLoadedCallback = cb;
    }

    let onPlayerFinishedCallback: (() => void) | null = null;

    function onPlayerFinished(cb: () => void) {
        onPlayerFinishedCallback = cb;
    }

    function initContainer(
        tempToken: string,
        trackID: number,
        containerRef: HTMLElement,
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            if (api.value) {
                destroyContainer();
            }

            if (!(containerRef instanceof HTMLElement)) {
                reject(new Error("Container element not found"));
            }

            let displayResources: Record<string, any> = {
                tablatureFont: "bold 14px Arial",
                barNumberColor: "#6D6D6D",
            };

            if (setting.value.scoreColor === "dark") {
                displayResources = {
                    ...displayResources,
                    staffLineColor: "#6D6D6D",
                    barSeparatorColor: "#6D6D6D",
                    mainGlyphColor: "#A4A4A4",
                    secondaryGlyphColor: "#A4A4A4",
                    scoreInfoColor: "#A3A3A3",
                    barNumberColor: "#6D6D6D",
                };
            }

            let layoutMode: any = undefined;

            if (setting.value.scoreStyle === "horizontal-tab") {
                layoutMode = alphaTab.LayoutMode.Horizontal;
                setFixedHeader(true);
            }

            api.value = new alphaTab.AlphaTabApi(containerRef, {
                notation: {
                    rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
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
                    file: getFileURL(tempToken),
                    fontDirectory: "/font/",
                    engine: "html5",
                },
                player: {
                    enablePlayer: true,
                    enableCursor: true,
                    enableAnimatedBeatCursor: animatedCursor.value,
                    enableUserInteraction: true,
                    soundFont: "/soundfont/sonivox.sf2",
                    scrollMode: ScrollMode.Off,
                    scrollOffsetY: -50,
                    playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
                },
                display: {
                    staveProfile: getStaveProfile(),
                    resources: displayResources,
                    layoutMode,
                    scale: setting.value.scale,
                },
            });

            // Exposing api to window for debugging
            (window as any).api = api.value;

            // Used for showing/hiding the "Restart" button
            api.value.playbackRangeChanged.on(() => {
                playbackRange.value = api.value!.playbackRange;
            });

            // iOS 16.4+: Enable audio playback even when silent switch is ON
            if ("audioSession" in navigator) {
                try {
                    (navigator as any).audioSession.type = "playback";
                } catch (error) {
                    console.error("Failed to set navigator.audioSession.type to 'playback':", error);
                }
            }

            // Score Loaded
            api.value.scoreLoaded.on(async (s: any) => {
                console.log("Score loaded");

                applyColors(s);

                // Track
                if (trackID < 0 || trackID >= s.tracks.length) {
                    trackID = 0;
                }
                api.value!.renderTracks([api.value!.score.tracks[trackID]]);

                // Always show tempo automation on the master bar
                if (api.value!.score.masterBars.length > 0 && api.value!.score.masterBars[0].tempoAutomations.length > 0) {
                    api.value!.score.masterBars[0].tempoAutomations[0].isVisible = true;
                }

                // Get key signature
                const firstBar = api.value!.score.tracks[trackID].staves[0].bars[0];
                keySignature.value = getKeySignature(firstBar);

                // Scroll Mode
                // Force Smooth from horizontal tab
                if (setting.value.scoreStyle === "horizontal-tab") {
                    // scrollMode will be set by caller
                }

                tracks.value = [];

                // List all tracks
                s.tracks.forEach((track: any) => {
                    tracks.value.push({
                        id: track.index,
                        name: getInstrumentName(track.playbackInfo.program),
                        program: track.playbackInfo.program,
                    });
                });

                score.value = s;

                if (onScoreLoadedCallback) {
                    onScoreLoadedCallback(trackID);
                }

                ready.value = true;
                resolve(trackID);
            });

            api.value.playerFinished.on(() => {
                if (onPlayerFinishedCallback) {
                    onPlayerFinishedCallback();
                }
            });
        });
    }

    function destroyContainer() {
        api.value?.destroy();
        api.value = undefined;

        // Reset states
        ready.value = false;
        tracks.value = [];
        score.value = null;
        keySignature.value = "";
        playbackRange.value = null;
    }

    async function load(trackID: number, containerRef: HTMLElement, router: any) {
        if (api.value) {
            destroyContainer();
        }

        const res = await fetch(baseURL + `/api/tab/${tabID.value}`, {
            credentials: "include",
        });

        try {
            await checkFetch(res);
        } catch (e: any) {
            if (e.message === "Not logged in") {
                router.push("/login");
                return;
            } else {
                throw e;
            }
        }

        const data = await res.json();
        if (data.tab) {
            tab.value = data.tab;
            youtubeList.value = data.youtubeList;
            audioList.value = data.audioList;
        }

        const tempToken = await getTempToken();

        // Requested trackID may be invalid, so we need to get the actual trackID used
        trackID = await initContainer(tempToken, trackID, containerRef);

        return trackID;
    }

    return {
        api,
        score,
        tracks,
        ready,
        tab,
        tabID,
        youtubeList,
        audioList,
        keySignature,
        playbackRange,
        load,
        destroyContainer,
        simpleSync,
        advancedSync,
        getStaveProfile,
        overrideHiddenStaves,
        onScoreLoaded,
        onPlayerFinished,
        ScrollMode,
        StaveProfile,
    };
}
