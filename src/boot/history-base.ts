/*
 * Filename: history-base.ts
 * FullPath: modules/projects/subsystem/src/boot/history-base.ts
 * Change date and time: 21.55.00_19.07.2026
 * Reason for changes: Keep History API under VDS path mounts (/cwsp, /markdown) so reload ≠ 404.
 */

const KNOWN_PATH_MOUNTS = ["cwsp", "markdown", "kvm"] as const;

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
