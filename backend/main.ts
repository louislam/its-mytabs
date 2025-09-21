import { serve } from "@hono/node-server";
import { Hono } from "@hono/hono";
import { Server } from "socket.io";
import process from "node:process";
import sanitize from "sanitize-filename";

const userInput = ".././"; // Example of potentially unsafe user input
const filename = sanitize(userInput);
console.log(`Sanitized filename: ${filename}`);

export async function main() {
    const app = new Hono();

    const httpServer = serve({
        fetch: app.fetch,
        port: 47777,
    }, (info) => {
        console.log(`Server running on http://localhost:${info.port}`);
    });


    const config : Record<string, object> = {};

    if (isDev()) {
        config["cors"] = {
            origin: "*",
            methods: ["GET", "POST"],
        };
    }

    const io = new Server(httpServer, config);

    app.get("/", (c) => {
        return c.text("Hello, Hono with Socket.IO!");
    });

    io.on("connection", (socket) => {
        console.log(`socket ${socket.id} connected`);
        socket.emit("hello", "world");
        socket.on("disconnect", (reason) => {
            console.log(`socket ${socket.id} disconnected due to ${reason}`);
        });
    });
}

export function isDev() {
    return process.env.NODE_ENV === "development";
}

if (import.meta.main) {
    await main();
}
