import { io } from "socket.io-client";
import { midiProgramCodeList } from "../../backend/common.ts";

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
    return midiProgramCodeList[midiProgram] || "(Unknown Instrument)";
}
