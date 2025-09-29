<script>
import { defineComponent } from "vue";

export default defineComponent({
    props: {
        syncMethod: {
            type: String,
            default: null,
        },
        simpleSync: {
            type: Number,
            default: 0,
        },
        advancedSync: {
            type: String,
            default: "",
        },
    },
    emits: ["update:syncMethod", "update:simpleSync", "update:advancedSync"],
    data() {
        return {
            syncMethodInternal: null,
            simpleSyncInternal: 0,
            simpleSyncSecond: 0,
            advancedSyncInternal: "",
        };
    },
    watch: {
        syncMethodInternal(newMethod) {
            this.$emit("update:syncMethod", newMethod);
        },
        simpleSyncInternal(newSimpleSync) {
            this.$emit("update:simpleSync", newSimpleSync);
        },
        advancedSyncInternal(newAdvancedSync) {
            this.$emit("update:advancedSync", newAdvancedSync);
        },
        simpleSyncSecond(newSecond) {
            this.simpleSyncInternal = newSecond * 1000;
        },
    },
    mounted() {
        this.syncMethodInternal = this.syncMethod;
        this.simpleSyncInternal = this.simpleSync;
        this.advancedSyncInternal = this.advancedSync;
        
        this.simpleSyncSecond = this.simpleSyncInternal / 1000;
    },
});
</script>

<template>
    <div>
        <select class="form-control mb-3" v-model="syncMethodInternal">
            <option value="simple">Simple Sync</option>
            <option value="advanced">Advanced Sync</option>
        </select>

        <div v-if='syncMethodInternal === "simple"' class="mb-3">
            1st Bar Start Point (start at {{ simpleSyncSecond }} second)

            <div class="my-2 text-info">
                Perfect for songs with a consistent tempo and the tab have a correct bpm.
            </div>

            <input type="number" class="form-control" step="0.1" v-model="simpleSyncSecond">
        </div>

        <div v-if='syncMethodInternal === "advanced"' class="mb-3">
            Advanced Sync Points

            <div class="my-2 text-info">
                <p>
                    You can use this to sync the song bar by bar.
                </p>
                <p>
                    \sync {Bar} {Occurence} {Offset}
                </p>
                <ul>
                    <li>Bar: 0 is the first bar</li>
                    <li>Offset: In milliseconds (ms) (1000ms = 1s)</li>
                </ul>
                <p>Visual Tool: <a href="https://alphatab.net/docs/playground" target="_blank">https://alphatab.net/docs/playground</a>, and generate alphaTex Sync Points.</p>
            </div>

            <textarea
                class="form-control"
                rows="10"
                v-model="advancedSyncInternal"
                :placeholder='
                    "Example:\n" +
                        "\\sync 0 0 36\n" +
                        "\\sync 16 0 35425"
                '
            >
                            </textarea>
        </div>
    </div>
</template>

<style scoped lang="scss">
</style>
