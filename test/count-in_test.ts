// Regression tests for the count-in: cancelling a running count-in must also
// clear the already-scheduled pings, otherwise a quick re-click while counting
// in plays two count-ins on top of each other.
import { createCountIn } from "../frontend/src/count-in.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

// bpm 6000 => 10ms per beat, so the tests run fast without waiting a real bar
const FAST_BPM = 6000;

interface BeatCall {
    beatIndex: number;
    totalBeats: number;
}

async function settle(ms = 100): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

Deno.test("schedules one ping per beat in order", async () => {
    const calls: BeatCall[] = [];
    const countIn = createCountIn((beatIndex, totalBeats) =>
        calls.push({
            beatIndex,
            totalBeats,
        })
    );

    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    await settle();

    assert(calls.length === 4, `expected 4 pings, got ${calls.length}`);
    assert(calls.map((c) => c.beatIndex).join(",") === "0,1,2,3", "pings must play in order");
    assert(calls.every((c) => c.totalBeats === 4), "total beat count must be passed through");

    countIn.cancel();
});

Deno.test("cancel() clears the scheduled pings", async () => {
    const calls: BeatCall[] = [];
    const countIn = createCountIn((beatIndex, totalBeats) =>
        calls.push({
            beatIndex,
            totalBeats,
        })
    );

    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    countIn.cancel();
    await settle();

    assert(calls.length === 0, `cancelled pings must not fire, got ${calls.length}`);
});

Deno.test("cancel() then restart does not play the cancelled pings", async () => {
    const calls: BeatCall[] = [];
    const countIn = createCountIn((beatIndex, totalBeats) =>
        calls.push({
            beatIndex,
            totalBeats,
        })
    );

    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    countIn.cancel();
    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    countIn.cancel();
    await settle();

    assert(calls.length === 0, `no pings may play after cancel, got ${calls.length}`);
});

Deno.test("start() is a no-op while a count-in is already running", async () => {
    const calls: BeatCall[] = [];
    const countIn = createCountIn((beatIndex, totalBeats) =>
        calls.push({
            beatIndex,
            totalBeats,
        })
    );

    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    await countIn.start({
        bpm: FAST_BPM,
        beats: 4,
        onFinished: () => {},
    });
    await settle();

    assert(calls.length === 4, `second start() must not add more pings, got ${calls.length}`);
    countIn.cancel();
});
