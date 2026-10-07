import { assert, assertEquals } from "jsr:@std/assert@^1.0.17";
import { parseAlphaTabBytes } from "./alphatab-parser.ts";

Deno.test("parseAlphaTabBytes rejects unsupported extensions before parsing", async () => {
    const result = await parseAlphaTabBytes(new Uint8Array([1, 2, 3]), "song.gtp");

    assertEquals(result.ok, false);
    assertEquals(result.extension, "gtp");
    if (!result.ok) {
        assertEquals(result.error.category, "unsupported-extension");
        assertEquals(result.error.message, ".gtp is not supported by the current import policy.");
    }
});

Deno.test("parseAlphaTabBytes captures parser errors structurally", async () => {
    const result = await parseAlphaTabBytes(new Uint8Array([1, 2, 3]), "song.gp5");

    assertEquals(result.ok, false);
    assertEquals(result.extension, "gp5");
    if (!result.ok) {
        assert(["unsupported-format", "parser-error"].includes(result.error.category));
        assert(result.error.name.length > 0);
        assert(result.error.message.length > 0);
        assert(result.elapsedMs >= 0);
    }
});

Deno.test("parseAlphaTabBytes rejects files above configured parse limit", async () => {
    const previous = Deno.env.get("MYTABS_MAX_PARSE_BYTES");
    Deno.env.set("MYTABS_MAX_PARSE_BYTES", "2");
    try {
        const result = await parseAlphaTabBytes(new Uint8Array([1, 2, 3]), "song.gp5");

        assertEquals(result.ok, false);
        if (!result.ok) {
            assertEquals(result.error.category, "file-too-large");
            assertEquals(result.error.name, "AlphaTabFileTooLargeError");
        }
    } finally {
        if (previous === undefined) {
            Deno.env.delete("MYTABS_MAX_PARSE_BYTES");
        } else {
            Deno.env.set("MYTABS_MAX_PARSE_BYTES", previous);
        }
    }
});
