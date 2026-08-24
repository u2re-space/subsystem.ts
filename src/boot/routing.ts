/**
 * Routing System
 *
 * Canonical-root routing for views.
 * 
 * Routes:
 * - `GET /{view}` → compatibility entry; app normalizes to `/` and opens that view in shell state.
 * - `POST /{view}` → In-app API (PWA: service worker; dev: Vite middleware): request body is relayed
 *   on BroadcastChannel `rs-view-{view}`; use `postViewApi()` from `frontend/shared/view-api`.
 * - `/` → canonical app URL (home shell entry; boot-selected shell)
 * - `/viewer` → Viewer
 * - `/workcenter` → Work Center
 * - `/settings` → Settings (hub areas: `/settings/explorer`, `/settings/transfer` ≡ `/settings/cwsp`, `/settings/markdown` ≡ `/settings/viewer`, `/settings/process` ≡ `/settings/workcenter`)
 * - `/explorer` → Explorer
 * - `/history` → History
 * - `/editor` → Editor
 * - `/print` → Print view
 * 
 * Shell is configured separately (via preferences), not encoded in URL pathname.
 *
 * WHY: the pathname tracks the requested view, while shell choice is treated as
 * local UI state that can vary by device/viewport without changing deep links.
 * NOTE: the `POST /{view}` route is part of the app's internal messaging path,
 * so service-worker/network debugging often crosses this file even though it is
 * not a socket transport module by itself.
 */

import type { ShellId, ViewId, Shell } from "shells/types";
import type { FrontendChoice } from "./boot-menu";
import { bootMinimal, bootBase, bootWindow, bootTabbed, bootEnvironment, bootContent, bootImmersive, type BootConfig, type StyleSystem } from "./BootLoader";
import { ENABLED_VIEW_IDS, DEFAULT_VIEW_ID, isEnabledView, pickEnabledView } from "shared/routing/views";
import {
    coerceShellForBootViewport,
    getDefaultBootShellId,
    normalizeBootShellId,
    promoteSoftMinimalShellPreference,
    readLastActiveBootShell,
    resolveForcedBootShell
} from "./shell-preference";
import {
    ensureHistoryBaseDataset,
    getHistoryBasePath,
    isDedicatedSkuHost,
    pathForSkuHostView,
    stripHistoryBase,
    withHistoryBase
} from "./history-base";
import {
    canonicalHubSettingsSection,
    hubSettingsSectionPath
} from "../other/config/settings/settings-shell-profile";

// ============================================================================
// ROUTE TYPES
// ============================================================================

/** Default view when URL/localStorage do not specify one (Capacitor: Network home). */
const resolveShellDefaultView = (shell: ShellId): ViewId => {
    if (shell === "minimal" && isEnabledView("network")) return "network";
    if (shell === "base" || shell === "immersive" || shell === "minimal") return "viewer";
    return "home";
};

export interface Route {
    view: ViewId;
    params?: Record<string, string>;
}

export interface RouteConfig {
    views: ViewId[];
    defaultView: ViewId;
}

export type AppLoaderResult = {
    mount: (el: HTMLElement) => Promise<void>;
    shell?: Shell;
};

export type RoutingMode = "path-based";
export type NavigateOptions = { replace?: boolean; state?: unknown };
export type RouteHandler = (route: Route) => void | Promise<void>;

const normalizeShellPreference = (shell: ShellId | null | undefined): ShellId =>
    normalizeBootShellId(shell);

export const getShellFromQuery = (): ShellId | null => {
    // WHY: u2re.space hub ignores `?shell=` (bookmarks often carry minimal from Cap/control).
    if (resolveForcedBootShell()) {
        return null;
    }
    try {
        const params = new URLSearchParams(location.search);
        const shell = (params.get("shell") || "").trim().toLowerCase();
        if (
            shell === "minimal" ||
            shell === "faint" ||
            shell === "base" ||
            shell === "window" ||
            shell === "tabbed" ||
            shell === "environment" ||
            shell === "content" ||
            shell === "immersive"
        ) {
            return normalizeShellPreference(shell as ShellId);
        }
    } catch {
        // Ignore malformed URL params
    }
    return null;
};

// ============================================================================
// ROUTE CONFIG
// ============================================================================

/** All registered view routes */
export const VALID_VIEWS: ViewId[] = [
    ...ENABLED_VIEW_IDS
];

const DEFAULT_CONFIG: RouteConfig = {
    views: VALID_VIEWS,
    defaultView: pickEnabledView("home", DEFAULT_VIEW_ID)
};

// ============================================================================
// ROUTE PARSING
// ============================================================================

/**
 * Normalize pathname (remove history/VDS base, leading/trailing slashes)
 */
