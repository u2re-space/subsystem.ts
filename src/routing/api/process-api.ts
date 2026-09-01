/*
 * Filename: process-api.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-api.ts
 * FIND:process
 * Change date: 15.10.00_01.09.2026
 * Reason: LAN / CRX / Capacitor hit process.u2re.space; dedicated process hosts stay same-origin.
 *
 * INVARIANT: POST work stays on /api/process/* (COMPAT /api/processing still works on :443).
 * INVARIANT: chrome-extension:, Capacitor, and LAN IP must not fetch a relative /api path.
 * INVARIANT: process.u2re.space / ai.u2re.space / workcenter.u2re.space stay same-origin.
 */

export const PROCESS_API_PUBLIC_ORIGIN = "https://process.u2re.space";
export const PROCESS_API_PREFIX = "/api/process";

export type ProcessApiSuffix = "processing" | "recognize" | "analyze" | "health";

export type ProcessApiAuth = {
    userId?: string;
    userKey?: string;
    accessToken?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    mcp?: unknown;
};

const PROCESS_API_SUFFIX: Record<ProcessApiSuffix, string> = {
    processing: "processing",
    recognize: "ai/recognize",
    analyze: "ai/analyze",
    health: "health"
};

const PROCESS_SAME_ORIGIN_HOSTS = new Set([
    "process.u2re.space",
    "workcenter.u2re.space",
    "ai.u2re.space",
    "u2re.space",
    "www.u2re.space"
]);

const isExtensionProtocol = (protocol: string): boolean =>
    protocol === "chrome-extension:" || protocol === "moz-extension:" || protocol === "safari-web-extension:";

const isCapacitorNative = (): boolean => {
    try {
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        return typeof g.Capacitor?.isNativePlatform === "function" && g.Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/** Dedicated process / hub hosts stay same-origin. Everything else uses https://process.u2re.space. */
export const needsRemoteProcessApi = (): boolean => {
    try {
        const protocol = String(globalThis.location?.protocol || "").toLowerCase();
        if (isExtensionProtocol(protocol)) return true;
        if (isCapacitorNative()) return true;
        const host = String(globalThis.location?.hostname || "").toLowerCase();
        if (!host) return true;
        return !PROCESS_SAME_ORIGIN_HOSTS.has(host);
    } catch {
        return true;
    }
};

export const processApiPath = (suffix: ProcessApiSuffix = "processing"): string =>
    `${PROCESS_API_PREFIX}/${PROCESS_API_SUFFIX[suffix]}`;

export const resolveProcessApiUrl = (suffix: ProcessApiSuffix = "processing"): string => {
    const path = processApiPath(suffix);
    return needsRemoteProcessApi() ? `${PROCESS_API_PUBLIC_ORIGIN}${path}` : path;
};

/** True for public / legacy process API paths that must not SPA-fallback to index.html. */
export const isProcessApiPath = (pathname: string): boolean => {
    const path = String(pathname || "").split("?")[0] || "/";
    return (
        path === PROCESS_API_PREFIX ||
        path.startsWith(`${PROCESS_API_PREFIX}/`) ||
        path === "/api/processing" ||
        path.startsWith("/process/ai") ||
        path.startsWith("/process/processing") ||
        path.startsWith("/process/api") ||
        path === "/process/health"
    );
};

export const processApiSuffixFromPath = (path: string): ProcessApiSuffix => {
    const value = String(path || "").split("?")[0].toLowerCase();
    if (value.includes("recognize")) return "recognize";
    if (value.includes("analyze")) return "analyze";
    if (value.includes("health")) return "health";
    return "processing";
};

export const processApiAuthFromSettings = (
    settings:
        | {
              core?: {
                  userId?: string;
                  userKey?: string;
                  socket?: { accessToken?: string; airpadAuthToken?: string };
              };
              ai?: { apiKey?: string; baseUrl?: string; model?: string; mcp?: unknown };
          }
        | null
        | undefined
): ProcessApiAuth => {
    const core = settings?.core || {};
    const socket = core.socket || {};
    const accessToken = String(socket.accessToken || socket.airpadAuthToken || "").trim();
    return {
        userId: String(core.userId || "").trim() || undefined,
        userKey: String(core.userKey || "").trim() || undefined,
        accessToken: accessToken || undefined,
        apiKey: String(settings?.ai?.apiKey || "").trim() || undefined,
        baseUrl: String(settings?.ai?.baseUrl || "").trim() || undefined,
        model: String(settings?.ai?.model || "").trim() || undefined,
        mcp: Array.isArray(settings?.ai?.mcp) ? settings.ai.mcp : undefined
    };
};

/** True when :443 never reached a working CWSP core — caller should run in-browser AI. */
export const isProcessApiUnavailable = (posted: {
    ok: boolean;
    status: number;
    json: unknown;
    error?: string;
}): boolean => {
    if (posted.status === 0 || posted.status >= 500) return true;
    const error = String(posted.error || "").toLowerCase();
    if (/failed to fetch|networkerror|econnrefused|certificate|aborted/.test(error)) return true;
    if (!posted.json || typeof posted.json !== "object") return !posted.ok;
    const row = posted.json as { ok?: unknown; layer?: unknown; error?: unknown; hint?: unknown };
    if (row.ok !== false) return false;
    const detail = `${row.error || ""} ${row.hint || ""}`.toLowerCase();
    return row.layer === "api" || /unreachable|econnrefused|certificate|bad gateway/.test(detail);
};

export const readProcessApiResultText = (json: unknown): string => {
    if (!json || typeof json !== "object") return "";
    const row = json as Record<string, unknown>;
    if (row.ok === false || row.success === false) return "";
    const inner = row.result && typeof row.result === "object" ? (row.result as Record<string, unknown>) : null;
    const candidates = [row.data, inner?.data, inner?.text, inner?.content, row.text, row.result];
    for (const item of candidates) {
        if (typeof item === "string" && item.trim()) return item;
    }
    return "";
};

export const postProcessApi = async (
    suffix: ProcessApiSuffix,
    body: Record<string, unknown> = {},
    auth?: ProcessApiAuth,
    init?: { signal?: AbortSignal }
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> => {
    const url = resolveProcessApiUrl(suffix);
    const payload = {
        ...body,
        ...(auth?.userId ? { userId: auth.userId } : {}),
        ...(auth?.userKey ? { userKey: auth.userKey } : {}),
        ...(auth?.accessToken ? { accessToken: auth.accessToken } : {}),
        ...(auth?.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(auth?.baseUrl ? { baseUrl: auth.baseUrl } : {}),
        ...(auth?.model ? { model: auth.model } : {}),
        ...(auth?.mcp ? { mcp: auth.mcp } : {})
    };
    try {
        const isGet = suffix === "health";
        const res = await fetch(url, {
            method: isGet ? "GET" : "POST",
            headers: isGet
                ? { Accept: "application/json" }
                : { "Content-Type": "application/json", Accept: "application/json" },
            body: isGet ? undefined : JSON.stringify(payload),
            signal: init?.signal
        });
        const text = await res.text();
        let json: unknown = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = { ok: false, error: text };
        }
        return { ok: res.ok, status: res.status, json };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            json: null,
            error: String(error instanceof Error ? error.message : error)
        };
    }
};
