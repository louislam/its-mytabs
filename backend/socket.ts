import { Server, ServerOptions, Socket } from "socket.io";
import { ServerType } from "@hono/node-server";
import {devOriginList, isDev} from "./util.ts";
import {auth} from "./auth.ts";

export function socketIO(httpServer: ServerType) {
    const config: Partial<ServerOptions> = {};

    if (isDev()) {
        config["cors"] = {
            origin: devOriginList,
            credentials: true,
            methods: ["GET", "POST"],
        };
    }

    config.cookie = true;
    const io = new Server(httpServer, config);

    const tabPlayerList: Record<string, Socket> = {};
    const controllerList: Record<string, Socket> = {};

    io.on("connection", async (socket) => {
        const clientType = socket.handshake.query.clientType;
        console.log(`socket ${socket.id} connected, client type:`, clientType);

        let session;

        // Get Auth Session
        if (clientType === "tabPlayer") {
            const context = {
                headers: new Headers(),
            };
            context.headers.set("cookie", socket.request.headers.cookie || "");
            session = await auth.api.getSession(context);
        } else if (clientType === "controller") {

            try {
                const email = socket.handshake.query.email as string;
                const password = socket.handshake.query.password as string;
                session = await auth.api.signInEmail({
                    body: {
                        email: email,
                        password: password,
                    }
                })
            } catch (e) {
                // Sign in failed, could be wrong email format
            }
        }

        if (session) {
            if (clientType === "tabPlayer") {
                tabPlayerList[socket.id] = socket;
                console.log("Tab Player connected. Total:", Object.keys(tabPlayerList).length);

            } else if (clientType === "controller") {
                controllerList[socket.id] = socket;
                console.log("Controller connected. Total:", Object.keys(controllerList).length);
            }

            // Play
            socket.on("play", () => {
                for (const id in tabPlayerList) {
                    tabPlayerList[id].emit("play");
                }
            });

            // Pause
            socket.on("pause", () => {
                for (const id in tabPlayerList) {
                    tabPlayerList[id].emit("pause");
                }
            });

            // Seek
            socket.on("seek", (position: number) => {
                for (const id in tabPlayerList) {
                    tabPlayerList[id].emit("seek", position);
                }
            });

            socket.on("disconnect", (reason) => {
                if (clientType === "tabPlayer") {
                    delete tabPlayerList[socket.id];
                    console.log("Tab Player disconnected. Total:", Object.keys(tabPlayerList).length);
                } else if (clientType === "controller") {
                    delete controllerList[socket.id];
                    console.log("Controller disconnected. Total:", Object.keys(controllerList).length);
                }
            });
        } else {
            // Disconnect the socket if not authenticated
            socket.disconnect();
        }
    });

    return io;
}