function normalizePathname(pathname: string): string {
    ensureHistoryBaseDataset();
    const stripped = stripHistoryBase(pathname);
    const base = document.querySelector("base")?.getAttribute("href") || "/";
    let normalized = stripped;
    if (base !== "/" && !base.startsWith(".") && stripped.startsWith(base.replace(/\/$/, ""))) {
        normalized = stripped.slice(base.replace(/\/$/, "").length);
    }
    return normalized.replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Parse current URL into route
 */
export function parseCurrentRoute(config = DEFAULT_CONFIG): Route {
    const pathname = normalizePathname(location.pathname);
    const params = Object.fromEntries(new URLSearchParams(location.search));

    // Map pathname to view (`/markdown` / `/document` are document aliases for viewer).
    let view: ViewId = config.defaultView;
    const aliases: Record<string, ViewId> = {
        markdown: "viewer",
        document: "viewer",
        md: "viewer",
        files: "explorer",
        fm: "explorer",
        process: "workcenter",
        transfer: "network",
        admin: "settings"
    };
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    const first = segments[0] || "";
    if (last === "settings" || first === "settings") {
        view = "settings";
        if (first === "settings" && last && last !== "settings") {
            const aliases: Record<string, string> = {
                explorer: "explorer",
                cwsp: "transfer",
                transfer: "transfer",
                viewer: "markdown",
                markdown: "markdown",
                document: "markdown",
                md: "markdown",
                process: "process",
                workcenter: "process",
                shell: "hub",
                hub: "hub"
            };
            const section = aliases[last];
            if (section) params.section = section;
        }
        if (last === "admin" || first === "admin") params.admin = "1";
    } else if (last === "admin" || first === "admin") {
        view = "settings";
        params.admin = "1";
    } else {
        const mapped = aliases[pathname] || aliases[first] || first;
        if (mapped && config.views.includes(mapped as ViewId)) {
            view = mapped as ViewId;
        } else {
            const mount = getHistoryBasePath().replace(/^\/+/, "").toLowerCase();
            const mountDefault: Record<string, ViewId> = {
                markdown: "viewer",
                document: "viewer",
                viewer: "viewer",
                explorer: "explorer",
                workcenter: "workcenter",
                process: "workcenter",
                cwsp: "network",
                transfer: "network"
            };
            const fromMount = mount ? mountDefault[mount] : null;
            const host = String(location.hostname || "").toLowerCase();
            const hostDefault: Record<string, ViewId> = {
                "md.u2re.space": "viewer",
                "www.md.u2re.space": "viewer",
                "explorer.u2re.space": "explorer",
                "www.explorer.u2re.space": "explorer",
                "process.u2re.space": "workcenter",
                "workcenter.u2re.space": "workcenter",
                "cwsp.u2re.space": "network",
                "transfer.u2re.space": "network"
            };
            const fromHost = hostDefault[host] || null;
            const picked = fromMount || fromHost;
            if (picked && config.views.includes(picked)) view = picked;
        }
    }

    return { view, params };
}

/**
 * Check if current URL is the root/home
 */
export function isRootRoute(): boolean {
    const pathname = normalizePathname(location.pathname);
    return pathname === "" || pathname === "/";
}

/**
 * Build URL from route.
 * WHY: prefer `/${view}?…` so environment/native deep links stay readable
 * (`/settings?shell=environment&native=1`), not root `/?view=settings`.
 */
export function buildUrl(route: Route): string {
    ensureHistoryBaseDataset();
    const view = String(route.view || "").trim().replace(/^\/+/, "").toLowerCase();
    const params = { ...(route.params || {}) };
    let path: string;
    if (view === "settings") {
        const section = hubSettingsSectionPath(
            canonicalHubSettingsSection(String(params.section || "").trim())
        );
        delete params.section;
        path = section
            ? withHistoryBase(`/settings/${section}`)
            : withHistoryBase("/settings");
    } else {
        path =
            view && view !== "home"
                ? withHistoryBase(pathForSkuHostView(`/${view}`))
                : withHistoryBase("/");
    }
    let url = path;

    if (Object.keys(params).length > 0) {
        const search = new URLSearchParams(params).toString();
        url += (url.includes("?") ? "&" : "?") + search;
    }

    return url;
}

/**
 * Build URL for root
 */
export function buildRootUrl(): string {
    ensureHistoryBaseDataset();
    return withHistoryBase("/");
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Navigate to a route (view)
 */
export function navigate(route: Route, options: NavigateOptions = {}): void {
    const url = buildUrl(route);

    if (options.replace) {
        history.replaceState(options.state ?? route, "", url);
    } else {
        history.pushState(options.state ?? route, "", url);
    }

    globalThis?.dispatchEvent?.(new CustomEvent("route-change", { detail: route }));
}

/**
 * Navigate to a view
 */
export function navigateToView(view: ViewId, params?: Record<string, string>): void {
    navigate({ view, params });
}

/**
 * Navigate to root (boot menu / shell selection)
 */
export function navigateToRoot(): void {
    const url = buildRootUrl();
    history.pushState({ view: null }, "", url);
    globalThis?.dispatchEvent?.(new CustomEvent("route-change", { detail: { view: null } }));
}

export const goBack = () => history.back();
export const goForward = () => history.forward();

// ============================================================================
// ROUTE MATCHING
// ============================================================================

/**
 * Check if a view is valid
 */
export function isValidView(view: string): view is ViewId {
    return isEnabledView(view);
}

/**
 * Get view from pathname
 */
export function getViewFromPath(): ViewId | null {
    const pathname = normalizePathname(location.pathname);
    
    if (!pathname || pathname === "/" || pathname === "") {
        const fromState = (history.state?.viewId || "") as string;
        if (fromState && isValidView(fromState)) {
            return fromState;
        }
        return null;
    }
    
    if (isValidView(pathname)) {
        return pathname;
    }
    const first = pathname.split("/").filter(Boolean)[0] || "";
    if (first === "settings") return "settings";
    
    return null;
}

// ============================================================================
// ROUTE LISTENERS
// ============================================================================

type RouteListener = (route: Route | null) => void;
const listeners: Set<RouteListener> = new Set();

/**
 * Subscribe to route changes
 */
export function onRouteChange(listener: RouteListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Initialize route listening
 */
export function initRouteListening(): void {
    globalThis?.addEventListener?.("popstate", () => {
        const view = getViewFromPath();
        const params = Object.fromEntries(new URLSearchParams(location.search));
        listeners.forEach(l => l(view ? { view, params } : null));
    });

    globalThis?.addEventListener?.("route-change", (e) => {
        const route = (e as CustomEvent).detail as Route | null;
        listeners.forEach(l => l(route));
    });
}

// ============================================================================
// SHELL-BASED APP LOADING
// ============================================================================

/**
 * Get saved shell preference
 */
export function getSavedShellPreference(): ShellId | null {
    const forced = resolveForcedBootShell();
    if (forced) {
        try {
            localStorage.setItem("rs-boot-shell", forced);
        } catch {
            // Ignore storage issues
        }
        return forced;
    }

    // Dedicated SKU hosts + hub sibling mounts open as standalone modules.
    try {
        if (isDedicatedSkuHost() || getHistoryBasePath()) {
            return getShellFromQuery() || "minimal";
        }
    } catch {
        /* ignore */
    }

    const fromQuery = getShellFromQuery();
    if (fromQuery) {
        try {
            localStorage.setItem("rs-boot-shell", fromQuery);
        } catch {
            // Ignore storage issues
        }
        // Explicit `?shell=` wins (including minimal); do not soft-promote.
        return coerceShellForBootViewport(fromQuery);
    }

    try {
        const saved = localStorage.getItem("rs-boot-shell");
        if (
            saved === "minimal" ||
            saved === "faint" ||
            saved === "base" ||
            saved === "window" ||
            saved === "tabbed" ||
            saved === "environment" ||
            saved === "content" ||
            saved === "immersive"
        ) {
            const normalized = normalizeShellPreference(saved as ShellId);
            if (normalized !== saved) {
                localStorage.setItem("rs-boot-shell", normalized);
            }
            // WHY: older installs persisted soft default `minimal`; promote to environment on desktop.
            return promoteSoftMinimalShellPreference(normalized);
        }

        const lastActive = readLastActiveBootShell();
        if (lastActive && lastActive !== "immersive" && lastActive !== "content") {
            return promoteSoftMinimalShellPreference(lastActive);
        }
    } catch {
        // Ignore
    }
    return getDefaultBootShellId();
}

/**
 * Resolve the shell/view pair to mount and return a lazy mount entrypoint.
 *
 * AI-READ: this function does not mount immediately. It chooses the canonical
 * shell, normalizes legacy aliases, picks a default view for that shell, and
 * returns a loader object that the outer app entry can mount into the chosen
 * shell layer.
 */
export const loadSubAppWithShell = async (
    shellId?: ShellId,
    initialView?: ViewId
): Promise<AppLoaderResult> => {
    // INVARIANT: VDS hub always mounts environment regardless of caller/query/localStorage.
    const shell = normalizeShellPreference(
        resolveForcedBootShell() || shellId || getSavedShellPreference() || getDefaultBootShellId()
    );
    const shellDefaultView = resolveShellDefaultView(shell);
    /*
     * WHY: mono `?native=1` with a path view (`/settings`) must boot that view, not Home.
     * When path was stripped to `/` but `view=` query remains, honor it.
     */
    let nativeViewHint: ViewId | null = null;
    try {
        const sp = new URLSearchParams(location.search || "");
        if (sp.get("native") === "1" || sp.get("native") === "true") {
            const qView = (sp.get("view") || "").trim().toLowerCase();
            if (qView && isEnabledView(qView)) nativeViewHint = qView as ViewId;
        }
    } catch {
        /* ignore */
    }
    const view = pickEnabledView(
        initialView || getViewFromPath() || nativeViewHint || shellDefaultView,
        "home"
    );
    
    console.log('[App] Loading sub-app with shell:', shell, 'view:', view);

    try {
        switch (shell) {
            case "faint":
            case "tabbed":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootTabbed(el, view);
                    }
                };

            case "environment":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootEnvironment(el, view);
                    }
                };

            case "base":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootBase(el, view);
                    }
                };

            case "immersive":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootImmersive(el, view);
                    }
                };

            case "content":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootContent(el, view);
                    }
                };

            case "window":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootWindow(el, view);
                    }
                };

            case "minimal":
                return {
                    mount: async (el: HTMLElement) => {
                        await bootMinimal(el, view);
                    }
                };

            default:
                return {
                    mount: async (el: HTMLElement) => {
                        await bootMinimal(el, view);
                    }
                };
        }
    } catch (error) {
        console.error('[App] Failed to load sub-app:', shell, error);
        throw error;
    }
};

