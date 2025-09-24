import { io } from "socket.io-client";

export function connectSocketIO() {
    return io(baseURL());
}

/**
 * Get the base URL
 * Mainly used for dev, because the backend and the frontend are in different ports.
 * @returns Base URL
 */
export function baseURL(): string {
    const env = process.env.NODE_ENV;
    if (env === "development") {
        return location.protocol + "//" + location.hostname + ":47777";
    } else {
        return "";
    }
}
