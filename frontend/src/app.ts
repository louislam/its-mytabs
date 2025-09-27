import { io } from "socket.io-client";
import { midiProgramCodeList } from "../../backend/common.ts";
import {notify} from "@kyvg/vue3-notification";
import * as alphaTab from '@coderline/alphatab';
import {SettingSchema} from "./zod.ts";

export function connectSocketIO() {
    return io(baseURL);
}

/**
 * Get the base URL
 * Mainly used for dev, because the backend and the frontend are in different ports.
 * @returns Base URL
 */
export function getBaseURL(): string {
    const env = process.env.NODE_ENV;
    if (env === "development") {
        return location.protocol + "//" + location.hostname + ":47777";
    } else {
        return "";
    }
}

export const baseURL = getBaseURL();

export function getInstrumentName(midiProgram: number) {
    return midiProgramCodeList[midiProgram] || "Unknown";
}

export async function checkFetch(res : Response): Promise<void> {
    let data;

    try {
        if (!res.ok) {
            data = await res.json();
            console.log(data)
        }
    } catch (e) {
        console.log(e);
        throw new Error("Failed to fetch without message: " + res.status);
    }

    if (data) {
        if (data.msg) {
            throw new Error(data.msg);
        } else {
            throw new Error(JSON.stringify(data));
        }
    }

    // if response is not in json type
    if (res.headers.get("content-type") !== "application/json") {
        throw new Error("Response is not in JSON format");
    }
}

export function successMessage(msg: string): void {
    notify({
        text: msg,
        type: "success",
    });
}

export function generalError(e: unknown): void {
    if (!(e instanceof Error)) {
        notify({
            text: "Unknown error",
            type: "error",
        });
        console.error("Unknown error", e);
    } else {
        notify({
            text: e.message,
            type: "error",
        });
    }
}

/**
 * @deprecated Need full score.
 * @param alphaTexString
 */
export function convertAlphaTexSyncPoint(alphaTexString: string) {
    const importer = new alphaTab.importer.AlphaTexImporter();
    const settings = new alphaTab.Settings();
    importer.initFromString(alphaTexString, settings);
    const score = importer.readScore();
    return score.exportFlatSyncPoints();
}

export function getSetting() {
    const savedSetting = localStorage.getItem("userSetting");
    try {
        const setting = JSON.parse(savedSetting);
        return SettingSchema.parse(setting);
    } catch (e) {
        return SettingSchema.parse({});
    }
}

export class ActionBuffer {
    delay: number = 2000;
    timer: ReturnType<typeof setTimeout> | null = null;
    action: (() => void) | null = null;

    constructor(delay: number) {
        this.delay = delay;
        this.timer = null;
    }

    run(action : () => void) {
        if (this.timer) {
            //If cold down not finished, place it in buffer
            this.action = action;
            console.log("Action buffered, still in cold down");
        } else {
            // If no timer, run immediately
            action();
            console.log("Action run, start cold down");
            this.timer = setTimeout(() => {
                // Cold down finished, run the buffered action if exists
                if (this.action !== null) {
                    this.action();
                    console.log("Buffered action run after cold down");
                }
                this.timer = null;
                this.action = null;
            }, this.delay);
        }
    }
}
