<script>
import { defineComponent } from "vue";
import { authClient } from "../auth-client.ts";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import Logo from "../components/Logo.vue";

export default defineComponent({
    components: { Logo },
    data() {
        return {
            processing: false,
            email: "",
            password: "",
            rememberMe: true,
            error: "",
        };
    },
    async mounted() {
        const res = await fetch(baseURL + "/api/is-finish-setup");
        const isFinishSetup = await res.json();
        if (!isFinishSetup) {
            this.$router.push("/register");
        }
    },
    methods: {
        async submit() {
            this.processing = true;
            this.error = "";

            const { data, error } = await authClient.signIn.email({
                email: this.email,
                password: this.password,
                rememberMe: this.rememberMe,
            });

            if (error) {
                this.error = error.message;
                notify({
                    title: error.message,
                    type: "error",
                });
            } else {
                this.$router.push("/");
                notify({
                    title: "Logged in successfully",
                });
            }

            this.processing = false;
        },
    },
});
</script>

<template>
    <div class="form-container" data-cy="setup-form">
        <div class="form">
            <form @submit.prevent="submit">
                <div style="font-size: 28px; font-weight: bold" class="mb-5 mt-5">
                    It's MyTabs
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingInput" v-model="email" type="email" class="form-control" :placeholder='$t("Username")' required>
                    <label for="floatingInput">{{ $t("Email") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingPassword" v-model="password" type="password" class="form-control" :placeholder='$t("Password")' required>
                    <label for="floatingPassword">{{ $t("Password") }}</label>
                </div>

                <!-- Remember me -->
                <div class="mt-3">
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" id="rememberMe" type="checkbox" v-model="rememberMe">
                        <label class="form-check-label" for="rememberMe">
                            {{ $t("Remember me") }}
                        </label>
                    </div>
                </div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ $t("Log in") }}
                </button>

                <div class="error text-danger mt-3" v-if="error">
                    {{ error }}
                </div>
            </form>
        </div>
    </div>
</template>

<style scoped lang="scss">
.form-container {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
}

.form {
    width: 100%;
    max-width: 330px;
    padding: 15px;
    margin: auto;
    text-align: center;
}
</style>
