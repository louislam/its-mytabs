<script>
import { defineComponent } from "vue";
import Vue3Dropzone from "@jaxtheprime/vue3-dropzone";
import "@jaxtheprime/vue3-dropzone/dist/style.css";
import { notify } from "@kyvg/vue3-notification";
import { baseURL, checkFetch, generalError, successMessage } from "../app.js";
import { bulkUpdateImportItems, commitImportJob, createImportJob, getImportJob, getImportReport, listImportItems, startImportScan, updateImportItem } from "../import-client.js";
import { supportedFormatCommaString } from "../../../backend/common.js";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    components: { Vue3Dropzone },
    data() {
        return {
            mode: "upload",
            files: [],
            supportedFormatCommaString,
            isUploading: false,
            sourcePath: "",
            groupingMode: "auto",
            importJob: null,
            importItemsPage: null,
            importReport: null,
            isStartingScan: false,
            isLoadingReview: false,
            isApplyingBulk: false,
            isCommitting: false,
            pollTimer: null,
            reviewFilters: {
                search: "",
                status: "",
                selected: "",
                duplicate: "",
                sort: "artist-title",
            },
            reviewPage: 1,
            reviewPageSize: 25,
            reviewMode: "grouped",
            bulkDecision: "manual_skip",
            editingMetadataIds: {},
            metadataEditOriginals: {},
        };
    },
    computed: {
        importItems() {
            return this.importItemsPage?.items || [];
        },

        groupedReviewItems() {
            const groups = new Map();
            for (const item of this.importItems) {
                const artist = item.suggestedArtist || item.parsedArtist || "Unknown Artist";
                const album = item.suggestedAlbum || item.parsedAlbum || "No album";
                const key = `${artist}\u0000${album}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        key,
                        artist,
                        album,
                        items: [],
                    });
                }
                groups.get(key).items.push(item);
            }
            return Array.from(groups.values());
        },

        reviewTotalPages() {
            if (!this.importItemsPage || this.importItemsPage.total === 0) {
                return 1;
            }
            return Math.ceil(this.importItemsPage.total / this.reviewPageSize);
        },

        selectedVisibleCount() {
            return this.importItems.filter((item) => item.selected).length;
        },

        importProgressPercent() {
            if (!this.importJob || this.importJob.totalCount === 0) {
                return 0;
            }
            const processed = this.importJob.importedCount + this.importJob.skippedCount + this.importJob.failedCount;
            return Math.min(100, Math.round((processed / this.importJob.totalCount) * 100));
        },

        canReview() {
            return this.importJob && ["ready_for_review", "committing", "completed", "failed"].includes(this.importJob.status);
        },

        canCommit() {
            return this.importJob?.status === "ready_for_review" && this.importItemsPage && this.importItemsPage.total > 0;
        },
    },
    beforeUnmount() {
        this.clearPoll();
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
                    const data = await file.arrayBuffer();

                    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
                        new Uint8Array(data),
                        new alphaTab.Settings(),
                    );

                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("title", score.title);
                    formData.append("artist", score.artist);

                    const res = await fetch(baseURL + "/api/new-tab", {
                        method: "POST",
                        credentials: "include",
                        body: formData,
                    });

                    await checkFetch(res);
                    const respData = await res.json();
                    successMessage(`Uploaded: ${score.artist} - ${score.title}`);
                    return respData.id;
                } catch (err) {
                    generalError(new Error(`Error with ${f.name}: ${err.message}`));
                    return null;
                }
            });

            const results = await Promise.all(uploadPromises);

            const firstId = results.find((id) => id !== null);
            if (firstId) {
                this.$router.push(`/tab/${firstId}`);
            }

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

                await checkFetch(res);
                const data = await res.json();
                successMessage(`Created ${type} tab`);
                if (data.id) {
                    this.$router.push(`/tab/${data.id}`);
                }
            } catch (e) {
                generalError(e);
            } finally {
                this.isUploading = false;
            }
        },

        async startServerFolderImport() {
            if (!this.sourcePath.trim()) {
                notify({ text: "Server folder path is required", type: "error" });
                return;
            }

            this.clearPoll();
            this.isStartingScan = true;
            this.importJob = null;
            this.importItemsPage = null;
            this.importReport = null;

            try {
                let job = await createImportJob({
                    rootPath: this.sourcePath.trim(),
                    groupingMode: this.groupingMode,
                });
                this.importJob = job;
                job = await startImportScan(job.id);
                this.importJob = job;
                successMessage("Import scan started");
                this.startJobPolling("scan");
                if (this.canReview) {
                    await this.loadReviewItems();
                }
            } catch (e) {
                generalError(e);
            } finally {
                this.isStartingScan = false;
            }
        },

        async loadReviewItems() {
            if (!this.importJob) {
                return;
            }
            this.isLoadingReview = true;
            try {
                this.importItemsPage = await listImportItems(this.importJob.id, {
                    ...this.currentReviewFilters(),
                    limit: this.reviewPageSize,
                    offset: (this.reviewPage - 1) * this.reviewPageSize,
                });
            } catch (e) {
                generalError(e);
            } finally {
                this.isLoadingReview = false;
            }
        },

        async applyFilters() {
            this.reviewPage = 1;
            await this.loadReviewItems();
        },

        async clearFilters() {
            this.reviewFilters = {
                search: "",
                status: "",
                selected: "",
                duplicate: "",
                sort: "artist-title",
            };
            await this.applyFilters();
        },

        async setReviewPage(page) {
            this.reviewPage = Math.min(Math.max(page, 1), this.reviewTotalPages);
            await this.loadReviewItems();
        },

        async updateItemSelection(item, selected) {
            const previous = item.selected;
            item.selected = selected;
            try {
                await this.applyBulkUpdate({
                    action: selected ? "select" : "deselect",
                    itemIds: [item.id],
                }, false);
            } catch (e) {
                item.selected = previous;
                generalError(e);
            }
        },

        async updateItemDecision(item) {
            try {
                const updated = await updateImportItem(this.importJob.id, item.id, {
                    decision: item.decision,
                });
                Object.assign(item, updated);
            } catch (e) {
                generalError(e);
            }
        },

        rememberMetadataValue(item, field) {
            this.metadataEditOriginals[`${item.id}:${field}`] = item[field] ?? "";
        },

        async updateItemMetadata(item, field) {
            if (!this.importJob) {
                return;
            }

            const originalKey = `${item.id}:${field}`;
            const originalValue = this.metadataEditOriginals[originalKey] ?? "";
            const trimmedValue = String(item[field] ?? "").trim();

            if (trimmedValue === String(originalValue).trim()) {
                return;
            }

            if ((field === "suggestedArtist" || field === "suggestedTitle") && trimmedValue.length === 0) {
                notify({ text: "Artist and title are required for import metadata", type: "error" });
                item[field] = originalValue || null;
                return;
            }

            this.editingMetadataIds = {
                ...this.editingMetadataIds,
                [item.id]: true,
            };

            try {
                const updated = await updateImportItem(this.importJob.id, item.id, {
                    [field]: trimmedValue,
                });
                Object.assign(item, updated);
                this.metadataEditOriginals[originalKey] = updated[field] ?? "";
            } catch (e) {
                item[field] = originalValue || null;
                generalError(e);
            } finally {
                const next = { ...this.editingMetadataIds };
                delete next[item.id];
                this.editingMetadataIds = next;
            }
        },

        async bulkSelectVisible(selected) {
            await this.applyBulkUpdate({
                action: selected ? "select" : "deselect",
                itemIds: this.importItems.map((item) => item.id),
            }, true);
        },

        async bulkSelectMatching(selected) {
            await this.applyBulkUpdate({
                action: selected ? "select" : "deselect",
                allMatching: true,
                filters: this.currentReviewFilters(),
            }, true);
        },

        async bulkSetDecision() {
            await this.applyBulkUpdate({
                action: "set-decision",
                itemIds: this.importItems.filter((item) => item.selected).map((item) => item.id),
                decision: this.bulkDecision,
            }, true);
        },

        async applyBulkUpdate(payload, reload) {
            if (!this.importJob) {
                return;
            }
            this.isApplyingBulk = true;
            try {
                const page = await bulkUpdateImportItems(this.importJob.id, payload);
                this.importItemsPage = page;
                if (reload) {
                    await this.loadReviewItems();
                }
            } finally {
                this.isApplyingBulk = false;
            }
        },

        async startCommit() {
            if (!this.importJob) {
                return;
            }
            const ok = window.confirm("Commit selected import items now?");
            if (!ok) {
                return;
            }

            this.isCommitting = true;
            this.importReport = null;
            try {
                this.importJob = await commitImportJob(this.importJob.id);
                successMessage("Import commit started");
                this.startJobPolling("commit");
            } catch (e) {
                generalError(e);
                this.isCommitting = false;
            }
        },

        async loadImportReport() {
            if (!this.importJob) {
                return;
            }
            try {
                this.importReport = await getImportReport(this.importJob.id);
            } catch (e) {
                generalError(e);
            }
        },

        startJobPolling(kind) {
            this.clearPoll();
            this.pollTimer = window.setInterval(async () => {
                if (!this.importJob) {
                    this.clearPoll();
                    return;
                }
                try {
                    this.importJob = await getImportJob(this.importJob.id);
                    if (kind === "scan" && this.canReview) {
                        this.clearPoll();
                        await this.loadReviewItems();
                    }
                    if (kind === "commit" && ["completed", "failed", "canceled"].includes(this.importJob.status)) {
                        this.clearPoll();
                        this.isCommitting = false;
                        await this.loadReviewItems();
                        await this.loadImportReport();
                    }
                } catch (e) {
                    this.clearPoll();
                    this.isCommitting = false;
                    generalError(e);
                }
            }, 1500);
        },

        clearPoll() {
            if (this.pollTimer) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },

        currentReviewFilters() {
            return {
                search: this.reviewFilters.search,
                status: this.reviewFilters.status,
                selected: this.reviewFilters.selected,
                duplicate: this.reviewFilters.duplicate,
                sort: this.reviewFilters.sort,
            };
        },

        itemTitle(item) {
            return item.suggestedTitle || item.parsedTitle || "Untitled";
        },

        itemArtist(item) {
            return item.suggestedArtist || item.parsedArtist || "Unknown Artist";
        },

        itemAlbum(item) {
            return item.suggestedAlbum || item.parsedAlbum || "";
        },

        duplicateLabel(item) {
            if (item.duplicateTabFileId) {
                return "Exact file";
            }
            if (item.probableDuplicateSongId) {
                return "Probable song";
            }
            if (item.existingTabId) {
                return "Existing tab";
            }
            return "New";
        },

        duplicateClass(item) {
            if (item.duplicateTabFileId) {
                return "text-bg-danger";
            }
            if (item.probableDuplicateSongId || item.existingTabId) {
                return "text-bg-warning";
            }
            return "text-bg-success";
        },

        confidenceClass(confidence) {
            if (confidence >= 0.75) {
                return "text-bg-success";
            }
            if (confidence >= 0.45) {
                return "text-bg-warning";
            }
            return "text-bg-danger";
        },

        formatConfidence(confidence) {
            return `${Math.round(confidence * 100)}%`;
        },

        isMetadataSaving(item) {
            return !!this.editingMetadataIds[item.id];
        },

        itemErrors(item) {
            const errors = [...item.errors];
            if (item.statusMessage) {
                errors.push(item.statusMessage);
            }
            if (item.commitError) {
                errors.push(item.commitError);
            }
            return errors;
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4 mt-5">
            <div class="display-6 mb-0">New Tab</div>
            <div class="btn-group" role="group" aria-label="New tab mode">
                <button class="btn" :class='mode === "upload" ? "btn-primary" : "btn-outline-primary"' @click='mode = "upload"'>
                    <font-awesome-icon :icon='["fas", "file"]' />
                    Upload
                </button>
                <button class="btn" :class='mode === "import" ? "btn-primary" : "btn-outline-primary"' @click='mode = "import"'>
                    <font-awesome-icon :icon='["fas", "folder"]' />
                    Import
                </button>
                <button class="btn" :class='mode === "empty" ? "btn-primary" : "btn-outline-primary"' @click='mode = "empty"'>
                    <font-awesome-icon :icon='["fas", "plus"]' />
                    Empty
                </button>
            </div>
        </div>

        <section v-if='mode === "upload"'>
            <h2 class="h5 mb-3">Upload Guitar Pro or MusicXML files</h2>

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
        </section>

        <section v-else-if='mode === "empty"'>
            <h2 class="h5 mb-3">Create Empty Tab</h2>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-primary" :disabled="isUploading" @click='createEmpty("bass")'>
                    <font-awesome-icon :icon='["fas", "plus"]' />
                    Bass Tab
                </button>
                <button class="btn btn-outline-primary" :disabled="isUploading" @click='createEmpty("guitar")'>
                    <font-awesome-icon :icon='["fas", "plus"]' />
                    Guitar Tab
                </button>
            </div>
        </section>

        <section v-else class="import-workflow">
            <div class="row g-3 align-items-end mb-4">
                <div class="col-12 col-lg-7">
                    <label for="server-folder-path" class="form-label">Server folder path</label>
                    <input id="server-folder-path" v-model="sourcePath" class="form-control" type="text" placeholder="/srv/tabs/import" :disabled="isStartingScan || isCommitting" />
                </div>
                <div class="col-12 col-md-6 col-lg-3">
                    <label for="grouping-mode" class="form-label">Grouping</label>
                    <select id="grouping-mode" v-model="groupingMode" class="form-select" :disabled="isStartingScan || isCommitting">
                        <option value="auto">Auto</option>
                        <option value="artist-song">Artist / Song</option>
                        <option value="artist-album-song">Artist / Album / Song</option>
                    </select>
                </div>
                <div class="col-12 col-md-6 col-lg-2">
                    <button class="btn btn-primary w-100" :disabled="isStartingScan || isCommitting" @click="startServerFolderImport">
                        <span v-if="isStartingScan" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
                        Scan
                    </button>
                </div>
            </div>

            <div v-if="importJob" class="import-status border rounded p-3 mb-3">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <div>
                        <span class="badge text-bg-secondary me-2">{{ importJob.status }}</span>
                        <span class="text-muted small">{{ importJob.id }}</span>
                    </div>
                    <button class="btn btn-sm btn-outline-secondary" :disabled="isLoadingReview" @click="loadReviewItems" v-if="canReview">Refresh</button>
                </div>
                <div class="progress import-progress mb-2" role="progressbar" :aria-valuenow="importProgressPercent" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-bar" :style='{ width: `${importProgressPercent}%` }'></div>
                </div>
                <div class="d-flex flex-wrap gap-3 small">
                    <span>Total: <strong>{{ importJob.totalCount }}</strong></span>
                    <span>Imported: <strong>{{ importJob.importedCount }}</strong></span>
                    <span>Skipped: <strong>{{ importJob.skippedCount }}</strong></span>
                    <span>Failed: <strong>{{ importJob.failedCount }}</strong></span>
                    <span v-if="importJob.errorMessage" class="text-danger">{{ importJob.errorMessage }}</span>
                </div>
            </div>

            <div v-if="canReview" class="review-tools border rounded p-3 mb-3">
                <div class="row g-2 align-items-end">
                    <div class="col-12 col-lg-4">
                        <label for="review-search" class="form-label">Search</label>
                        <div class="input-group">
                            <span class="input-group-text">
                                <font-awesome-icon :icon='["fas", "magnifying-glass"]' />
                            </span>
                            <input id="review-search" v-model="reviewFilters.search" class="form-control" type="search" @keyup.enter="applyFilters" />
                        </div>
                    </div>
                    <div class="col-6 col-lg-2">
                        <label for="review-status" class="form-label">Status</label>
                        <select id="review-status" v-model="reviewFilters.status" class="form-select">
                            <option value="">Any</option>
                            <option value="ready">Ready</option>
                            <option value="failed">Failed</option>
                            <option value="skipped">Skipped</option>
                            <option value="committed">Committed</option>
                        </select>
                    </div>
                    <div class="col-6 col-lg-2">
                        <label for="review-selected" class="form-label">Selected</label>
                        <select id="review-selected" v-model="reviewFilters.selected" class="form-select">
                            <option value="">Any</option>
                            <option value="true">Selected</option>
                            <option value="false">Not selected</option>
                        </select>
                    </div>
                    <div class="col-6 col-lg-2">
                        <label for="review-duplicate" class="form-label">Duplicate</label>
                        <select id="review-duplicate" v-model="reviewFilters.duplicate" class="form-select">
                            <option value="">Any</option>
                            <option value="none">New</option>
                            <option value="exact">Exact file</option>
                            <option value="probable">Probable song</option>
                        </select>
                    </div>
                    <div class="col-6 col-lg-2">
                        <label for="review-sort" class="form-label">Sort</label>
                        <select id="review-sort" v-model="reviewFilters.sort" class="form-select">
                            <option value="artist-title">Artist / Title</option>
                            <option value="album-title">Album / Title</option>
                            <option value="confidence-asc">Confidence low</option>
                            <option value="confidence-desc">Confidence high</option>
                            <option value="source-path">Source path</option>
                        </select>
                    </div>
                </div>
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" :disabled="isLoadingReview" @click="applyFilters">Apply</button>
                        <button class="btn btn-outline-secondary" :disabled="isLoadingReview" @click="clearFilters">Clear</button>
                    </div>
                    <div class="btn-group btn-group-sm" role="group" aria-label="Review display mode">
                        <button class="btn" :class='reviewMode === "grouped" ? "btn-primary" : "btn-outline-primary"' :disabled="isLoadingReview" @click='reviewMode = "grouped"'>
                            Grouped
                        </button>
                        <button class="btn" :class='reviewMode === "flat" ? "btn-primary" : "btn-outline-primary"' :disabled="isLoadingReview" @click='reviewMode = "flat"'>
                            Flat
                        </button>
                    </div>
                    <div class="small text-muted" v-if="importItemsPage">{{ importItemsPage.total }} items, {{ selectedVisibleCount }} selected on this page</div>
                </div>
            </div>

            <div v-if="importItemsPage" class="bulk-tools border rounded p-3 mb-3">
                <div class="d-flex flex-wrap align-items-center gap-2">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary" :disabled="isApplyingBulk || importItems.length === 0" @click="bulkSelectVisible(true)">Select page</button>
                        <button class="btn btn-outline-secondary" :disabled="isApplyingBulk || importItems.length === 0" @click="bulkSelectVisible(false)">Deselect page</button>
                        <button class="btn btn-outline-secondary" :disabled="isApplyingBulk" @click="bulkSelectMatching(true)">Select filtered</button>
                        <button class="btn btn-outline-secondary" :disabled="isApplyingBulk" @click="bulkSelectMatching(false)">Deselect filtered</button>
                    </div>
                    <div class="input-group input-group-sm bulk-decision">
                        <select v-model="bulkDecision" class="form-select" :disabled="isApplyingBulk">
                            <option value="import">Import</option>
                            <option value="manual_skip">Manual skip</option>
                            <option value="skip_exact_duplicate">Skip exact duplicate</option>
                            <option value="link_duplicate_source">Link duplicate source</option>
                            <option value="keep_as_version">Keep as version</option>
                            <option value="split_song">Split song</option>
                        </select>
                        <button class="btn btn-outline-primary" :disabled="isApplyingBulk || selectedVisibleCount === 0" @click="bulkSetDecision">Apply to selected</button>
                    </div>
                    <button class="btn btn-sm btn-success ms-auto" :disabled="!canCommit || isCommitting" @click="startCommit">
                        <span v-if="isCommitting" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
                        Commit selected
                    </button>
                </div>
            </div>

            <div v-if="isLoadingReview" class="text-center py-4">
                <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                Loading review
            </div>

            <div v-else-if="importItemsPage" class="review-list">
                <div v-if="importItems.length === 0" class="text-muted border rounded p-3">No import items match the current filters.</div>

                <div v-if='reviewMode === "flat"' class="table-responsive">
                    <table class="table table-sm table-hover align-middle mb-0">
                        <thead>
                            <tr>
                                <th class="select-col">Selected</th>
                                <th>Metadata</th>
                                <th>Source</th>
                                <th>Status</th>
                                <th>Confidence</th>
                                <th>Duplicate</th>
                                <th>Decision</th>
                                <th>Errors</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="item in importItems" :key="item.id">
                                <td>
                                    <input class="form-check-input" type="checkbox" :checked="item.selected" :disabled="isApplyingBulk"
                                        @change="updateItemSelection(item, $event.target.checked)" />
                                </td>
                                <td class="metadata-cell">
                                    <div class="metadata-grid">
                                        <label class="metadata-field">
                                            <span>Artist</span>
                                            <input v-model="item.suggestedArtist" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                @focus='rememberMetadataValue(item, "suggestedArtist")' @blur='updateItemMetadata(item, "suggestedArtist")'
                                                @keydown.enter.prevent="$event.target.blur()" />
                                        </label>
                                        <label class="metadata-field">
                                            <span>Title</span>
                                            <input v-model="item.suggestedTitle" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                @focus='rememberMetadataValue(item, "suggestedTitle")' @blur='updateItemMetadata(item, "suggestedTitle")'
                                                @keydown.enter.prevent="$event.target.blur()" />
                                        </label>
                                        <label class="metadata-field">
                                            <span>Album</span>
                                            <input v-model="item.suggestedAlbum" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                @focus='rememberMetadataValue(item, "suggestedAlbum")' @blur='updateItemMetadata(item, "suggestedAlbum")'
                                                @keydown.enter.prevent="$event.target.blur()" />
                                        </label>
                                        <label class="metadata-field">
                                            <span>Version</span>
                                            <input v-model="item.suggestedVersionLabel" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)" placeholder="default"
                                                @focus='rememberMetadataValue(item, "suggestedVersionLabel")' @blur='updateItemMetadata(item, "suggestedVersionLabel")'
                                                @keydown.enter.prevent="$event.target.blur()" />
                                        </label>
                                    </div>
                                    <div v-if="isMetadataSaving(item)" class="small text-muted mt-1">Saving metadata</div>
                                </td>
                                <td class="source-path">
                                    <div>{{ item.relativePath || item.sourcePath }}</div>
                                    <div class="small text-muted">{{ item.ext || "unknown" }}<span v-if="item.byteSize !== null">, {{ item.byteSize }} bytes</span></div>
                                </td>
                                <td><span class="badge text-bg-secondary">{{ item.status }}</span></td>
                                <td><span class="badge" :class="confidenceClass(item.confidence)">{{ formatConfidence(item.confidence) }}</span></td>
                                <td><span class="badge" :class="duplicateClass(item)">{{ duplicateLabel(item) }}</span></td>
                                <td>
                                    <select v-model="item.decision" class="form-select form-select-sm decision-select" :disabled="isApplyingBulk" @change="updateItemDecision(item)">
                                        <option value="import">Import</option>
                                        <option value="manual_skip">Manual skip</option>
                                        <option value="skip_unsupported">Skip unsupported</option>
                                        <option value="skip_exact_duplicate">Skip exact duplicate</option>
                                        <option value="link_duplicate_source">Link duplicate source</option>
                                        <option value="keep_as_version">Keep as version</option>
                                        <option value="split_song">Split song</option>
                                    </select>
                                </td>
                                <td class="errors-cell">
                                    <div v-for="error in itemErrors(item)" :key="error" class="text-danger small">{{ error }}</div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <template v-else>
                    <div v-for="group in groupedReviewItems" :key="group.key" class="review-group mb-3">
                        <div class="album-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                            <div>
                                <strong>{{ group.artist }}</strong>
                                <span class="text-muted"> / {{ group.album }}</span>
                            </div>
                            <span class="badge text-bg-secondary">{{ group.items.length }}</span>
                        </div>

                        <div class="table-responsive">
                            <table class="table table-sm table-hover align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th class="select-col">Selected</th>
                                        <th>Metadata</th>
                                        <th>Source</th>
                                        <th>Status</th>
                                        <th>Confidence</th>
                                        <th>Duplicate</th>
                                        <th>Decision</th>
                                        <th>Errors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="item in group.items" :key="item.id">
                                        <td>
                                            <input class="form-check-input" type="checkbox" :checked="item.selected" :disabled="isApplyingBulk"
                                                @change="updateItemSelection(item, $event.target.checked)" />
                                        </td>
                                        <td class="metadata-cell">
                                            <div class="metadata-grid">
                                                <label class="metadata-field">
                                                    <span>Artist</span>
                                                    <input v-model="item.suggestedArtist" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                        @focus='rememberMetadataValue(item, "suggestedArtist")' @blur='updateItemMetadata(item, "suggestedArtist")'
                                                        @keydown.enter.prevent="$event.target.blur()" />
                                                </label>
                                                <label class="metadata-field">
                                                    <span>Title</span>
                                                    <input v-model="item.suggestedTitle" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                        @focus='rememberMetadataValue(item, "suggestedTitle")' @blur='updateItemMetadata(item, "suggestedTitle")'
                                                        @keydown.enter.prevent="$event.target.blur()" />
                                                </label>
                                                <label class="metadata-field">
                                                    <span>Album</span>
                                                    <input v-model="item.suggestedAlbum" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                        @focus='rememberMetadataValue(item, "suggestedAlbum")' @blur='updateItemMetadata(item, "suggestedAlbum")'
                                                        @keydown.enter.prevent="$event.target.blur()" />
                                                </label>
                                                <label class="metadata-field">
                                                    <span>Version</span>
                                                    <input v-model="item.suggestedVersionLabel" class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                                        placeholder="default"
                                                        @focus='rememberMetadataValue(item, "suggestedVersionLabel")' @blur='updateItemMetadata(item, "suggestedVersionLabel")'
                                                        @keydown.enter.prevent="$event.target.blur()" />
                                                </label>
                                            </div>
                                            <div v-if="isMetadataSaving(item)" class="small text-muted mt-1">Saving metadata</div>
                                        </td>
                                        <td class="source-path">
                                            <div>{{ item.relativePath || item.sourcePath }}</div>
                                            <div class="small text-muted">{{ item.ext || "unknown" }}<span v-if="item.byteSize !== null">, {{ item.byteSize }} bytes</span></div>
                                        </td>
                                        <td><span class="badge text-bg-secondary">{{ item.status }}</span></td>
                                        <td><span class="badge" :class="confidenceClass(item.confidence)">{{ formatConfidence(item.confidence) }}</span></td>
                                        <td><span class="badge" :class="duplicateClass(item)">{{ duplicateLabel(item) }}</span></td>
                                        <td>
                                            <select v-model="item.decision" class="form-select form-select-sm decision-select" :disabled="isApplyingBulk" @change="updateItemDecision(item)">
                                                <option value="import">Import</option>
                                                <option value="manual_skip">Manual skip</option>
                                                <option value="skip_unsupported">Skip unsupported</option>
                                                <option value="skip_exact_duplicate">Skip exact duplicate</option>
                                                <option value="link_duplicate_source">Link duplicate source</option>
                                                <option value="keep_as_version">Keep as version</option>
                                                <option value="split_song">Split song</option>
                                            </select>
                                        </td>
                                        <td class="errors-cell">
                                            <div v-for="error in itemErrors(item)" :key="error" class="text-danger small">{{ error }}</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </template>

                <div class="d-flex justify-content-between align-items-center gap-2 mt-3" v-if="importItemsPage.total > reviewPageSize">
                    <button class="btn btn-sm btn-outline-secondary" :disabled="reviewPage <= 1 || isLoadingReview" @click="setReviewPage(reviewPage - 1)">
                        <font-awesome-icon :icon='["fas", "arrow-left"]' />
                        Previous
                    </button>
                    <div class="small text-muted">Page {{ reviewPage }} of {{ reviewTotalPages }}</div>
                    <button class="btn btn-sm btn-outline-secondary" :disabled="reviewPage >= reviewTotalPages || isLoadingReview" @click="setReviewPage(reviewPage + 1)">
                        Next
                        <font-awesome-icon :icon='["fas", "arrow-right-from-bracket"]' />
                    </button>
                </div>
            </div>

            <div v-if="importReport" class="commit-report border rounded p-3 mt-4">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                    <h2 class="h5 mb-0">Commit Report</h2>
                    <span class="badge" :class='importReport.job.status === "completed" ? "text-bg-success" : "text-bg-danger"'>{{ importReport.job.status }}</span>
                </div>
                <div class="d-flex flex-wrap gap-3 small mb-3">
                    <span>Imported: <strong>{{ importReport.totals.imported }}</strong></span>
                    <span>Skipped: <strong>{{ importReport.totals.skipped }}</strong></span>
                    <span>Failed: <strong>{{ importReport.totals.failed }}</strong></span>
                </div>
                <div v-if="importReport.createdTabs.length > 0" class="mb-3">
                    <div class="fw-semibold mb-2">Created tabs</div>
                    <div class="list-group list-group-flush">
                        <router-link v-for="tab in importReport.createdTabs" :key="tab.id" class="list-group-item list-group-item-action px-0" :to="`/tab/${tab.id}`">
                            {{ tab.artist }} - {{ tab.title }}
                        </router-link>
                    </div>
                </div>
                <div v-if="importReport.failedItems.length > 0">
                    <div class="fw-semibold mb-2">Failed items</div>
                    <div v-for="item in importReport.failedItems" :key="item.id"
                        class="small text-danger">{{ item.relativePath || item.sourcePath }}: {{ item.commitError || item.statusMessage || "Failed" }}</div>
                </div>
            </div>
        </section>
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

.import-progress {
    height: 8px;
}

.bulk-decision {
    max-width: 390px;
}

.album-header {
    background: var(--bs-tertiary-bg);
    border: 1px solid var(--bs-border-color);
    border-bottom: 0;
    padding: 8px 10px;
}

.review-list table {
    border: 1px solid var(--bs-border-color);
}

.review-list th {
    white-space: nowrap;
}

.select-col {
    width: 72px;
}

.source-path {
    min-width: 240px;
    max-width: 420px;
    word-break: break-word;
}

.metadata-cell {
    min-width: 360px;
}

.metadata-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(150px, 1fr));
    gap: 6px 8px;
}

.metadata-field {
    margin: 0;
}

.metadata-field span {
    display: block;
    color: var(--bs-secondary-color);
    font-size: 0.75rem;
    line-height: 1.2;
    margin-bottom: 2px;
}

.decision-select {
    min-width: 165px;
}

.errors-cell {
    min-width: 160px;
}

@media (max-width: 575.98px) {
    .metadata-cell {
        min-width: 260px;
    }

    .metadata-grid {
        grid-template-columns: 1fr;
    }
}
</style>
