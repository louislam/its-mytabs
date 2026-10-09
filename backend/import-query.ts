import { ImportItemsQuery } from "./zod.ts";

export function normalizeItemsQuery(query: Partial<ImportItemsQuery>): ImportItemsQuery {
    return {
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
        search: query.search,
        status: query.status,
        selected: query.selected,
        duplicate: query.duplicate,
        decision: query.decision,
        sort: query.sort ?? "artist-title",
    };
}

export function buildItemFilter(jobId: string, query: Partial<ImportItemsQuery>): { where: string; params: Array<string | number> } {
    const clauses = ["job_id = ?"];
    const params: Array<string | number> = [jobId];
    if (query.search) {
        clauses.push(`(
            source_path LIKE ? ESCAPE '\\'
            OR relative_path LIKE ? ESCAPE '\\'
            OR suggested_artist LIKE ? ESCAPE '\\'
            OR suggested_title LIKE ? ESCAPE '\\'
            OR suggested_album LIKE ? ESCAPE '\\'
            OR parsed_artist LIKE ? ESCAPE '\\'
            OR parsed_title LIKE ? ESCAPE '\\'
            OR parsed_album LIKE ? ESCAPE '\\'
        )`);
        const search = `%${escapeLike(query.search)}%`;
        params.push(search, search, search, search, search, search, search, search);
    }
    if (query.status) {
        clauses.push("status = ?");
        params.push(query.status);
    }
    if (query.selected !== undefined) {
        clauses.push("selected = ?");
        params.push(query.selected ? 1 : 0);
    }
    if (query.decision) {
        clauses.push("decision = ?");
        params.push(query.decision);
    }
    if (query.duplicate === "none") {
        clauses.push("duplicate_tab_file_id IS NULL AND probable_duplicate_song_id IS NULL");
    } else if (query.duplicate === "exact") {
        clauses.push("duplicate_tab_file_id IS NOT NULL");
    } else if (query.duplicate === "probable") {
        clauses.push("probable_duplicate_song_id IS NOT NULL");
    }
    return { where: clauses.join(" AND "), params };
}

export function itemOrderBy(sort: ImportItemsQuery["sort"] | undefined): string {
    switch (sort) {
        case "album-title":
            return "review_required DESC, suggested_album COLLATE NOCASE, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "confidence-asc":
            return "confidence ASC, review_required DESC, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "confidence-desc":
            return "confidence DESC, review_required DESC, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "source-path":
            return "relative_path COLLATE NOCASE, source_path COLLATE NOCASE";
        case "artist-title":
        default:
            return "review_required DESC, probable_duplicate_song_id IS NULL, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, suggested_album COLLATE NOCASE, relative_path COLLATE NOCASE";
    }
}

function escapeLike(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
