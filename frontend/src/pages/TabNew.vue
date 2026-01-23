<script>
import { defineComponent } from "vue";
import Vue3Dropzone from "@jaxtheprime/vue3-dropzone";
import "@jaxtheprime/vue3-dropzone/dist/style.css";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import { supportedFormatCommaString } from "../../../backend/common.js";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    components: { Vue3Dropzone },
    data() {
        return {
            files: [],
            supportedFormatCommaString,
            isUploading: false,
        };
    },
    methods: {
        async upload() {
            if (this.files.length === 0) {
                notify({ text: "Please select at least one file to upload", type: "error" });
                return;
            }

            this.isUploading = true;

            const uploadPromises = this.files.map(async (f) => {
                try {
                    const file = f.file;
                    // Try to parse the file with AlphaTab to ensure it's valid
                    const data = await file.arrayBuffer();

                    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
                        new Uint8Array(data),
                        new alphaTab.Settings(),
                    );

                    // Upload to /api/new-tab
                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("title", score.title);
                    formData.append("artist", score.artist);

                    const res = await fetch(baseURL + "/api/new-tab", {
                        method: "POST",
                        credentials: "include",
                        body: formData,
                    });

                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(errorData.msg || "Upload failed");
                    }

                    const respData = await res.json();
                    notify({ text: `Uploaded: ${score.artist} - ${score.title}`, type: "success" });
                    return respData.id;
                } catch (err) {
                    notify({ text: `Error with ${f.name}: ${err.message}`, type: "error" });
                    return null;
                }
            });

            const results = await Promise.all(uploadPromises);

            const firstId = results.find((id) => id !== null);
            if (firstId) {
                this.$router.push(`/tab/${firstId}`);
            }

            // Reset Dropzone
            this.isUploading = false;
        },
        dropzoneError(err) {
            console.log(err);
            notify({ text: err.type || "Dropzone error", type: "error" });
        },

        async createEmpty(type) {
            this.isUploading = true;
            try {
                const res = await fetch(baseURL + `/api/new-tab/template/${type}`, {
                    method: "POST",
                    credentials: "include",
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.msg || "Failed to create tab from template");
                }

                const data = await res.json();
                notify({ text: `Created ${type} tab`, type: "success" });
                if (data.id) {
                    this.$router.push(`/tab/${data.id}`);
                }
            } catch (e) {
                notify({ text: e.message || "Unknown error", type: "error" });
            } finally {
                this.isUploading = false;
            }
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <div class="display-6 mb-4 mt-5">Upload Guitar Pro or MusicXML files</div>

        <Vue3Dropzone
            v-model="files"
            :maxFileSize="500"
            :multiple="true"
            :maxFiles="10"
            @error="dropzoneError"
        >
            <template #title>Drop your tabs here</template>
            <template #description>Supports {{ supportedFormatCommaString }}</template>
        </Vue3Dropzone>

        <button
            @click="upload"
            class="btn btn-primary w-100 mt-4"
            :disabled="isUploading"
        >
            {{ isUploading ? "Uploading..." : "Upload" }}
        </button>

        <ul class="mt-3">
            <li>
                <a href="#" @click.prevent='createEmpty("bass")' class="me-3">Create Empty Bass Tab</a>
            </li>
            <li>
                <a href="#" @click.prevent='createEmpty("guitar")'>Create Empty Guitar Tab</a>
            </li>
        </ul>

        <div></div>

        <h4 class="mt-5">Free Resources</h4>

        <ul class="free-resources">
            <li><a href="https://www.ultimate-guitar.com/" target="_blank" rel="noopener">Ultimate Guitar</a><br />Some free tabs in *.gp format</li>
            <li><a href="https://www.911tabs.com/" target="_blank" rel="noopener">911Tabs</a><br />Search engine for tabs</li>
            <li>
                <a href="https://musescore.com/sheetmusic?instrument=72%2C73&recording_type=free-download" target="_blank" rel="noopener">MuseScore (Free Download filtered)</a><br />Some free tabs in
                MusicXML format
            </li>
            <li><a href="https://gprotab.net/" target="_blank" rel="noopener">GProTab</a><br />Free Guitar Pro tabs in *.gp format</li>
        </ul>
    </div>
</template>

<style lang="scss">
.img-details {
    opacity: 1 !important;
    visibility: visible !important;
}

.free-resources li {
    margin-bottom: 15px;
}
</style>
