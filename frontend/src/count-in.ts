/// <reference lib="dom" />
/**
 * Custom count-in.
 *
 * alphaTab only implements count-in natively for the synthesizer (MIDI) player.
 * For external audio sources (audio files, YouTube, backing tracks) the count-in
 * is silent and playback starts immediately, so we play our own metronome
 * count-in here, synthesized live with the Foley sound library.
 */
import { play as foleyPlay } from "@foleyjs/core";

export interface CountInOptions {
    /** Beats per minute of the count-in (already adjusted for playback speed) */
    bpm: number;
    /** Number of beats to play (usually the time signature numerator) */
    beats: number;
    /** Called once the count-in finished and playback should start */
    onFinished: () => void;
}

type PlayFn = (beatIndex: number, totalBeats: number) => void;

/**
 * Create a count-in engine. The play function is injectable so tests can
 * substitute a fake instead of the Foley Web Audio library.
 */
export function createCountIn(
    playFn: PlayFn = (beatIndex, totalBeats) => {
        // "C C C G" count-in: every beat on the root, the final pickup a
        // perfect fifth up so you can hear the downbeat coming.
        foleyPlay("ping", { pitch: beatIndex === totalBeats - 1 ? 7 : 0 });
    },
) {
    return new CountIn(playFn);
}

class CountIn {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private beatTimers: ReturnType<typeof setTimeout>[] = [];
    private countingIn = false;
    private playFn: PlayFn;

    constructor(playFn: PlayFn) {
        this.playFn = playFn;
    }

    get isCountingIn(): boolean {
        return this.countingIn;
    }

    /**
     * Play one bar of count-in beats, then invoke `onFinished`.
     */
    async start(options: CountInOptions): Promise<void> {
        if (this.countingIn) {
            return;
        }

        const beatMs = 60000 / options.bpm;

        this.countingIn = true;
        this.beatTimers = [];

        for (let i = 0; i < options.beats; i++) {
            this.beatTimers.push(
                setTimeout(() => {
                    try {
                        this.playFn(i, options.beats);
                    } catch {
                        // audio errors must not break the count-in timing
                    }
                }, i * beatMs),
            );
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.countingIn = false;
            this.beatTimers = [];
            options.onFinished();
        }, options.beats * beatMs);
    }

    /**
     * Cancel a pending count-in (e.g. the user paused before it finished).
     * The already-scheduled pings are cleared too so a quick restart does not
     * leave the previous count-in sounding on top of the new one.
     */
    cancel(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        for (const timer of this.beatTimers) {
            clearTimeout(timer);
        }
        this.beatTimers = [];
        this.countingIn = false;
    }
}

export const countIn = createCountIn();
