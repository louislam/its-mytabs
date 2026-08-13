import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, login, STEM_EXAMPLE_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

const SEPARATE_BUTTON = "Separate Bass/Drums/Guitar";
const MUTE_BASS_BUTTON = "Mute Bass";
const MUTE_GUITAR_BUTTON = "Mute Guitar";

test.describe("separate audio into stems", () => {
    test("separate button is hidden for already-separated stem files", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto(`/tab/${TAB_ID}/edit/audio`);

        const items = page.locator(".audio-item");
        await expect(items.filter({ hasText: AUDIO_FILENAME })).toBeVisible();

        // Non-stem files show the button...
        const buttons = page.getByRole("button", { name: SEPARATE_BUTTON });
        await expect(buttons).toHaveCount(2);

        // ...but the file that looks like a separated stem does not
        const stemItem = items.filter({ hasText: STEM_EXAMPLE_FILENAME });
        await expect(stemItem).toBeVisible();
        await expect(stemItem.getByRole("button", { name: SEPARATE_BUTTON })).toHaveCount(0);
        await expect(stemItem.getByRole("button", { name: MUTE_BASS_BUTTON })).toHaveCount(0);
        await expect(stemItem.getByRole("button", { name: MUTE_GUITAR_BUTTON })).toHaveCount(0);
    });

    test("mute buttons appear on non-stem audio files", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto(`/tab/${TAB_ID}/edit/audio`);

        const item = page.locator(".audio-item").filter({ hasText: AUDIO_FILENAME });
        await expect(item).toBeVisible();
        await expect(item.getByRole("button", { name: MUTE_BASS_BUTTON })).toBeVisible();
        await expect(item.getByRole("button", { name: MUTE_GUITAR_BUTTON })).toBeVisible();
    });

    test("runs the full separation flow with progress", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto(`/tab/${TAB_ID}/edit/audio`);

        const item = page.locator(".audio-item").filter({ hasText: AUDIO_FILENAME });
        await expect(item).toBeVisible();

        // Skip when the Demucs model is not installed (e.g. CI without a model file)
        const status = await (await page.request.get("/api/separate/status")).json();
        test.skip(status.modelInstalled !== true, "Demucs model not installed, skipping separation completion");

        // Accept the "may take a while / high CPU" warning dialog
        page.once("dialog", (dialog) => dialog.accept());
        await item.getByRole("button", { name: SEPARATE_BUTTON }).click();

        // A progress bar appears and all separate buttons are disabled while running
        const buttons = page.getByRole("button", { name: SEPARATE_BUTTON });
        await expect(item.locator(".separate-progress")).toBeVisible();
        await expect(buttons).toHaveCount(2);
        for (const button of await buttons.all()) {
            await expect(button).toBeDisabled();
        }

        // Wait for the completion notification
        await expect(page.locator(".notification-content", { hasText: "Separation completed" })).toBeVisible({
            timeout: 180_000,
        });

        // The three stem files appear in the audio list, without separate buttons
        for (const stem of ["bass", "drums", "guitar"]) {
            const stemName = AUDIO_FILENAME.replace(".ogg", `_${stem}.ogg`);
            const stemItem = page.locator(".audio-item").filter({ hasText: stemName });
            await expect(stemItem).toBeVisible();
            await expect(stemItem.getByRole("button", { name: SEPARATE_BUTTON })).toHaveCount(0);
        }

        // The original (non-stem) files still show the button, now enabled again
        await expect(buttons).toHaveCount(2);
        for (const button of await buttons.all()) {
            await expect(button).toBeEnabled();
        }
    });

    test("asks for consent before downloading the AI model", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto(`/tab/${TAB_ID}/edit/audio`);

        const item = page.locator(".audio-item").filter({ hasText: AUDIO_FILENAME });
        await expect(item).toBeVisible();

        // Fake "model not installed" so the consent dialog is shown
        await page.route("**/api/separate/status", (route) => {
            route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({ ok: true, busy: false, modelInstalled: false, ortInstalled: false, job: null }),
            });
        });

        // Handle the dialogs: accept the time/CPU warning, dismiss the model
        // consent. Dialog handling is asynchronous, so accept/dismiss may race
        // with Playwright's own auto-dismiss and must not throw.
        const messages: string[] = [];
        page.on("dialog", (dialog) => {
            messages.push(dialog.message());
            if (dialog.message().includes("may take a few minutes")) {
                dialog.accept().catch(() => {});
            } else {
                dialog.dismiss().catch(() => {});
            }
        });

        await item.getByRole("button", { name: SEPARATE_BUTTON }).click();

        // The consent dialog was shown, listing the model to download
        await expect.poll(() => messages.some((m) => m.includes("htdemucs_6s_fp16weights.onnx"))).toBe(true);

        // No job was started: no progress bar, buttons still enabled
        await expect(page.locator(".separate-progress")).toHaveCount(0);
        const buttons = page.getByRole("button", { name: SEPARATE_BUTTON });
        await expect(buttons).toHaveCount(2);
        for (const button of await buttons.all()) {
            await expect(button).toBeEnabled();
        }
    });
});
