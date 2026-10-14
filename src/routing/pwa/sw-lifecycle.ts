/*
 * Filename: sw-lifecycle.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-lifecycle.ts
 * FIND:sw-url
 * TAG:sw-warmup,share-static-route
 *
 * SW install/activate so a new worker does not sit in "waiting to activate".
 * INVARIANT: skipWaiting + clients.claim; SKIP_WAITING is unwrapped (Uniform mail).
 * PERF: cold share-target POST uses the network (app + runtime) via InstallEvent.addRoutes.
 * PERF: `/assets/user-wallpaper` is served from Cache `cwsp-user-wallpaper` before the worker starts.
 * The fetch handler stays the plan when the worker is already running, or when addRoutes is missing.
 */

type SwScope = {
    skipWaiting?: () => Promise<void> | void;
    clients?: { claim?: () => Promise<void> | void };
    addEventListener?: (type: string, listener: (event: Event) => void) => void;
};

type ShareStaticRule = {
    condition: {
        urlPattern: string;
        requestMethod: "post";
        runningStatus: "not-running";
    };
    source: "network";
};

/** INVARIANT: same path and cache name as `fest/image` `USER_WALLPAPER_*`. */
export const USER_WALLPAPER_PATH = "/assets/user-wallpaper";
export const USER_WALLPAPER_CACHE = "cwsp-user-wallpaper";

type WallpaperStaticRule = {
    condition: {
        urlPattern: string;
        requestMethod: "get";
    };
    source: { cacheName: string };
};

type StaticRoute = ShareStaticRule | WallpaperStaticRule;

const SHARE_TARGET_PATHS = [
    "/share-target",
    "/share-target/",
    "/share_target",
    "/share_target/",
    "/*/share-target",
    "/*/share-target/",
    "/*/share_target",
    "/*/share_target/"
];

/**
 * Static routes for OS share POST.
 * WHY: `or` cannot be combined with `requestMethod` ([addRoutes](https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes)).
 * Cold worker: browser fetches the app origin (runtime `handleSharePost` → `?shared=1`).
 * Running worker: rule misses, existing `fetch` handler remains the backup.
 */
export const shareTargetStaticRoutes = (): ShareStaticRule[] =>
    SHARE_TARGET_PATHS.map((urlPattern) => ({
        condition: {
            urlPattern,
            requestMethod: "post",
            runningStatus: "not-running"
        },
        source: "network"
    }));

/**
 * Custom wallpaper GET, from the named cache even when the worker is not running.
 * WHY: [addRoutes](https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes)
 * applies before service-worker startup, so the stock file is not the first paint.
 * A missing cache falls through to the network (the page then uses IndexedDB).
 */
export const userWallpaperStaticRoutes = (): WallpaperStaticRule[] => [
    {
        condition: { urlPattern: USER_WALLPAPER_PATH, requestMethod: "get" },
        source: { cacheName: USER_WALLPAPER_CACHE }
    }
];

export const installShareTargetStaticRoutes = (event: Event): void => {
    const install = event as ExtendableEvent & {
        addRoutes?: (rules: StaticRoute[]) => Promise<void>;
    };
    if (typeof install.addRoutes !== "function") return;
    const pending = install
        .addRoutes([...shareTargetStaticRoutes(), ...userWallpaperStaticRoutes()])
        .catch(() => undefined);
    install.waitUntil?.(pending);
};

/** Running worker backup when `addRoutes` is unavailable. */
export const matchCachedUserWallpaper = async (request: Request): Promise<Response | undefined> => {
    try {
        const path = new URL(request.url).pathname;
        if (path !== USER_WALLPAPER_PATH && !path.endsWith(USER_WALLPAPER_PATH)) return undefined;
        const cache = await caches.open(USER_WALLPAPER_CACHE);
        return (await cache.match(USER_WALLPAPER_PATH)) || undefined;
    } catch {
        return undefined;
    }
};

const skipWaitingType = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === "string") return value === "SKIP_WAITING" || value === "skipWaiting";
    if (typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const type = String(row.type || row.what || "");
    return type === "SKIP_WAITING" || type === "skipWaiting";
};

export const attachSwLifecycle = (scope: SwScope = self as unknown as SwScope): void => {
    const skip = (): Promise<void> => Promise.resolve(scope.skipWaiting?.()).then(() => undefined);

    scope.addEventListener?.("install", (event) => {
        installShareTargetStaticRoutes(event);
        (event as ExtendableEvent).waitUntil?.(skip());
    });

    scope.addEventListener?.("activate", (event) => {
        (event as ExtendableEvent).waitUntil?.(Promise.resolve(scope.clients?.claim?.()).then(() => undefined));
    });

    scope.addEventListener?.("message", (event) => {
        const data = (event as MessageEvent).data;
        if (!skipWaitingType(data)) return;
        (event as ExtendableEvent).waitUntil?.(skip());
    });
};
