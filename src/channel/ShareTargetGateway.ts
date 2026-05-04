/**
 * Helpers for moving share-target payloads between the service worker, Cache
 * Storage, and the foreground app.
 *
 * WHY: share-target launches often happen before the main app is ready. These
 * helpers persist the payload in browser-managed caches so the UI can consume
 * it later without depending on a live in-memory handoff.
 */
import { API_ENDPOINTS } from "com/config/Names";

export const SHARE_CACHE_NAME = "share-target-data";
export const SHARE_CACHE_KEY = "/share-target-data";
export const SHARE_FILES_MANIFEST_KEY = "/share-target-files";
export const SHARE_FILE_PREFIX = "/share-target-file/";

export type CachedShareFileMeta = {
    key: string;
    name: string;
    type: string;
    size: number;
    lastModified?: number;
};

export type CachedShareTargetMeta = Record<string, unknown> & {
    source?: string;
    route?: string;
    timestamp?: number;
    title?: string;
    text?: string;
    url?: string;
    sharedUrl?: string;
    fileCount?: number;
    imageCount?: number;
};

export type CachedShareTargetPayload = {
    meta: CachedShareTargetMeta;
    files: File[];
    fileMeta: CachedShareFileMeta[];
};

export type SwCachedContentItem = {
    key: string;
    context?: string;
    content?: unknown;
};

const hasCaches = (): boolean =>
    typeof globalThis !== "undefined" && "caches" in globalThis;

/** Persist the last share-target payload so the app can recover it after navigation or cold start. */
export const storeShareTargetPayloadToCache = async (payload: { files: File[]; meta?: Record<string, unknown> }): Promise<boolean> => {
    if (!hasCaches()) return false;

    const files = Array.isArray(payload.files) ? payload.files : [];
    const meta = payload.meta ?? {};

    try {
        const cache = await caches.open(SHARE_CACHE_NAME);
        const timestamp = Number(meta?.timestamp) || Date.now();

        await cache.put(
            SHARE_CACHE_KEY,
            new Response(JSON.stringify({
                ...meta,
                title: meta?.title,
                text: meta?.text,
                url: meta?.url,
                sharedUrl: meta?.sharedUrl,
                source: meta?.source || "share-target",
                route: meta?.route || meta?.source || "share-target",
                timestamp,
                fileCount: files.length,
                imageCount: files.filter((f) => (f?.type || "").toLowerCase().startsWith("image/")).length
            }), { headers: { "Content-Type": "application/json" } })
        );

        const fileManifest: CachedShareFileMeta[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const key = `${SHARE_FILE_PREFIX}${timestamp}-${i}`;

            const headers = new Headers();
            headers.set("Content-Type", file.type || "application/octet-stream");
            headers.set("X-File-Name", encodeURIComponent(file.name || `file-${i}`));
            headers.set("X-File-Size", String(file.size || 0));
            headers.set("X-File-LastModified", String((file as any).lastModified ?? 0));

            await cache.put(key, new Response(file, { headers }));
            fileManifest.push({
                key,
                name: file.name || `file-${i}`,
                type: file.type || "application/octet-stream",
                size: file.size || 0,
                lastModified: (file as any).lastModified ?? undefined
            });
        }

        await cache.put(
            SHARE_FILES_MANIFEST_KEY,
            new Response(JSON.stringify({ files: fileManifest, timestamp }), {
                headers: { "Content-Type": "application/json" }
            })
        );

        return true;
    } catch (error) {
        console.warn("[ShareTargetGateway] Failed to store payload to cache:", error);
        return false;
    }
};

/**
 * Rehydrate the cached share-target payload and optionally clear the consumed
 * cache entries so they are not replayed on the next app load.
 */
