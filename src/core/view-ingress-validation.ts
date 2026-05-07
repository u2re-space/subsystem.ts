/**
 * Mechanical checks for unified ingress (open / attach / share) beyond timing-only delays.
 *
 * INVARIANT: Prefer stable file identity (name + size + lastModified) and cheap text heuristics so
 * corrupted or empty transfers fail fast before replacing live UI state.
 */

import type { UnifiedMessage } from "com/core/UnifiedMessaging";

const MAX_DIRECT_FILE_BYTES = 48 * 1024 * 1024;

/** Types that must carry at least one substantive body carrier (file, blob, text, or url). */
const TYPES_REQUIRING_BODY = new Set(
    [
        "content-load",
        "content-view",
        "markdown-content",
        "content-share",
        "content-attach",
        "file-attach"
    ].map((s) => s.toLowerCase()),
);

function asDataRecord(message: UnifiedMessage): Record<string, unknown> {
    const d = (message as { data?: unknown }).data;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

function hasFileLike(v: unknown): boolean {
    return (typeof File !== "undefined" && v instanceof File) || (typeof Blob !== "undefined" && v instanceof Blob);
}

function carrierPresent(data: Record<string, unknown>): boolean {
    if (hasFileLike(data.file) || hasFileLike(data.blob)) return true;
    const files = data.files;
    if (Array.isArray(files) && files.some((x) => hasFileLike(x))) return true;
    if (String(data.path ?? data.into ?? "").trim().length > 0) return true;
    const t = String(data.text ?? data.content ?? "").trim();
    if (t.length > 0) return true;
    const u = String(data.url ?? "").trim();
    return u.length > 0;
}

export interface IngressPreHandleResult {
    ok: boolean;
    reason?: string;
}

/**
 * Drop structurally empty envelopes before shell settle / handleMessage (noise from replays).
 */
export function validateIngressBeforeViewHandle(message: UnifiedMessage, mappedType: string): IngressPreHandleResult {
    const mt = String(mappedType || "").toLowerCase();
    if (!TYPES_REQUIRING_BODY.has(mt)) {
        return { ok: true };
    }
    const data = asDataRecord(message);
    if (!carrierPresent(data)) {
        return { ok: false, reason: "missing-body-carrier" };
    }

    const f = data.file;
    if (typeof File !== "undefined" && f instanceof File && f.size > MAX_DIRECT_FILE_BYTES) {
        return { ok: false, reason: `file-too-large>${MAX_DIRECT_FILE_BYTES}` };
    }

    if (Array.isArray(data.files)) {
        for (const x of data.files) {
            if (typeof File !== "undefined" && x instanceof File && x.size > MAX_DIRECT_FILE_BYTES) {
                return { ok: false, reason: `files-array-too-large>${MAX_DIRECT_FILE_BYTES}` };
            }
        }
    }

    return { ok: true };
}

/** Stable key for logging / optional client-side dedupe (not wire format). */
export function fingerprintTransferFile(file: File): string {
    return `${String(file.name || "").trim().toLowerCase()}|${file.size}|${(file as File & { lastModified?: number }).lastModified ?? 0}`;
}

/**
 * After `File#text()` / network read: refuse obvious binary garbage mis-tagged as markdown.
 * WHY: avoids blanking the viewer with mojibake or PDF bytes when MIME/name were wrong.
 */
export function textIngressLooksCorrupt(text: string): boolean {
    if (!text || text.length === 0) return false;
    const cap = Math.min(text.length, 16_384);
    let nul = 0;
    let control = 0;
    for (let i = 0; i < cap; i++) {
        const c = text.charCodeAt(i);
        if (c === 0) nul++;
        /* eslint-disable no-bitwise -- fast path for C0 except common whitespace */
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) control++;
    }
    if (nul > 2) return true;
    if (control / cap > 0.02 && text.length < 64 * 1024) return true;

    const head = text.slice(0, 512).trimStart();
    /* PDF / ZIP family */
    if (head.startsWith("%PDF")) return true;
    if (head.startsWith("PK\x03\x04")) return true;

    return false;
}

export interface FilePickOptions {
    hintFilename?: string;
    isTextLike: (file: File) => boolean;
}

/**
 * Pick authoritative file for staged transfers: optional hint match, then text-like, then markdown extension.
 */
export function pickAuthoritativeTransferFiles(files: File[], opts: FilePickOptions): File | null {
    const list = files.filter((f) => f instanceof File);
    if (list.length === 0) return null;

    const hint = (opts.hintFilename || "").trim().toLowerCase();
    if (hint) {
        const byHint = list.find((f) => String(f.name || "").trim().toLowerCase() === hint);
        if (byHint) return byHint;
        const partial = list.find((f) => String(f.name || "").trim().toLowerCase().endsWith(hint));
        if (partial) return partial;
    }

    const texty = list.find((f) => opts.isTextLike(f));
    if (texty) return texty;

    const md = list.find((f) => /\.(md|markdown|mdown|mkdn|mkd)(?:$|\?)/i.test(f.name || ""));
    return md ?? list[0] ?? null;
}

export function validateReadableFileForIngress(file: File): IngressPreHandleResult {
    if (!(file instanceof File)) return { ok: false, reason: "not-a-file" };
    if (file.size > MAX_DIRECT_FILE_BYTES) return { ok: false, reason: "file-too-large" };
    return { ok: true };
}
