<script>
import { defineComponent } from "vue";
import { baseURL, checkFetch, generalError } from "../app.js";
import { notify } from "@kyvg/vue3-notification";
import Treeselect, { LOAD_CHILDREN_OPTIONS } from "@zanmato/vue3-treeselect";
import "@zanmato/vue3-treeselect/dist/vue3-treeselect.min.css";

export default defineComponent({
    components: { Treeselect },
    props: {
        tabID: {
            type: [String, Number],
            required: true,
        },
    },
    emits: ["changed", "selection"],
    data() {
        return {
            libraryStatus: null,
            nodes: [],
            selectedId: null,
            loading: false,
        };
    },
    computed: {
        libraryReady() {
            return !!this.libraryStatus && this.libraryStatus.configured && this.libraryStatus.exists;
        },

	hasSelection() {
	    return this.selectedId != null;
	},

        emptyMessage() {
            if (!this.libraryStatus) {
                return "Loading library...";
            }
            if (!this.libraryStatus.configured) {
                return "No audio library has been configured for this server.";
            }
            if (!this.libraryStatus.exists) {
                return "The configured library path was not found.";
            }
            return "Library folder is empty.";
        },

        placeholder() {
            return this.libraryReady ? "Select audio file from library..." : this.emptyMessage;
        },
    },
    async mounted() {
        await this.init();
    },
    methods: {
        async init() {
            this.loading = true;
            try {
                const statusRes = await fetch(baseURL + "/api/library/status", { credentials: "include" });
                await checkFetch(statusRes);
                this.libraryStatus = await statusRes.json();

                if (!this.libraryReady) {
                    return;
                }

                const entries = await this.fetchDir("");
                this.nodes = this.mapEntriesToOptions(entries, "");
            } catch (e) {
                generalError(e);
            } finally {
                this.loading = false;
            }
        },

        async fetchDir(relPath) {
            const res = await fetch(baseURL + `/api/library/browse?path=${encodeURIComponent(relPath)}`, {
                credentials: "include",
            });
            await checkFetch(res);
            const data = await res.json();
            return data.entries;
        },

        mapEntriesToOptions(entries, parentPath) {
            return entries.map((entry) => {
                const id = parentPath ? `${parentPath}/${entry.name}` : entry.name;
		const readableName = entry.name
				      .replace(/\.[^/.]+$/, "") // Removes the extension
				      .replace(/_/g, " ");       // Replace underscores with spaces
                const node = { id, label: readableName };
                if (entry.type === "dir") {
                    // children: null marks this as a lazy, not-yet-loaded branch node.
                    // disableBranchNodes (set on the component) keeps folders navigable
                    // but never independently selectable.
                    node.children = null;
                }
                return node;
            });
        },

        loadOptions({ action, parentNode, callback }) {
            if (action !== LOAD_CHILDREN_OPTIONS) {
                callback();
                return;
            }
            this.fetchDir(parentNode.id)
                .then((entries) => {
                    parentNode.children = this.mapEntriesToOptions(entries, parentNode.id);
                    callback();
                })
                .catch((e) => {
                    generalError(e);
                    callback(e);
                });
        },
    },
    watch: {
	selectedId(newValue) {
	    // Explicitly emit the primitive ID string (or null when cleared)
	    this.$emit("selection", newValue);
	}
    }
});
</script>

<template>
    <div class="song-library-picker">
        <Treeselect
            v-model="selectedId"
            :options="nodes"
            :multiple="false"
            :disable-branch-nodes="true"
            :load-options="loadOptions"
            :searchable="true"
            :clearable="true"
            :disabled="!libraryReady"
            :loading="loading"
            :placeholder="placeholder"
            :no-options-text="emptyMessage"
            no-children-text="This folder is empty."
        />

        <p v-if="libraryStatus && libraryStatus.exists" class="text-muted small mt-2 mb-0">
            Tip: search only looks through folders you've already opened in the tree, not your whole library at
            once.
        </p>
    </div>
</template>

<style scoped>
/*
 * vue3-treeselect custom styling for its-mytabs
 * Uses Bootstrap variables to support light/dark mode seamlessly out-of-the-box.
 */

/* 1. Base Component Layout & Theme Mapping */
.song-library-picker :deep(.vue3-treeselect__control) {
    background-color: var(--bs-body-bg);
    border-color: var(--bs-border-color);
    border-radius: 3px;
    min-height: calc(1.5em + 0.75rem + 2px);
}

.song-library-picker :deep(.vue3-treeselect__menu) {
    background-color: var(--bs-body-bg);
    border-color: var(--bs-border-color);
    color: var(--bs-body-color);
}

.song-library-picker :deep(.vue3-treeselect__label),
.song-library-picker :deep(.vue3-treeselect__input),
.song-library-picker :deep(.vue3-treeselect__placeholder) {
    color: var(--bs-body-color);
}

/* Ensure the selected text inherits Bootstrap's reactive text color */
.song-library-picker :deep(.vue3-treeselect__single-value) {
    color: var(--bs-body-color);
}

/* 2. Interactive Focus States (Matching your custom Bootstrap Primary Color) */
.song-library-picker :deep(.vue3-treeselect--focused:not(.vue3-treeselect--open) .vue3-treeselect__control) {
    border-color: #3131c6;
    box-shadow: 0 0 0 0.2rem rgba(49, 49, 198, 0.25);
}

/* 3. Multi-Select Tags */
.song-library-picker :deep(.vue3-treeselect__multi-value-item) {
    background: rgba(49, 49, 198, 0.1);
    border-color: rgba(49, 49, 198, 0.2);
    border-radius: 2px;
    color: #3131c6;
}

/* 4. Dropdown List Highlights (Uses theme-adaptive subtle background hover) */
.song-library-picker :deep(.vue3-treeselect__option--highlight) {
    background: var(--bs-tertiary-bg, rgba(49, 49, 198, 0.08));
}

/* 5. Checkbox States */
.song-library-picker :deep(.vue3-treeselect__checkbox--checked),
.song-library-picker :deep(.vue3-treeselect__checkbox--indeterminate) {
    background: #3131c6;
    border-color: #3131c6;
}

/* 6. Click Targeting and Clear Button Layering Fixes */
.song-library-picker :deep(.vue3-treeselect__clear-reveal) {
    z-index: 10; /* Elevates the clear icon container above the input overlay */
    pointer-events: auto; /* Explicitly forces the click event to target the X button */
}

.song-library-picker :deep(.vue3-treeselect__x-container) {
    cursor: pointer; /* Provides visual feedback that the clear action is clickable */
}

/* Ensure the currently selected dropdown item doesn't render a bright white block */
.song-library-picker :deep(.vue3-treeselect__option--selected) {
    background: var(--bs-primary-bg-subtle, rgba(49, 49, 198, 0.15));
    color: var(--bs-body-color);
}

</style>