export const consumeCachedShareTargetPayload = async (opts: { clear?: boolean } = {}): Promise<CachedShareTargetPayload | null> => {
    const clear = opts.clear !== false;
    if (!hasCaches()) return null;

    try {
        const cache = await caches.open(SHARE_CACHE_NAME);
        const metaResp = await cache.match(SHARE_CACHE_KEY);
        const manifestResp = await cache.match(SHARE_FILES_MANIFEST_KEY);
        if (!metaResp && !manifestResp) return null;

        const meta = metaResp ? await metaResp.json().catch(() => null) : null;
        const manifest = manifestResp ? await manifestResp.json().catch(() => null) : null;
        const fileMeta: CachedShareFileMeta[] = Array.isArray(manifest?.files) ? manifest.files : [];

        const files: File[] = [];
        for (const fm of fileMeta) {
            const fileKey = typeof fm?.key === "string" ? fm.key.trim() : String(fm?.key ?? "").trim();
            if (!fileKey) continue;
            const response = await cache.match(fileKey);
            if (!response) continue;
            const blob = await response.blob();
            files.push(new File([blob], fm.name || "shared-file", {
                type: fm.type || blob.type || "application/octet-stream",
                lastModified: Number(fm.lastModified) || Date.now()
            }));
        }

        if (clear) {
            await cache.delete(SHARE_CACHE_KEY).catch(() => { });
            await cache.delete(SHARE_FILES_MANIFEST_KEY).catch(() => { });
            for (const fm of fileMeta) {
                if (fm?.key) await cache.delete(fm.key).catch(() => { });
            }
        }

        return { meta: (meta || {}) as CachedShareTargetMeta, files, fileMeta };
    } catch (error) {
        console.warn("[ShareTargetGateway] Failed to consume cached payload:", error);
        return null;
    }
};

/**
 * Convert the staged cache payload back into a share/launch transfer object that
 * the foreground pipeline can route without caring whether the ingress was
 * share-target, launch-queue, or another staged producer.
 */
export const buildShareDataFromCachedPayload = (payload: CachedShareTargetPayload): Record<string, unknown> => {
    const meta = payload?.meta || {};
    const files = Array.isArray(payload?.files) ? payload.files : [];
    return {
        ...meta,
        title: typeof meta.title === "string" ? meta.title : undefined,
        text: typeof meta.text === "string" ? meta.text : undefined,
        url: typeof meta.url === "string" ? meta.url : undefined,
        sharedUrl: typeof meta.sharedUrl === "string" ? meta.sharedUrl : undefined,
        source: typeof meta.source === "string" ? meta.source : "share-target",
        route: typeof meta.route === "string" ? meta.route : (typeof meta.source === "string" ? meta.source : "share-target"),
        timestamp: Number(meta.timestamp || Date.now()),
        files,
        fileCount: files.length || Number(meta.fileCount || 0),
        imageCount: Number(meta.imageCount || files.filter((file) => (file?.type || "").toLowerCase().startsWith("image/")).length)
    };
};

/** Read the service worker's advertised cached content entries through the HTTP bridge. */
export const fetchSwCachedEntries = async (): Promise<SwCachedContentItem[]> => {
    try {
        const response = await fetch(API_ENDPOINTS.SW_CONTENT_AVAILABLE);
        if (!response.ok) return [];
        const data = await response.json();
        const keys = Array.isArray(data?.cacheKeys) ? data.cacheKeys : [];
        const content: SwCachedContentItem[] = [];

        for (const cacheKey of keys) {
            const key = String(cacheKey?.key || "");
            if (!key) continue;
            try {
                const contentResponse = await fetch(`${API_ENDPOINTS.SW_CONTENT}/${key}`);
                if (!contentResponse.ok) continue;
                content.push({
                    key,
                    context: String(cacheKey?.context || ""),
                    content: await contentResponse.json()
                });
            } catch (error) {
                console.warn("[ShareTargetGateway] Failed to fetch SW cache item:", error);
            }
        }
        return content;
    } catch (error) {
        console.warn("[ShareTargetGateway] Failed to fetch SW cache entries:", error);
        return [];
    }
};

/** Fetch share-target files exposed by the service worker-side manifest endpoint. */
export const fetchCachedShareFiles = async (cacheKey = "latest"): Promise<File[]> => {
    try {
        const response = await fetch(`/share-target-files?cacheKey=${encodeURIComponent(cacheKey)}`);
        if (!response.ok) return [];
        const manifest = await response.json();
        const fileItems = Array.isArray(manifest?.files) ? manifest.files : [];
        const files: File[] = [];

        for (const item of fileItems) {
            const fileUrl = typeof item?.key === "string" ? item.key : "";
            if (!fileUrl) continue;
            try {
                const fileResponse = await fetch(fileUrl);
                if (!fileResponse.ok) continue;
                const fileBlob = await fileResponse.blob();
                files.push(new File([fileBlob], item.name || "shared-file", {
                    type: item.type || fileBlob.type || "application/octet-stream"
                }));
            } catch (error) {
                console.warn("[ShareTargetGateway] Failed to fetch file from cache:", error);
            }
        }
        return files;
    } catch (error) {
        console.warn("[ShareTargetGateway] Failed to fetch cached share files:", error);
        return [];
    }
};
