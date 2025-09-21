<script lang="ts">
import {defineComponent} from 'vue'
import {  BButton, BButtonGroup, BFormInput, BSpinner } from "bootstrap-vue-next";

export default defineComponent({
    components: {
        BButton,
        BButtonGroup,
        BFormInput,
        BSpinner
    },
})
</script>

<template>
    <div class="container-fluid">
        <div class="my-navbar">
            <router-link class="navbar-brand" to="/">
                It's MyTabs
            </router-link>

            <!-- Toolbar -->
            <div class="toolbar">
                <router-link to="/">
                    <font-awesome-icon :icon='["fas", "folder"]' /> My Tabs
                </router-link>

                <router-link to="/">
                    <font-awesome-icon :icon='["fas", "file"]' /> New Tab
                </router-link>

                <router-link to="/">
                    <font-awesome-icon :icon='["fas", "gear"]' /> Settings
                </router-link>
            </div>
            
        </div>
        
        <router-view />
    </div>
</template>

<style lang="scss" scoped>

.my-navbar {
    padding: 20px 30px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    column-gap: 10px;
    // backdrop-filter: blur(10px);
    border-bottom: 1px solid #3C3B40;

    [data-bs-theme="light"] & {
        border-bottom-color: #dadada;
    }
    
    .toolbar {
        flex-grow: 4;
        display: flex;
        column-gap: 30px;
        
        // from right
        justify-content: flex-end;
        
        svg {
            color: #3C3B40;
        }
    }
}

</style>
