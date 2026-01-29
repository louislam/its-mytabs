<script>
import { defineComponent } from "vue";
import { BButton, BButtonGroup, BFormInput, BSpinner } from "bootstrap-vue-next";
import { authClient, isLoggedIn } from "../auth-client.ts";
import { notify } from "@kyvg/vue3-notification";
import Logo from "../components/Logo.vue";

export default defineComponent({
    components: {
        BButton,
        BButtonGroup,
        BFormInput,
        BSpinner,
        Logo,
    },
    data() {
        return {
            isLoggedIn: false,
            ready: false,
            fixedNavbar: false,
        };
    },
    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.ready = true;
    },
    watch: {
        $route() {
            this.fixedNavbar = false;
        },
    },
    methods: {
        async signOut() {
            const res = await authClient.signOut();
            this.$router.push("/login");
        },
        onSetFixedHeader(val) {
            this.fixedNavbar = val;
        },
    },
});
</script>

<template>
    <div
        :class='
            {
                "fixed-navbar": fixedNavbar,
            }
        '
    >
        <div class="my-navbar">
            <Logo />

            <div class="toolbar">
                <div class="left" v-show="ready">
                    <router-link to="/" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "folder"]' />
                        Tabs
                    </router-link>

                    <router-link to="/new-tab" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "plus"]' />
                        New Tab
                    </router-link>

                    <router-link to="/settings">
                        <font-awesome-icon :icon='["fas", "gear"]' />
                        Settings
                    </router-link>
                </div>

                <div class="right" v-show="ready">
                    <a href="#" @click.prevent="signOut()" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "arrow-right-from-bracket"]' />
                        Log out
                    </a>

                    <router-link to="/login" v-else>
                        <font-awesome-icon :icon='["fas", "arrow-right-to-bracket"]' />
                        Log in
                    </router-link>
                </div>
            </div>
        </div>

        <router-view v-slot="{ Component }">
            <component :is="Component" @setFixedHeader="onSetFixedHeader" />
        </router-view>
    </div>
</template>

<style lang="scss" scoped>
@import "../styles/vars.scss";

$navHeight: 100px;

.fixed-navbar {
    .my-navbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        width: 100vw;
        margin-bottom: 0;
        background-color: #212529;
    }
}

.my-navbar {
    height: $navHeight;
    border-bottom: 1px solid #3c3b40;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 20px;

    [data-bs-theme="light"] & {
        border-bottom-color: #dadada;
    }

    .toolbar {
        padding: 0 30px 0 40px;
        flex: 1;
        display: flex;
        justify-content: space-between;

        & > div {
            flex-grow: 4;
            display: flex;
            column-gap: 50px;

            &.left {
                justify-content: flex-start;
            }

            &.right {
                justify-content: flex-end;
            }

            & > a {
                display: flex;
                align-items: center;
                justify-content: center;

                // item from top to bottom
                flex-direction: column;
            }
        }

        svg {
            font-size: 20px;
        }
    }
}

.fixed-navbar {
    padding-top: $navHeight + 20px;
}

.mobile {
    $navHeightMobile: 75px;

    .my-navbar {
        height: $navHeightMobile;

        .navbar-brand {
            width: $navHeightMobile;
            height: $navHeightMobile;
            font-size: 15px;
        }

        .toolbar {
            padding: 0 0 0 10px;

            & > div {
                column-gap: 10px;
            }
        }
    }

    .fixed-navbar {
        padding-top: $navHeightMobile + 20px;
    }
}
</style>
