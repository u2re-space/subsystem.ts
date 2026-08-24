/*
 * Filename: history-base.ts
 * FullPath: modules/projects/subsystem/src/boot/history-base.ts
 * FIND:history-base
 * Change date and time: 23.20.00_24.08.2026
 * Reason for changes: Named SKU hosts (md.u2re.space) must not treat /viewer as a History base — that + Fastify alias-strip is a bootloop.
 */

const KNOWN_PATH_MOUNTS = [
    "cwsp",
    "transfer",
    "markdown",
    "document",
    "viewer",
    "explorer",
    "workcenter",
    "process",
    "kvm"
] as const;

/** Dedicated PWA hosts — app lives at `/`. Hub/LAN keep `/markdown` `/viewer` path mounts. */
const DEDICATED_SKU_HOSTS = [
    "md.u2re.space",
    "www.md.u2re.space",
    "explorer.u2re.space",
    "www.explorer.u2re.space",
    "process.u2re.space",
    "workcenter.u2re.space",
    "cwsp.u2re.space",
    "www.cwsp.u2re.space",
    "transfer.u2re.space"
] as const;

export function isDedicatedSkuHost(hostname?: string): boolean {
    try {
        const host = String(
            hostname ??
                (globalThis as unknown as { location?: { hostname?: string } }).location?.hostname ??
                ""
        ).toLowerCase();
        return (DEDICATED_SKU_HOSTS as readonly string[]).includes(host);
    } catch {
        return false;
    }
}

export function isKnownPathMountSegment(segment: string): boolean {
    return (KNOWN_PATH_MOUNTS as readonly string[]).includes(String(segment || "").toLowerCase());
}

/**
 * On a named SKU host, `/viewer` `/markdown` `/explorer` … are Fastify aliases of `/`, not view routes.
 * WHY: minimal path-routing wrote `/viewer?shell=minimal` → 302 `/viewer/` → 302 `/` → bootloop.
 */
export function pathForSkuHostView(viewPath: string): string {
    let path = String(viewPath || "/").trim() || "/";
    if (!path.startsWith("/")) path = `/${path}`;
    if (!isDedicatedSkuHost()) return path;
    const seg = path.replace(/^\/+/, "").split("/")[0] || "";
    if (seg && isKnownPathMountSegment(seg)) return "/";
    return path;
}

/**
 * Router base path without trailing slash ("" at domain root, "/cwsp" on IP path mount).
 * WHY: absolute `/network` history entries drop the Fastify debugPath prefix and 404 on reload.
 */
export function getHistoryBasePath(): string {
    try {
        const fromData = String(
            (globalThis as unknown as { document?: Document }).document?.documentElement?.dataset
                ?.cwspRouterBase || ""
        ).trim();
        if (fromData) {
            const normalized = fromData.startsWith("/") ? fromData : `/${fromData}`;
            return normalized.replace(/\/+$/, "") || "";
        }

        const doc = (globalThis as unknown as { document?: Document }).document;
        const baseHref = doc?.querySelector?.("base")?.getAttribute("href");
        if (baseHref && baseHref !== "/" && !baseHref.startsWith(".")) {
            const origin =
                (globalThis as unknown as { location?: { origin?: string } }).location?.origin ||
                "http://localhost";
            const u = new URL(baseHref, origin);
            return u.pathname.replace(/\/+$/, "") || "";
        }

        // INVARIANT: md.u2re.space `/viewer` is the document view path, not a `/viewer` mount.
        if (isDedicatedSkuHost()) return "";

        const pathname = String(
            (globalThis as unknown as { location?: { pathname?: string } }).location?.pathname || "/"
        );
        const re = new RegExp(`^/(${KNOWN_PATH_MOUNTS.join("|")})(?:/|$)`, "i");
        const m = pathname.match(re);
        if (m?.[1]) return `/${m[1].toLowerCase()}`;
    } catch {
        /* ignore */
    }
    return "";
}

/** Prefix an absolute app path with the history base (`/network` → `/cwsp/network`). */
export function withHistoryBase(pathname: string): string {
    const base = getHistoryBasePath();
    let path = String(pathname || "/").trim() || "/";
    if (!path.startsWith("/")) path = `/${path}`;
    if (!base) return path;
    if (path === base || path.startsWith(`${base}/`)) return path;
    if (path === "/") return `${base}/`;
    return `${base}${path}`;
}

/** Strip history base from a location pathname before view matching. */
export function stripHistoryBase(pathname: string): string {
    const base = getHistoryBasePath();
    let path = String(pathname || "/");
    if (!path.startsWith("/")) path = `/${path}`;
    if (!base) return path;
    if (path === base || path === `${base}/`) return "/";
    if (path.startsWith(`${base}/`)) {
        const rest = path.slice(base.length);
        return rest.startsWith("/") ? rest : `/${rest}`;
    }
    return path;
}

/** Persist detected mount on `<html>` so later navigations stay scoped. */
export function ensureHistoryBaseDataset(): string {
    const base = getHistoryBasePath();
    try {
        const el = (globalThis as unknown as { document?: Document }).document?.documentElement;
        if (el && base) el.dataset.cwspRouterBase = base;
    } catch {
        /* ignore */
    }
    return base;
}
