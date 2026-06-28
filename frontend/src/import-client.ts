import { baseURL, checkFetch } from "./app.ts";
import { ImportItemsPageSchema, ImportJobSchema, ImportReportSchema } from "./zod.ts";
import type { ImportDecision, ImportGroupingMode, ImportItemsPage, ImportJob, ImportReport } from "./zod.ts";

export interface CreateImportJobInput {
    rootPath: string;
    groupingMode: ImportGroupingMode;
}

export interface ImportReviewFilters {
    search?: string;
    status?: string;
    selected?: string;
    duplicate?: string;
    sort?: string;
}

export interface ListImportItemsInput extends ImportReviewFilters {
    limit: number;
    offset: number;
}

export interface BulkImportItemsInput {
    action: "select" | "deselect" | "set-decision";
    itemIds?: string[];
    allMatching?: boolean;
    filters?: ImportReviewFilters;
    decision?: ImportDecision;
}

async function parseJSON<T>(res: Response, parser: { parse(data: unknown): T }): Promise<T> {
    await checkFetch(res);
    return parser.parse(await res.json());
}

export async function createImportJob(input: CreateImportJobInput): Promise<ImportJob> {
    const res = await fetch(baseURL + "/api/import-jobs", {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            sourceType: "server-folder",
            rootPath: input.rootPath,
            groupingMode: input.groupingMode,
        }),
    });

    return parseJSON(res, ImportJobSchema);
}

export async function getImportJob(jobId: string): Promise<ImportJob> {
    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}`, {
        credentials: "include",
    });

    return parseJSON(res, ImportJobSchema);
}

export async function startImportScan(jobId: string): Promise<ImportJob> {
    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}/scan`, {
        method: "POST",
        credentials: "include",
    });

    return parseJSON(res, ImportJobSchema);
}

export async function listImportItems(jobId: string, input: ListImportItemsInput): Promise<ImportItemsPage> {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit));
    params.set("offset", String(input.offset));
    addParam(params, "search", input.search);
    addParam(params, "status", input.status);
    addParam(params, "selected", input.selected);
    addParam(params, "duplicate", input.duplicate);
    addParam(params, "sort", input.sort);

    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}/items?${params.toString()}`, {
        credentials: "include",
    });

    return parseJSON(res, ImportItemsPageSchema);
}

export async function bulkUpdateImportItems(jobId: string, input: BulkImportItemsInput): Promise<ImportItemsPage> {
    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}/items/bulk`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });

    return parseJSON(res, ImportItemsPageSchema);
}

export async function commitImportJob(jobId: string): Promise<ImportJob> {
    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}/commit`, {
        method: "POST",
        credentials: "include",
    });

    return parseJSON(res, ImportJobSchema);
}

export async function getImportReport(jobId: string): Promise<ImportReport> {
    const res = await fetch(baseURL + `/api/import-jobs/${encodeURIComponent(jobId)}/report`, {
        credentials: "include",
    });

    return parseJSON(res, ImportReportSchema);
}

function addParam(params: URLSearchParams, key: string, value: string | undefined): void {
    if (value && value.trim()) {
        params.set(key, value.trim());
    }
}
