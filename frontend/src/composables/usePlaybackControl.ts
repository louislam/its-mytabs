import { ref, watch, type Ref } from "vue";
import { ActionBuffer } from "../app.js";

const speedActionBuffer = new ActionBuffer(1000);

export function usePlaybackControl(
    api: Ref<any>,
    ready: Ref<boolean>,
    selectedTrack: Ref<number>,
    setConfig: (key: string, value: any) => void,
    onPlayingChange: (playing: boolean) => void,
) {
    const playing = ref(false);
    const enableCountIn = ref(false);
    const enableMetronome = ref(false);
    const isLooping = ref(false);
    const speed = ref(100);

    watch(playing, () => {
        if (!api.value) {
            return;
        }

        if (playing.value) {
            api.value.play();
        } else {
            api.value.pause();
        }

        onPlayingChange(playing.value);
    });

    watch(enableCountIn, () => {
        if (!api.value) {
            return;
        }
        if (enableCountIn.value) {
            api.value.countInVolume = 1;
        } else {
            api.value.countInVolume = 0;
        }
        setConfig("enableCountIn", enableCountIn.value);
    });

    watch(enableMetronome, () => {
        if (!api.value) {
            return;
        }
        if (enableMetronome.value) {
            api.value.metronomeVolume = 1;
        } else {
            api.value.metronomeVolume = 0;
        }
        setConfig("enableMetronome", enableMetronome.value);
    });

    watch(isLooping, () => {
        if (!api.value) {
            return;
        }
        api.value.isLooping = isLooping.value;
        setConfig("isLooping", isLooping.value);
    });

    watch(speed, (newVal) => {
        if (!api.value) {
            return;
        }
        console.log("Speed changed to:", newVal);

        let s = newVal;

        if (typeof s !== "number" || isNaN(s)) {
            s = 100;
        } else if (s < 20) {
            s = 20;
        } else if (s > 1000) {
            s = 1000;
        }

        speedActionBuffer.run(() => {
            api.value.playbackSpeed = parseFloat((s / 100).toFixed(2));
            setConfig("speed", s);
        });
    });

    function playPause() {
        if (!api.value || !ready.value) {
            return;
        }
        playing.value = !playing.value;
    }

    function play() {
        if (!api.value || !ready.value) {
            return;
        }
        playing.value = true;
    }

    function pause() {
        if (!api.value || !ready.value) {
            return;
        }
        playing.value = false;
    }

    function countIn() {
        enableCountIn.value = !enableCountIn.value;
    }

    function metronome() {
        enableMetronome.value = !enableMetronome.value;
    }

    function loop() {
        isLooping.value = !isLooping.value;
    }

    function playFromHighlightedRange(): boolean | undefined {
        if (!api.value || !ready.value) {
            return;
        }

        const playbackRange = api.value.playbackRange;
        if (!playbackRange) {
            return false;
        }

        api.value.tickPosition = playbackRange.startTick;
        play();
        return true;
    }

    function playFromFirstBarContainingNotes(offset = 0) {
        if (!api.value || !ready.value) {
            return;
        }

        const track = api.value.score.tracks[selectedTrack.value];

        let targetBar: any = null;

        for (let i = 0; i < track.staves[0].bars.length; i++) {
            const bar = track.staves[0].bars[i];

            let hasNotes = false;
            if (bar && bar.voices) {
                for (const voice of bar.voices) {
                    if (!voice || !voice.beats) continue;
                    for (const beat of voice.beats) {
                        if (beat && beat.notes && beat.notes.length > 0) {
                            hasNotes = true;
                            break;
                        }
                    }
                    if (hasNotes) break;
                }
            }

            if (hasNotes) {
                const bars = track.staves[0].bars;
                const targetIndex = Math.max(0, Math.min(i + offset, bars.length - 1));
                targetBar = bars[targetIndex];
                break;
            }
        }

        if (targetBar) {
            const firstBeat = targetBar.voices[0].beats[0];
            api.value.tickPosition = firstBeat.absoluteDisplayStart;
        }

        play();
    }

    function moveToBar(steps: number) {
        try {
            if (!api.value || !api.value.score || !api.value.score.masterBars || api.value.score.masterBars.length === 0) {
                return;
            }

            const masterBars = api.value.score.masterBars;
            const currentTick = Number(api.value.tickPosition ?? 0);
            let index = 0;
            for (let i = 0; i < masterBars.length; i++) {
                const masterBarStart = masterBars[i].start ?? 0;
                if (masterBarStart <= currentTick) {
                    index = i;
                } else {
                    break;
                }
            }

            let target = index + steps;
            if (target < 0) target = 0;
            if (target >= masterBars.length) target = masterBars.length - 1;

            const targetTick = masterBars[target].start ?? 0;
            api.value.tickPosition = targetTick;
        } catch (err) {
            console.error("moveToBar error:", err);
        }
    }

    return {
        playing,
        enableCountIn,
        enableMetronome,
        isLooping,
        speed,
        playPause,
        play,
        pause,
        countIn,
        metronome,
        loop,
        playFromHighlightedRange,
        playFromFirstBarContainingNotes,
        moveToBar,
    };
}
