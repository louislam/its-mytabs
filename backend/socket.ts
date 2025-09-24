import { Server } from "socket.io";
import { ServerType } from "@hono/node-server";
import { isDev } from "./util.ts";

function socketIO(httpServer: ServerType) {
    const config: Record<string, object> = {};

    if (isDev()) {
        config["cors"] = {
            origin: "*",
            methods: ["GET", "POST"],
        };
    }

    const io = new Server(httpServer, config);

    const waitMPCTimeout = 2000;

    io.on("connection", (socket) => {
        console.log(`socket ${socket.id} connected`);
        socket.emit("hello", "world");

        socket.on("waitMPC", async (data) => {
            const mpcURL = "http://localhost:13579";

            // See if the URL is reachable
            try {
                const response = await fetch(mpcURL);
                if (response.ok) {
                    socket.emit("mpcStatus", { status: "ready" });
                } else {
                    socket.emit("mpcStatus", { status: "error", message: `MPC not ready, status code: ${response.status}` });
                }
            } catch (error) {
                socket.emit("mpcStatus", { status: "error", message: `MPC not reachable: ${error}` });
            }

            // Play the video on MPC-HC
            try {
                const response = await fetch(`${mpcURL}/command.html?wm_command=889`);
                if (response.ok) {
                    socket.emit("mpcStatus", { status: "playing" });
                } else {
                    socket.emit("mpcStatus", { status: "error", message: `Failed to play video, status code: ${response.status}` });
                }
            } catch (error) {
                socket.emit("mpcStatus", { status: "error", message: `Error playing video: ${error}` });
            }
        });

        socket.on("disconnect", (reason) => {
            console.log(`socket ${socket.id} disconnected due to ${reason}`);
        });
    });

    return io;
}
