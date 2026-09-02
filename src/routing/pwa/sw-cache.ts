/*
 * Filename: sw-cache.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-cache.ts
 * FIND:sw-cache
 * TAG:sw-page,sw-result
 *
 * Cache Storage guards for PWA, CRX, and Capacitor.
 * INVARIANT: Cache API is `match` / `matchAll` / `open` — never `matches`.
 * Missing Cache (CRX MV3 quirks, Capacitor WebView, Node tests) is a no-op.
 */

const originHint = (): string => {
    try {
        const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
        if (origin) return origin;
    } catch {
        /* Worker / Node */
    }
    return "https://localhost";
};

export const toCacheRequestInfo = (
    requestLike: RequestInfo | URL | null | undefined
): RequestInfo | undefined => {
    if (!requestLike) return undefined;
    return requestLike instanceof URL ? requestLike.toString() : requestLike;
};

const cacheKeyString = (request: RequestInfo): string => {
    if (typeof request === "string") return request;
    if (request instanceof Request) return request.url;
    return "";
};

/**
 * Cache#match rejects blob:/data:/non-GET. chrome-extension: is valid in MV3.
 * Relative paths (`/share-target-data`) resolve against the worker origin.
 */
export const isCacheApiKey = (request: RequestInfo): boolean => {
    if (request instanceof Request && String(request.method || "GET").toUpperCase() !== "GET") {
        return false;
    }
    const raw = cacheKeyString(request);
    if (!raw) return false;
    try {
        const url = new URL(raw, originHint());
        const protocol = url.protocol;
        return (
            protocol === "http:" ||
            protocol === "https:" ||
            protocol === "chrome-extension:" ||
            protocol === "moz-extension:"
        );
    } catch {
        return raw.startsWith("/");
    }
};

const asMatchKey = (request: RequestInfo): RequestInfo | undefined => {
    if (typeof request === "string") return request;
    if (typeof Request !== "undefined" && request instanceof Request) return request;
    return undefined;
};

export const cachesApi = (): CacheStorage | null => {
    try {
        const store = (globalThis as { caches?: CacheStorage }).caches;
        return store || null;
    } catch {
        return null;
    }
};

export const safeCacheOpen = async (name: string): Promise<Cache | null> => {
    const store = cachesApi();
    if (!store || typeof store.open !== "function") return null;
    try {
        return await store.open(name);
    } catch {
        return null;
    }
};

export const safeCacheMatch = async (
    cache: Cache | null | undefined,
    requestLike: RequestInfo | URL | null | undefined
): Promise<Response | undefined> => {
    const request = toCacheRequestInfo(requestLike);
    if (!cache || !request) return undefined;
    const key = asMatchKey(request);
    if (!key || !isCacheApiKey(key)) return undefined;
    const match = (cache as Cache & { match?: Cache["match"]; matches?: unknown }).match;
    if (typeof match !== "function") return undefined;
    try {
        return (await match.call(cache, key)) ?? undefined;
    } catch (error) {
        console.warn("[SW] Cache.match failed:", request, error);
        return undefined;
    }
};

export const safeCachesMatch = async (
    requestLike: RequestInfo | URL | null | undefined
): Promise<Response | undefined> => {
    const request = toCacheRequestInfo(requestLike);
    const store = cachesApi();
    if (!request || !store || !isCacheApiKey(request)) return undefined;
    const match = (store as CacheStorage & { match?: CacheStorage["match"] }).match;
    if (typeof match !== "function") return undefined;
    try {
        return (await match.call(store, request)) ?? undefined;
    } catch (error) {
        console.warn("[SW] caches.match failed:", request, error);
        return undefined;
    }
};

export const safeCachePut = async (
    cache: Cache | null | undefined,
    requestLike: RequestInfo | URL | null | undefined,
    response: Response
): Promise<boolean> => {
    const request = toCacheRequestInfo(requestLike);
    if (!cache || !request || typeof cache.put !== "function") return false;
    const key = asMatchKey(request);
    if (!key || !isCacheApiKey(key)) return false;
    try {
        await cache.put(key, response);
        return true;
    } catch (error) {
        console.warn("[SW] Cache.put failed:", request, error);
        return false;
    }
};

export const safeCacheDelete = async (
    cache: Cache | null | undefined,
    requestLike: RequestInfo | URL | null | undefined
): Promise<boolean> => {
    const request = toCacheRequestInfo(requestLike);
    if (!cache || !request || typeof cache.delete !== "function") return false;
    try {
        return await cache.delete(request);
    } catch {
        return false;
    }
};

export const safeCachesKeys = async (): Promise<string[]> => {
    const store = cachesApi();
    if (!store || typeof store.keys !== "function") return [];
    try {
        return await store.keys();
    } catch {
        return [];
    }
};

export const safeCachesDelete = async (name: string): Promise<boolean> => {
    const store = cachesApi();
    if (!store || typeof store.delete !== "function") return false;
    try {
        return await store.delete(name);
    } catch {
        return false;
    }
};
