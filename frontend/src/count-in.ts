/// <reference lib="dom" />
/**
 * Custom count-in using the Web Audio API.
 *
 * alphaTab only implements count-in natively for the synthesizer (MIDI) player.
 * For external audio sources (audio files, YouTube, backing tracks) the count-in
 * is silent and playback starts immediately, so we implement our own metronome
 * count-in here.
 */

export interface CountInOptions {
    /** Beats per minute of the count-in (already adjusted for playback speed) */
    bpm: number;
    /** Number of beats to play (usually the time signature numerator) */
    beats: number;
    /** Called once the count-in finished and playback should start */
    onFinished: () => void;
}

class CountIn {
    private audioContext: AudioContext | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private countingIn = false;
    /** Source nodes of the currently scheduled count-in clicks, stopped on cancel. */
    private activeSources: AudioScheduledSourceNode[] = [];

    get isCountingIn(): boolean {
        return this.countingIn;
    }

    private getAudioContext(): AudioContext | null {
        if (!this.audioContext) {
            const globals = globalThis as unknown as {
                AudioContext?: typeof AudioContext;
                webkitAudioContext?: typeof AudioContext;
            };
            const AudioCtx = globals.AudioContext ?? globals.webkitAudioContext;
            if (AudioCtx) {
                this.audioContext = new AudioCtx();
            }
        }
        return this.audioContext;
    }

    /**
     * A cached short white-noise buffer used for the percussive "tick" attack.
     */
    private getNoiseBuffer(context: AudioContext): AudioBuffer {
        if (!this.noiseBuffer) {
            const length = Math.floor(context.sampleRate * 0.1);
            this.noiseBuffer = context.createBuffer(1, length, context.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }
        return this.noiseBuffer;
    }

    /**
     * Schedule a woodblock-like metronome "tick".
     * A real tick is a very short percussive transient, so the dominant sound is
     * a short filtered noise burst, plus a tiny low-frequency knock for body.
     * There is no sustained pitched tone, which would sound like a beep.
     * @param context The audio context to play on
     * @param when Time in seconds when the tick should sound
     * @param accent Whether this is the first (down) beat
     */
    private playMetronomeClick(context: AudioContext, when: number, accent: boolean): void {
        // Main click: short band-passed white-noise burst
        const noise = context.createBufferSource();
        noise.buffer = this.getNoiseBuffer(context);
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = accent ? 4000 : 3000;
        filter.Q.value = 1.5;
        const noiseGain = context.createGain();
        const noiseVolume = accent ? 0.4 : 0.25;
        noiseGain.gain.setValueAtTime(0.0001, when);
        noiseGain.gain.exponentialRampToValueAtTime(noiseVolume, when + 0.002);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(context.destination);
        noise.start(when);
        noise.stop(when + 0.025);
        this.activeSources.push(noise);

        // Body: very short low-frequency knock for woodblock weight
        const knock = context.createOscillator();
        const knockGain = context.createGain();
        knock.type = "sine";
        knock.frequency.setValueAtTime(accent ? 320 : 240, when);
        knock.frequency.exponentialRampToValueAtTime(140, when + 0.03);
        const knockVolume = accent ? 0.45 : 0.3;
        knockGain.gain.setValueAtTime(knockVolume, when);
        knockGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
        knock.connect(knockGain);
        knockGain.connect(context.destination);
        knock.start(when);
        knock.stop(when + 0.035);
        this.activeSources.push(knock);
    }

    /**
     * Play one bar of metronome beats, then invoke `onFinished`.
     * If the Web Audio API is unavailable, `onFinished` is called immediately.
     */
    async start(options: CountInOptions): Promise<void> {
        if (this.countingIn) {
            return;
        }

        const audioContext = this.getAudioContext();
        if (!audioContext) {
            options.onFinished();
            return;
        }

        await audioContext.resume();

        const beatMs = 60000 / options.bpm;
        const now = audioContext.currentTime;

        this.countingIn = true;
        this.activeSources = [];

        for (let i = 0; i < options.beats; i++) {
            this.playMetronomeClick(audioContext, now + (i * beatMs) / 1000, i === 0);
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.countingIn = false;
            this.activeSources = [];
            options.onFinished();
        }, options.beats * beatMs);
    }

    /**
     * Cancel a pending count-in (e.g. the user paused before it finished).
     * The already-scheduled clicks are stopped too so a quick restart does not
     * leave the previous count-in sounding on top of the new one.
     */
    cancel(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        for (const source of this.activeSources) {
            try {
                // stop() before the scheduled start time cancels the click
                source.stop();
            } catch {
                // already finished playing
            }
        }
        this.activeSources = [];
        this.countingIn = false;
    }
}

export const countIn = new CountIn();
