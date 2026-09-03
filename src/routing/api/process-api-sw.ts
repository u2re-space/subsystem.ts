/*
 * Filename: process-api-sw.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api-sw.ts
 * FIND:process
 *
 * Service-worker / Vite Connect handler for `/api/process/*`.
 * WHY: Workbox NetworkOnly used to swallow these POSTs before the legacy
 * `/api/processing` route; Vite Dev has no Fastify unless this middleware runs.
 * INVARIANT: a failed SW local fallback must not become the response — forward to Fastify.
 */
import { isProcessApiPath } from "./process-api-path.ts";
import {
    handleProcessApiPost,
    processApiJsonResponse,
    processApiMissPayload,
    runLocalProcessFallback
} from "./process-local.ts";

export { handleProcessApiPost as handleProcessApiPostBody };

export { isProcessApiPath };

const pathOf = (url = "/"): string => {
    try {
        return new URL(url, "http://process.local").pathname;
    } catch {
        return url.split("?")[0] || "/";
    }
};

const parseBody = (raw: string): Record<string, unknown> | null => {
    if (!raw.trim()) return null;
    try {
        const json = JSON.parse(raw);
        return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const isHealthPath = (pathname: string): boolean =>
    pathname === "/api/process" ||
    pathname === "/api/process/health" ||
    pathname === "/process/health";

/** Workbox / fetch handler. Local-first when the body carries an API key (same as Fastify). */
export const handleProcessApiFetch = async (request: Request): Promise<Response> => {
    const pathname = pathOf(request.url);
    const method = String(request.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
        if (!isHealthPath(pathname) && !isProcessApiPath(pathname)) {
            return processApiJsonResponse(processApiMissPayload("sw"), 404);
        }
        /* WHY: never fetch the same-origin URL — this handler would recurse. */
        return processApiJsonResponse({
            ok: true,
            id: "cw-process-api",
            fallback: "sw",
            timestamp: new Date().toISOString()
        });
    }
    if (method !== "POST") {
        return processApiJsonResponse({ ok: false, error: "Method not allowed", fallback: "sw" }, 405);
    }
    const raw = await request.text();
    const body = parseBody(raw);
    const contentType = String(body?.contentType || "").toLowerCase();
    /* WHY: image/base64 shares must hit Fastify recognize — SW chat/completions fetch fails
     * (`fetch failed`) and used to be returned as the final 200. */
    const skipLocal =
        contentType === "base64" ||
        contentType.startsWith("image") ||
        String(body?.processingType || "").includes("recognize");
    if (!skipLocal) {
        const local = await runLocalProcessFallback(body, "sw");
        if (local && local.ok !== false) return processApiJsonResponse(local);
    }

    try {
        /* INVARIANT: fetch() inside the SW goes to the network, not this handler. */
        const net = await fetch(request.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: raw || "{}",
            cache: "no-store"
        });
        if (net.ok) {
            const type = net.headers.get("content-type") || "";
            if (type.includes("json") || type.includes("text/plain")) return net;
            const text = await net.clone().text();
            if (text && !/^\s*</.test(text)) return net;
        }
    } catch {
        /* miss */
    }
    return processApiJsonResponse(processApiMissPayload("sw"));
};

export const isProcessApiRequest = (pathname: string, method?: string): boolean => {
    if (!isProcessApiPath(pathname)) return false;
    const m = String(method || "GET").toUpperCase();
    return m === "GET" || m === "HEAD" || m === "POST";
};
