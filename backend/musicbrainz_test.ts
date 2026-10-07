import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.17";

import { buildRecordingQuery, chooseBestMusicBrainzRecording, chooseBestMusicBrainzRelease, lookupMusicBrainzMetadata } from "./musicbrainz.ts";

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

Deno.test("MusicBrainz lookup cleans noisy fields and can fallback without album", async () => {
    const seenQueries: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const query = url.searchParams.get("query") ?? "";
        seenQueries.push(query);
        if (url.pathname.endsWith("/artist")) {
            return Response.json({ artists: [{ id: "metallica", name: "Metallica", score: "100" }] });
        }
        if (query.includes("release:")) {
            return Response.json({ recordings: [] });
        }
        return Response.json({
            recordings: [{
                id: "frantic",
                title: "Frantic",
                score: "100",
                "artist-credit": [{ name: "Metallica" }],
                releases: [{ id: "st-anger", title: "St. Anger", date: "2003" }],
            }],
        });
    };

    const result = await lookupMusicBrainzMetadata(
        { artist: "Metallica!!!!", title: "frantic", album: "Saint Anger" },
        {
            baseUrl: "https://example.test/ws/2",
            fetcher,
            fallbackOnNoRecording: true,
            userAgent: "its-mytabs-test/1.0 (test@example.com)",
        },
    );

    assertEquals(seenQueries[0], 'artist:"Metallica"');
    assertEquals(seenQueries[1], 'recording:"frantic" AND artist:"Metallica" AND release:"Saint Anger"');
    assertEquals(seenQueries[2], 'recording:"frantic" AND artist:"Metallica"');
    assertEquals(result.recordings[0].artist, "Metallica");
    assertEquals(result.recordings[0].releases[0].title, "St. Anger");
});

Deno.test("MusicBrainz lookup can fallback to title-only recording search", async () => {
    const seenQueries: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const query = url.searchParams.get("query") ?? "";
        seenQueries.push(query);
        if (url.pathname.endsWith("/artist")) {
            return Response.json({ artists: [] });
        }
        if (query.includes("artist:")) {
            return Response.json({ recordings: [] });
        }
        return Response.json({
            recordings: [{
                id: "frantic-title-only",
                title: "Frantic",
                score: "70",
                "artist-credit": [{ name: "Metallica" }],
                releases: [{ id: "st-anger", title: "St. Anger", date: "2003" }],
            }],
        });
    };

    const result = await lookupMusicBrainzMetadata(
        { artist: "Metallica!!!!", title: "frantic", album: "" },
        {
            baseUrl: "https://example.test/ws/2",
            fetcher,
            fallbackOnNoRecording: true,
            userAgent: "its-mytabs-test/1.0 (test@example.com)",
        },
    );

    assertEquals(seenQueries, [
        'artist:"Metallica"',
        'recording:"frantic" AND artist:"Metallica"',
        'recording:"frantic"',
    ]);
    assertEquals(result.recordings[0].id, "frantic-title-only");
});

Deno.test("MusicBrainz best recording selection favors exact local metadata", () => {
    const best = chooseBestMusicBrainzRecording([
        {
            id: "weak",
            title: "Other Song",
            artist: "Maintenance Artist",
            releases: [{ id: "a", title: "Maintenance Album", date: "", status: "", primaryType: "", secondaryTypes: [], score: 0 }],
            score: 95,
        },
        {
            id: "exact",
            title: "Maintenance Song",
            artist: "Maintenance Artist",
            releases: [{ id: "b", title: "Maintenance Album", date: "", status: "", primaryType: "", secondaryTypes: [], score: 0 }],
            score: 80,
        },
    ], { artist: "Maintenance Artist", title: "Maintenance Song", album: "Maintenance Album" });

    assertEquals(best?.id, "exact");
});

Deno.test("MusicBrainz release selection prefers canonical album over dated demos", () => {
    const best = chooseBestMusicBrainzRelease({
        id: "nirvana-where-did-you-sleep",
        title: "Where Did You Sleep Last Night?",
        artist: "Nirvana",
        score: 95,
        releases: [
            {
                id: "long-demo",
                title: "1993-11-18: Unplugged & In Utero: The Demos: MTV Unplugged, Sony Studios, New York City, NY, USA",
                date: "1993-11-18",
                status: "Bootleg",
                primaryType: "Album",
                secondaryTypes: ["Demo", "Bootleg"],
                score: 100,
            },
            {
                id: "dated-live",
                title: "1994 - MTV Unplugged In New York",
                date: "1994",
                status: "Official",
                primaryType: "Album",
                secondaryTypes: ["Live"],
                score: 100,
            },
            {
                id: "canonical",
                title: "MTV Unplugged in New York",
                date: "1994",
                status: "Official",
                primaryType: "Album",
                secondaryTypes: ["Live"],
                score: 98,
            },
        ],
    });

    assertEquals(best?.id, "canonical");
});
