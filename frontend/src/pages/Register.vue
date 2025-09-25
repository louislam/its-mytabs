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
            repeatPassword: "",
        };
    },
    async mounted() {
        const res = await fetch(baseURL + "/api/is-finish-setup");
        const isFinishSetup = await res.json();
        if (isFinishSetup) {
            this.$router.push("/");
        }
    },
    methods: {
        async submit() {
            if (this.password !== this.repeatPassword) {
                notify({
                    title: "Passwords do not match",
                    type: "error",
                });
                return;
            }

            this.processing = true;
            const { data, error } = await authClient.signUp.email({
                email: this.email,
                name: "Admin",
                password: this.password,
            });

            if (error) {
                notify({
                    title: error.message,
                    type: "error",
                });
            } else {
                this.$router.push("/");
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

                <p class="mt-3">
                    {{ $t("Create your admin account") }}
                </p>

                <div class="form-floating mt-3">
                    <input id="floatingInput" v-model="email" type="email" class="form-control" :placeholder='$t("Username")' required>
                    <label for="floatingInput">{{ $t("Email") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingPassword" v-model="password" type="password" class="form-control" :placeholder='$t("Password")' required>
                    <label for="floatingPassword">{{ $t("Password") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="repeat" v-model="repeatPassword" type="password" class="form-control" :placeholder='$t("Repeat Password")' required>
                    <label for="repeat">{{ $t("Repeat Password") }}</label>
                </div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ $t("Create") }}
                </button>
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
