import { io } from "socket.io-client";

export function connectSocketIO() {
    return io(getBaseURL());
}

/**
 * Get the base URL
 * Mainly used for dev, because the backend and the frontend are in different ports.
 * @returns Base URL
 */
function getBaseURL(): string {
    const env = process.env.NODE_ENV;
    if (env === "development") {
        return location.protocol + "//" + location.hostname + ":47777";
    } else {
        return "";
    }
}
