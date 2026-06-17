import type { ViewId } from "shells/types";

export const VIEW_ENABLED_VIEWER = "viewer";
export const VIEW_ENABLED_EDITOR = "editor";
export const VIEW_ENABLED_WORKCENTER = "workcenter";
export const VIEW_ENABLED_EXPLORER = "explorer";
export const VIEW_ENABLED_SETTINGS = "settings";
export const VIEW_ENABLED_HISTORY = "history";
export const VIEW_ENABLED_HOME = "home";
export const VIEW_ENABLED_PRINT = "print";
/** AirPad (remote trackpad/keyboard + clipboard) — used by the Capacitor shell and PWA. */
export const VIEW_ENABLED_AIRPAD = "airpad";
/** CWSP connection / probe diagnostics — primary Capacitor (CWSAndroid) home view. */
export const VIEW_ENABLED_NETWORK = "network";
export const DEFAULT_VIEW_ID = "viewer";

const VIEW_FLAGS: Record<string, string> = {
    network: VIEW_ENABLED_NETWORK,
    airpad: VIEW_ENABLED_AIRPAD,
    settings: VIEW_ENABLED_SETTINGS,
    viewer: VIEW_ENABLED_VIEWER,
    editor: VIEW_ENABLED_EDITOR,
    workcenter: VIEW_ENABLED_WORKCENTER,
    explorer: VIEW_ENABLED_EXPLORER,
    history: VIEW_ENABLED_HISTORY,
    home: VIEW_ENABLED_HOME,
    print: VIEW_ENABLED_PRINT,
};

/**
 * Optional per-build allowlist: `VITE_ENABLED_VIEWS="network,settings"` restricts
 * which views are enabled (e.g. the Capacitor CWSAndroid shell: Network + Settings
 * only). When unset, all flagged views are enabled. Read from Vite env first,
 * then Node env, guarded for non-bundled (tsx) contexts.
 */
const readEnabledViewsAllowlist = (): Set<string> | null => {
    let raw = "";
    // 1) Runtime URL query (`?views=network,settings`) — lets the SAME frontend
    //    bundle act as the restricted Capacitor shell without a separate build.
    try {
        const search = (globalThis as any)?.location?.search;
        if (search) {
            const params = new URLSearchParams(search);
            raw = String(params.get("views") || params.get("enabledViews") || "");
        }
    } catch {
        /* no location */
    }
    // 2) Persisted runtime choice.
    if (!raw) {
        try {
            raw = String((globalThis as any)?.localStorage?.getItem?.("rs-enabled-views") ?? "");
        } catch {
            /* no localStorage */
        }
    }
    // 3) Build-time Vite env, then Node env.
    if (!raw) {
        try {
            raw = String((import.meta as any)?.env?.VITE_ENABLED_VIEWS ?? "");
        } catch {
            /* not a Vite context */
        }
    }
    if (!raw) {
        try {
            raw = String((globalThis as any)?.process?.env?.VITE_ENABLED_VIEWS ?? "");
        } catch {
            /* no process env */
        }
    }
    const list = raw
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    if (!list.length) return null;
    // `settings` is always kept reachable so users can reconfigure.
    list.push("settings");
    // Persist a URL-provided choice so reloads/back-nav keep the restriction.
    try {
        const search = (globalThis as any)?.location?.search;
        if (search && new URLSearchParams(search).get("views")) {
            (globalThis as any)?.localStorage?.setItem?.("rs-enabled-views", Array.from(new Set(list)).join(","));
        }
    } catch {
        /* ignore */
    }
    return new Set(list);
};

const ENABLED_VIEWS_ALLOWLIST = readEnabledViewsAllowlist();

/**
 * Build-time gate: the host bundler (CrossWord Vite) replaces `__RS_VIEW_<ID>__`
 * with a boolean from `VITE_ENABLED_VIEWS`. `typeof` is safe for undeclared
 * globals (returns "undefined") so non-bundled/tsx contexts fall back to enabled.
 */
const BUILD_VIEW_FLAGS: Record<string, boolean | undefined> = {
    viewer: typeof __RS_VIEW_VIEWER__ !== "undefined" ? __RS_VIEW_VIEWER__ : undefined,
    editor: typeof __RS_VIEW_EDITOR__ !== "undefined" ? __RS_VIEW_EDITOR__ : undefined,
    workcenter: typeof __RS_VIEW_WORKCENTER__ !== "undefined" ? __RS_VIEW_WORKCENTER__ : undefined,
    explorer: typeof __RS_VIEW_EXPLORER__ !== "undefined" ? __RS_VIEW_EXPLORER__ : undefined,
    settings: typeof __RS_VIEW_SETTINGS__ !== "undefined" ? __RS_VIEW_SETTINGS__ : undefined,
    history: typeof __RS_VIEW_HISTORY__ !== "undefined" ? __RS_VIEW_HISTORY__ : undefined,
    home: typeof __RS_VIEW_HOME__ !== "undefined" ? __RS_VIEW_HOME__ : undefined,
    print: typeof __RS_VIEW_PRINT__ !== "undefined" ? __RS_VIEW_PRINT__ : undefined,
    airpad: typeof __RS_VIEW_AIRPAD__ !== "undefined" ? __RS_VIEW_AIRPAD__ : undefined,
    network: typeof __RS_VIEW_NETWORK__ !== "undefined" ? __RS_VIEW_NETWORK__ : undefined
};

const buildAllows = (viewId: string): boolean => BUILD_VIEW_FLAGS[String(viewId).toLowerCase()] !== false;

const runtimeAllows = (viewId: string): boolean =>
    !ENABLED_VIEWS_ALLOWLIST || ENABLED_VIEWS_ALLOWLIST.has(String(viewId).toLowerCase());

const isViewAllowed = (viewId: string): boolean => buildAllows(viewId) && runtimeAllows(viewId);

export const ENABLED_VIEW_IDS = Object.entries(VIEW_FLAGS)
    .filter(([viewId, enabled]) => Boolean(enabled) && isViewAllowed(viewId))
    .map(([viewId]) => viewId as ViewId);

export const isEnabledView = (viewId: string): viewId is ViewId => {
    return Boolean(VIEW_FLAGS[viewId]) && isViewAllowed(viewId);
};

export const pickEnabledView = (
    preferred: ViewId | string = DEFAULT_VIEW_ID,
    fallback: ViewId | string = DEFAULT_VIEW_ID
): ViewId => {
    if (isEnabledView(preferred)) return preferred;
    if (isEnabledView(fallback)) return fallback;
    if (ENABLED_VIEW_IDS.length > 0) return ENABLED_VIEW_IDS[0];
    return "viewer";
};
