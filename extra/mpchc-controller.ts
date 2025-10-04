import { io } from "npm:socket.io-client@~4.8.1";
import * as cheerio from 'npm:cheerio@~1.1.2';
import "@std/dotenv/load";

const host = Deno.env.get("MYTABS_HOST") || "localhost";
const port = Deno.env.get("MYTABS_PORT") ? parseInt(Deno.env.get("MYTABS_PORT")!) : 47777;

const email = Deno.env.get("MYTABS_MPCHC_EMAIL");
const password = Deno.env.get("MYTABS_MPCHC_PASSWORD");
const mpchcBaseURL = Deno.env.get("MYTABS_MPCHC_BASE_URL") || "http://localhost:13579";
const baseURL = `http://${host}:${port}`;
const checkTime = 50;
const slowCheckTime = 2000;
let isSlow = false;
let offsetList: Record<string, number> = {};

try {
    offsetList = JSON.parse(await Deno.readTextFile("./data/offset.json"));
} catch (e) {
}


console.log("Connecting to server at", baseURL);

let interval: number | undefined = undefined;
let currentState = {
    state: "Unknown",
    position: -1,
};

const socket = io(baseURL, {
    query: {
        clientType: "controller",
        email,
        password,
    }
});

socket.on("connect", async () => {
    console.log("Connected to server");
    createInterval(checkTime);
});

socket.on("disconnect", (reason) => {
    console.log("Disconnected from server:", reason);
    if (interval) {
        clearInterval(interval);
        interval = undefined;
    }
});

function createInterval(ms: number) {
    if (interval) {
        clearInterval(interval);
        interval = undefined;
    }

    interval = setInterval(async () => {
        try {
            const state = await getMPCHCStatus();
            //console.log(state);

            // If state changed, send to server
            if (currentState.state !== state.state) {
                if (state.state === "Playing") {
                    socket.emit("play");
                    //createInterval(200);
                } else {
                    socket.emit("pause");
                    //createInterval(2000);
                }
                socket.emit("seek", state.position);
            }

            if (state.state !== "Playing") {
                if (currentState.position !== state.position) {
                    socket.emit("seek", state.position);
                }
            }

            currentState = state;

            if (isSlow) {
                console.log("MPC-HC is running");
                createInterval(checkTime);
                isSlow = false;
            }

        } catch (e) {
            if (!isSlow) {
                console.error("MPC-HC is not running");
                createInterval(slowCheckTime);
                isSlow = true;
            }
        }
    }, ms);
}

async function getMPCHCStatus() {
    const res = await fetch(`${mpchcBaseURL}/variables.html`);
    if (!res.ok) {
        throw new Error("Failed to fetch MPCHC variables");
    }
    const text = await res.text();
    const $ = cheerio.load(text);
    const file = $("#file").text();

    return {
        state: $("#statestring").text(),
        position: parseInt($("#position").text()) - (offsetList[file] || 0),
    }
}
