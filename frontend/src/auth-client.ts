import { createAuthClient } from "better-auth/vue";
import { baseURL } from "./app.ts";

export const authClient = createAuthClient({
    baseURL: baseURL,
});

export async function isLoggedIn() {
    if (window.authDisabled === true) {
        return true;
    }

    const session = await authClient.getSession();
    return session.data !== null;
}
