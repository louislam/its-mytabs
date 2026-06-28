import { Context, Hono } from "@hono/hono";
import { ZodError } from "zod";
import { checkLogin } from "./auth.ts";
import {
    bulkUpdateImportItems,
    cancelImportJob,
    createImportJob,
    getImportJob,
    getImportReport,
    listImportItems,
    listImportJobs,
    listImportReviewGroups,
    patchImportItem,
    startImportJobCommit,
    startImportJobScan,
} from "./import.ts";
import { BulkImportItemsSchema, CreateImportJobSchema, ImportItemsQuerySchema, PatchImportItemSchema } from "./zod.ts";

export function registerImportRoutes(app: Hono): void {
    app.post("/api/import-jobs", async (c) => {
        try {
            await checkLogin(c);
            const input = CreateImportJobSchema.parse(await c.req.json());
            const job = await createImportJob(input);
            return c.json({ ok: true, job });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.get("/api/import-jobs", async (c) => {
        try {
            await checkLogin(c);
            return c.json({ ok: true, jobs: listImportJobs() });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.get("/api/import-jobs/:jobId", async (c) => {
        try {
            await checkLogin(c);
            const job = getImportJob(c.req.param("jobId"));
            if (!job) {
                throw new Error("Import job not found.");
            }
            return c.json({ ok: true, job });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.post("/api/import-jobs/:jobId/scan", async (c) => {
        try {
            await checkLogin(c);
            const job = await startImportJobScan(c.req.param("jobId"));
            return c.json({ ok: true, job });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.get("/api/import-jobs/:jobId/items", async (c) => {
        try {
            await checkLogin(c);
            const query = ImportItemsQuerySchema.parse(c.req.query());
            const page = listImportItems(c.req.param("jobId"), query);
            return c.json({ ok: true, page });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.get("/api/import-jobs/:jobId/groups", async (c) => {
        try {
            await checkLogin(c);
            const query = ImportItemsQuerySchema.parse(c.req.query());
            const page = listImportReviewGroups(c.req.param("jobId"), query);
            return c.json({ ok: true, page });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.patch("/api/import-jobs/:jobId/items/:itemId", async (c) => {
        try {
            await checkLogin(c);
            const input = PatchImportItemSchema.parse(await c.req.json());
            const item = patchImportItem(c.req.param("jobId"), c.req.param("itemId"), input);
            return c.json({ ok: true, item });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.post("/api/import-jobs/:jobId/items/bulk", async (c) => {
        try {
            await checkLogin(c);
            const input = BulkImportItemsSchema.parse(await c.req.json());
            const result = bulkUpdateImportItems(c.req.param("jobId"), input);
            return c.json({ ok: true, page: result.page, updated: result.updated });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.post("/api/import-jobs/:jobId/commit", async (c) => {
        try {
            await checkLogin(c);
            const job = await startImportJobCommit(c.req.param("jobId"));
            return c.json({ ok: true, job });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.post("/api/import-jobs/:jobId/cancel", async (c) => {
        try {
            await checkLogin(c);
            const job = cancelImportJob(c.req.param("jobId"));
            return c.json({ ok: true, job });
        } catch (error) {
            return importRouteError(c, error);
        }
    });

    app.get("/api/import-jobs/:jobId/report", async (c) => {
        try {
            await checkLogin(c);
            const report = getImportReport(c.req.param("jobId"));
            return c.json({ ok: true, report });
        } catch (error) {
            return importRouteError(c, error);
        }
    });
}

function importRouteError(c: Context, error: unknown) {
    if (error instanceof ZodError) {
        return c.json({
            ok: false,
            msg: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
        }, 400);
    }
    if (error instanceof Error) {
        return c.json({
            ok: false,
            msg: error.message,
        }, 400);
    }
    return c.json({
        ok: false,
        msg: "Unknown error",
    }, 400);
}
