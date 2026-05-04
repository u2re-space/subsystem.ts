import type { AppSettings } from "./SettingsTypes";

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/u, "") || "";

const normalizeAdminPath = (raw: string | undefined): string => {
    const t = (raw ?? "/").trim() || "/";
    return t.startsWith("/") ? t : `/${t}`;
};

const hostFromEndpointUrl = (endpointUrl: string | undefined): string | null => {
    const ep = (endpointUrl || "").trim();
    if (!ep) return null;
    try {
        return new URL(ep).hostname || null;
    } catch {
        return null;
    }
};

const resolveControlDoorUrls = (
    core: AppSettings["core"] | undefined,
    pathOverride?: string
): { https: string; http: string } => {
    const path = normalizeAdminPath(pathOverride ?? core?.admin?.path);
    let httpsOrigin = (core?.admin?.httpsOrigin || "").trim();
    let httpOrigin = (core?.admin?.httpOrigin || "").trim();
    const host = hostFromEndpointUrl(core?.endpointUrl);
    if (host) {
        if (!httpsOrigin) httpsOrigin = `https://${host}:8443`;
        if (!httpOrigin) httpOrigin = `http://${host}:8080`;
    }
    if (!httpsOrigin) httpsOrigin = "https://localhost:8443";
    if (!httpOrigin) httpOrigin = "http://localhost:8080";

    const join = (origin: string): string => {
        const base = trimTrailingSlashes(origin);
        if (path === "/") return `${base}/`;
        return `${base}${path}`;
    };

    return { https: join(httpsOrigin), http: join(httpOrigin) };
};

/**
 * Resolves HTTPS (default :8443) and HTTP (default :8080) admin/control URLs for the CWS / cwsp endpoint.
 * When `core.admin.*` is empty, uses `endpointUrl` hostname with standard ports, then localhost.
 */
export function resolveAdminDoorUrls(core: AppSettings["core"] | undefined): { https: string; http: string } {
    return resolveControlDoorUrls(core);
}

export function resolveDevicesDoorUrls(core: AppSettings["core"] | undefined): { https: string; http: string } {
    return resolveControlDoorUrls(core, "/devices");
}

export function openAdminDoorUrl(url: string, target = "_blank"): void {
    try {
        globalThis.open?.(url, target, "noopener,noreferrer");
    } catch {
        /* non-fatal */
    }
}

export function openAdminDoorFromCore(
    core: AppSettings["core"] | undefined,
    protocol: "https" | "http"
): void {
    const urls = resolveAdminDoorUrls(core);
    openAdminDoorUrl(protocol === "https" ? urls.https : urls.http);
}

export function openDevicesDoorFromCore(
    core: AppSettings["core"] | undefined,
    protocol: "https" | "http"
): void {
    const urls = resolveDevicesDoorUrls(core);
    openAdminDoorUrl(protocol === "https" ? urls.https : urls.http);
}
