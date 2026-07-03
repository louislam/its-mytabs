import { assertEquals } from "jsr:@std/assert@^1.0.17";
import { Hono } from "@hono/hono";
import { routeError } from "./route-errors.ts";

Deno.test("routeError hides unexpected error messages", async () => {
    const originalError = console.error;
    console.error = () => {};
    const app = new Hono();
    try {
        app.get("/boom", (c) =>
            routeError(c, new Error("database exploded with private detail"), {
                logPrefix: "Test route failed",
                fallbackMessage: "Request failed.",
            }));

        const response = await app.request("/boom");
        const body = await response.json();
        assertEquals(response.status, 500);
        assertEquals(body, { ok: false, msg: "Request failed." });
    } finally {
        console.error = originalError;
    }
});

Deno.test("routeError keeps known client errors actionable", async () => {
    const app = new Hono();
    app.get("/bad-request", (c) =>
        routeError(c, new Error('Cannot scan import job with status "completed".'), {
            logPrefix: "Test route failed",
            fallbackMessage: "Request failed.",
        }));

    const response = await app.request("/bad-request");
    const body = await response.json();
    assertEquals(response.status, 400);
    assertEquals(body, { ok: false, msg: 'Cannot scan import job with status "completed".' });
});
