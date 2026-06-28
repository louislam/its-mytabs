<script>
import { defineComponent } from "vue";

export default defineComponent({
    props: {
        items: {
            type: Array,
            required: true,
        },
        isApplyingBulk: {
            type: Boolean,
            default: false,
        },
        editingMetadataIds: {
            type: Object,
            default: () => ({}),
        },
    },
    emits: ["update-selection", "update-decision", "update-draft", "remember-metadata", "update-metadata"],
    methods: {
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

        fieldValue(item, field) {
            return item[field] ?? "";
        },
    },
});
</script>

<template>
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
                <tr v-for="item in items" :key="item.id">
                    <td>
                        <input class="form-check-input" type="checkbox" :checked="item.selected" :disabled="isApplyingBulk"
                            @change='$emit("update-selection", item, $event.target.checked)' />
                    </td>
                    <td class="metadata-cell">
                        <div class="metadata-grid">
                            <label class="metadata-field">
                                <span>Artist</span>
                                <input :value='fieldValue(item, "suggestedArtist")' class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                    @input='$emit("update-draft", item, "suggestedArtist", $event.target.value)'
                                    @focus='$emit("remember-metadata", item, "suggestedArtist")' @blur='$emit("update-metadata", item, "suggestedArtist")'
                                    @keydown.enter.prevent="$event.target.blur()" />
                            </label>
                            <label class="metadata-field">
                                <span>Title</span>
                                <input :value='fieldValue(item, "suggestedTitle")' class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                    @input='$emit("update-draft", item, "suggestedTitle", $event.target.value)'
                                    @focus='$emit("remember-metadata", item, "suggestedTitle")' @blur='$emit("update-metadata", item, "suggestedTitle")'
                                    @keydown.enter.prevent="$event.target.blur()" />
                            </label>
                            <label class="metadata-field">
                                <span>Album</span>
                                <input :value='fieldValue(item, "suggestedAlbum")' class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)"
                                    @input='$emit("update-draft", item, "suggestedAlbum", $event.target.value)'
                                    @focus='$emit("remember-metadata", item, "suggestedAlbum")' @blur='$emit("update-metadata", item, "suggestedAlbum")'
                                    @keydown.enter.prevent="$event.target.blur()" />
                            </label>
                            <label class="metadata-field">
                                <span>Version</span>
                                <input :value='fieldValue(item, "suggestedVersionLabel")' class="form-control form-control-sm" type="text" :disabled="isMetadataSaving(item)" placeholder="default"
                                    @input='$emit("update-draft", item, "suggestedVersionLabel", $event.target.value)'
                                    @focus='$emit("remember-metadata", item, "suggestedVersionLabel")' @blur='$emit("update-metadata", item, "suggestedVersionLabel")'
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
                        <select :value="item.decision" class="form-select form-select-sm decision-select" :disabled="isApplyingBulk" @change='$emit("update-decision", item, $event.target.value)'>
                            <option value="import">Import</option>
                            <option value="manual_skip">Manual skip</option>
                            <option value="skip_unsupported">Skip unsupported</option>
                            <option value="skip_exact_duplicate">Skip exact duplicate</option>
                            <option value="link_duplicate_source">Link duplicate source</option>
                            <option value="keep_as_version">Keep as version</option>
                        </select>
                    </td>
                    <td class="errors-cell">
                        <div v-for="error in itemErrors(item)" :key="error" class="text-danger small">{{ error }}</div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
