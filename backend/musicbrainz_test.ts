import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.17";

import { buildRecordingQuery, chooseBestMusicBrainzRecording, lookupMusicBrainzMetadata } from "./musicbrainz.ts";

Deno.test("MusicBrainz recording query includes available metadata only", () => {
    assertEquals(buildRecordingQuery({ artist: "King Gizzard", title: "Robot Stop", album: "Nonagon Infinity" }), 'recording:"Robot Stop" AND artist:"King Gizzard" AND release:"Nonagon Infinity"');
    assertEquals(buildRecordingQuery({ title: "Robot Stop" }), 'recording:"Robot Stop"');
});

Deno.test("MusicBrainz lookup is optional and uses injected fetch", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        seenUrls.push(url);
        if (url.includes("/artist?")) {
            return Response.json({
                artists: [{
                    id: "artist-1",
                    name: "Maintenance Artist",
                    score: "100",
                    country: "US",
                }],
            });
        }
        return Response.json({
            recordings: [{
                id: "recording-1",
                title: "Maintenance Song",
                score: 91,
                "artist-credit": [{ name: "Maintenance Artist" }],
                releases: [{ id: "release-1", title: "Maintenance Album", date: "2026" }],
            }],
        });
    };

    const result = await lookupMusicBrainzMetadata(
        { artist: "Maintenance Artist", title: "Maintenance Song", album: "Maintenance Album" },
        { baseUrl: "https://example.test/ws/2", fetcher, limit: 3, userAgent: "its-mytabs-test/1.0 (test@example.com)" },
    );

    assertEquals(seenUrls.length, 2);
    assertEquals(seenUrls.every((url) => url.includes("limit=3")), true);
    assertEquals(result.artists[0].name, "Maintenance Artist");
    assertEquals(result.recordings[0].releases[0].title, "Maintenance Album");
});

Deno.test("MusicBrainz lookup throws on non-OK responses", async () => {
    await assertRejects(
        () =>
            lookupMusicBrainzMetadata(
                { artist: "Rate Limited", title: "Song" },
                {
                    baseUrl: "https://example.test/ws/2",
                    fetcher: () => Promise.resolve(new Response("rate limited", { status: 503 })),
                    userAgent: "its-mytabs-test/1.0 (test@example.com)",
                },
            ),
        Error,
        "MusicBrainz artist lookup failed with HTTP 503",
    );
});

Deno.test("MusicBrainz lookup tolerates malformed JSON shapes", async () => {
    const result = await lookupMusicBrainzMetadata(
        { artist: "Malformed Artist", title: "Malformed Song" },
        {
            baseUrl: "https://example.test/ws/2",
            fetcher: () => Promise.resolve(Response.json({ unexpected: true })),
            userAgent: "its-mytabs-test/1.0 (test@example.com)",
        },
    );

    assertEquals(result.artists, []);
    assertEquals(result.recordings, []);
});

Deno.test("MusicBrainz best recording selection favors exact local metadata", () => {
    const best = chooseBestMusicBrainzRecording([
        {
            id: "weak",
            title: "Other Song",
            artist: "Maintenance Artist",
            releases: [{ id: "a", title: "Maintenance Album", date: "", score: 0 }],
            score: 95,
        },
        {
            id: "exact",
            title: "Maintenance Song",
            artist: "Maintenance Artist",
            releases: [{ id: "b", title: "Maintenance Album", date: "", score: 0 }],
            score: 80,
        },
    ], { artist: "Maintenance Artist", title: "Maintenance Song", album: "Maintenance Album" });

    assertEquals(best?.id, "exact");
});