/**
 * Load boot menu for shell selection
 */
export const loadBootMenu = async (): Promise<AppLoaderResult> => {
    const module = await import("./boot-menu");
    return {
        mount: async (el: HTMLElement) => {
            await module.default(el);
        }
    };
};

// ============================================================================
// ROUTE RESOLUTION
// ============================================================================

/**
 * Resolve pathname to view ID (returns null for root)
 */
export function resolvePathToView(pathname: string): ViewId | null {
    const normalized = pathname.replace(/^\//, "").toLowerCase().trim();
    
    if (!normalized || normalized === "/" || normalized === "") {
        return null;
    }
    
    if (isValidView(normalized)) {
        return normalized;
    }
    
    return DEFAULT_VIEW_ID; // Default fallback
}

/**
 * Create the boot configuration that BootLoader expects from current URL and
 * saved shell preference state.
 */
export function createBootConfigFromUrl(): BootConfig {
    const shell = normalizeShellPreference(getSavedShellPreference() || getDefaultBootShellId());
    const shellDefaultView = resolveShellDefaultView(shell);
    const view = pickEnabledView(getViewFromPath() || shellDefaultView, "home");
    const params = Object.fromEntries(new URLSearchParams(location.search));

    let styleSystem: StyleSystem = "vl-basic";

    switch (shell) {
        case "faint":
        case "tabbed":
        case "environment":
            styleSystem = "vl-basic";
            break;
        case "base":
            styleSystem = "vl-core";
            break;
        case "content":
            styleSystem = "vl-basic";
            break;
        case "window":
            styleSystem = "vl-basic";
            break;
        default:
            styleSystem = "vl-basic";
    }

    return {
        styleSystem,
        shell,
        defaultView: view,
        channels: [view as any],
        rememberChoice: !params.shared
    };
}

// ============================================================================
// URL PARAMETER HANDLING  
// ============================================================================

/**
 * Parse URL parameters for routing
 */
export function parseRoutingParams(): {
    view: ViewId | null;
    params: Record<string, string>;
    isRoot: boolean;
} {
    const view = getViewFromPath();
    const params: Record<string, string> = {};
    
    const searchParams = new URLSearchParams(location.search);
    for (const [key, value] of searchParams) {
        params[key] = value;
    }

    return { 
        view, 
        params, 
        isRoot: view === null 
    };
}

// ============================================================================
// DEPRECATED - For backwards compatibility during transition
// These functions are kept for legacy code support but should not be used
// in new code. Use the modern path-based routing functions instead.
// ============================================================================

/**
 * @deprecated Use `resolvePathToView` instead
 */
export const resolvePathToChoice = (pathname: string): FrontendChoice => {
    const view = resolvePathToView(pathname);
    return view ? "minimal" : "";
};

/**
 * @deprecated Use `navigateToView` instead
 */
export const setViewHash = (view: ViewId, _replace = false): void => {
    navigateToView(view);
};

/**
 * @deprecated Use `getViewFromPath` instead
 */
export const getViewFromHash = (): ViewId | null => getViewFromPath();

/**
 * @deprecated Shells are no longer encoded in URL - use localStorage preference
 */
export const navigateToShell = (shell: ShellId, view?: ViewId): void => {
    try {
        localStorage.setItem("rs-boot-shell", normalizeShellPreference(shell));
    } catch {
        // Storage unavailable
    }
    if (view) navigateToView(view);
};
