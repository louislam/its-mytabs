import { assert, assertEquals } from "jsr:@std/assert@^1.0.17";
import { inferMetadataFromPath, isAlphabeticBucket, isGenericFolderName, normalizeMetadata } from "./metadata.ts";

Deno.test("normalizeMetadata applies artist aliases and whitespace cleanup", () => {
    const result = normalizeMetadata({
        artist: " AC-DC ",
        title: "Back  in  Black",
        album: " Back_in_Black ",
    });

    assertEquals(result.artist, "AC/DC");
    assertEquals(result.title, "Back in Black");
    assertEquals(result.album, "Back in Black");
    assert(result.reasons.some((reason) => reason.includes("artist alias")));
});

Deno.test("normalizeMetadata handles article variants conservatively", () => {
    assertEquals(normalizeMetadata({ artist: "The Beatles" }).artist, "Beatles");
    assertEquals(normalizeMetadata({ artist: "Beatles, The" }).artist, "The Beatles");
    assertEquals(normalizeMetadata({ artist: "Bowie, David" }).artist, "Bowie, David");
});

Deno.test("inferMetadataFromPath detects letter artist album file shape", () => {
    const result = inferMetadataFromPath("A/ACDC/Back In Black/ACDC - Hells Bells (2).gp5");

    assertEquals(result.pathShape, "letter-artist-album-file");
    assertEquals(result.artist, "AC/DC");
    assertEquals(result.title, "Hells Bells");
    assertEquals(result.album, "Back In Black");
    assertEquals(result.versionLabel, "version 2");
    assert(result.confidence > 0.7);
});

Deno.test("inferMetadataFromPath rejects generic album folders", () => {
    const result = inferMetadataFromPath("Metallica/Tabs/Metallica - One solo.gp");

    assertEquals(result.pathShape, "artist-album-file");
    assertEquals(result.artist, "Metallica");
    assertEquals(result.title, "One");
    assertEquals(result.album, undefined);
    assertEquals(result.versionLabel, "solo");
    assert(result.reasons.some((reason) => reason.includes("Rejected generic folder")));
});

Deno.test("folder classification helpers reject buckets and generic names", () => {
    assertEquals(isAlphabeticBucket("B"), true);
    assertEquals(isAlphabeticBucket("BB"), false);
    assertEquals(isGenericFolderName("Guitar Tabs"), true);
    assertEquals(isGenericFolderName("Abbey Road"), false);
});
