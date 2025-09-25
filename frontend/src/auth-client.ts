import { createAuthClient } from "better-auth/vue";
import { baseURL } from "./app.ts";

export const authClient = createAuthClient({
    baseURL: baseURL,
});

export async function isLoggedIn() {
    const session = await authClient.getSession();
    return session.data !== null;
}
