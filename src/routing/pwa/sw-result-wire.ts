/*
 * Filename: sw-result-wire.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-result-wire.ts
 * FIND:sw-result
 * TAG:process,sw-page
 *
 * SW-safe fan-out for AI / Process results. No DOM, no UnifiedMessaging.
 * INVARIANT: live clients get postMessage + BroadcastChannel; closed pages
 * recover via GET /process/pending.
 */
import { BROADCAST_CHANNELS } from "../../other/config/Names.ts";
import { postWorkCenterCommand } from "../channel/workcenter-command-wire.ts";
import { readProcessApiResultText } from "../api/process-api-result.ts";
import { safeCacheMatch, safeCacheOpen, safeCachePut } from "./sw-cache.ts";
import { PROCESS_SHARE_LANDING_PATH } from "./sw-sku-landing.ts";

export { shareLandingPath, SHARE_LANDING_BY_SKU } from "./sw-sku-landing.ts";

export const PROCESS_PENDING_PATH = "/process/pending";
/** Process PWA share landing — Work Center consumes `?shared=1` + cache. */
export const SHARE_LANDING_PATH = PROCESS_SHARE_LANDING_PATH;

const PENDING_CACHE = "rs-process-pending-v1";
const PENDING_CACHE_URL = "/process/pending.json";
const PENDING_CAP = 10;

export type PendingProcessResult = {
    id: string;
    type: string;
    text: string;
    raw: unknown;
    timestamp: number;
};

const loadPending = async (): Promise<PendingProcessResult[]> => {
    try {
        const cache = await safeCacheOpen(PENDING_CACHE);
        const response = await safeCacheMatch(cache, PENDING_CACHE_URL);
        if (!response) return [];
        const json = (await response.json()) as { operations?: PendingProcessResult[] };
        return Array.isArray(json?.operations) ? json.operations : [];
    } catch {
        return [];
    }
};

const savePending = async (operations: PendingProcessResult[]): Promise<void> => {
    const cache = await safeCacheOpen(PENDING_CACHE);
    if (!cache) return;
    await safeCachePut(
        cache,
        PENDING_CACHE_URL,
        new Response(JSON.stringify({ operations: operations.slice(-PENDING_CAP) }), {
            headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        })
    );
};

export const storePendingProcessResult = async (item: PendingProcessResult): Promise<void> => {
    const operations = await loadPending();
    operations.push(item);
    await savePending(operations);
};

export const readPendingProcessResults = (): Promise<PendingProcessResult[]> => loadPending();

export const clearPendingProcessResults = async (ids?: string[]): Promise<void> => {
    if (!ids?.length) {
        await savePending([]);
        return;
    }
    const keep = new Set(ids);
    const operations = (await loadPending()).filter((item) => !keep.has(item.id));
    await savePending(operations);
};

export const pendingProcessJsonResponse = async (): Promise<Response> =>
    new Response(JSON.stringify({ operations: await loadPending() }), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });

const postChromeRuntime = (type: string, data: unknown, text = ""): void => {
    try {
        const runtime = (
            globalThis as {
                chrome?: { runtime?: { sendMessage?: (msg: unknown, cb?: () => void) => void; lastError?: unknown } };
            }
        ).chrome?.runtime;
        if (typeof runtime?.sendMessage !== "function") return;
        runtime.sendMessage({ type, data, text }, () => {
            void runtime.lastError;
        });
    } catch {
        /* PWA / Capacitor have no chrome.runtime */
    }
};

export const postSwResultToClients = async (type: string, data: unknown): Promise<void> => {
    try {
        const scope = globalThis as unknown as {
            clients?: { matchAll?: (query?: { type?: string; includeUncontrolled?: boolean }) => Promise<Array<{ postMessage: (value: unknown) => void }>> };
        };
        const clients = await scope.clients?.matchAll?.({ type: "window", includeUncontrolled: true });
        if (!clients) return;
        for (const client of clients) {
            client.postMessage({ type, data });
        }
    } catch {
        /* page may not exist yet — pending cache covers that */
    }
};

export type SwFrontendResult = {
    type: string;
    data: unknown;
    text?: string;
    persist?: boolean;
};

/** Live notify + optional pending stash. Safe from Process SW and process-api-sw. */
export const publishSwFrontendResult = (input: SwFrontendResult): void => {
    const text = String(input.text || readProcessApiResultText(input.data) || "").trim();
    const data = input.data;
    try {
        const share = new BroadcastChannel(BROADCAST_CHANNELS.SHARE_TARGET);
        share.postMessage({ type: input.type, data, text });
        share.close();
    } catch {
        /* BroadcastChannel optional in some workers */
    }
    postWorkCenterCommand({
        type: "ingress.apply",
        payload: { type: input.type, data, content: text }
    });
    postChromeRuntime(input.type, data, text);
    void postSwResultToClients(input.type, data);
    if (input.persist === false) return;
    if (!text && input.type !== "share-received" && input.type !== "share-target-input") return;
    void storePendingProcessResult({
        id: `${input.type}-${Date.now()}`,
        type: input.type,
        text: text || input.type,
        raw: stripFilesForPending(data),
        timestamp: Date.now()
    }).catch(() => undefined);
};

const stripFilesForPending = (data: unknown): unknown => {
    if (!data || typeof data !== "object") return data;
    const row = { ...(data as Record<string, unknown>) };
    if ("files" in row) delete row.files;
    if ("imageFiles" in row) delete row.imageFiles;
    return row;
};

/**
 * Share-target fan-out: files stay in Cache Storage; metadata + cloneable File[]
 * go to clients. Existing windows are focused; the POST 302 still lands Work Center.
 */
export const publishSwShareReceived = (data: Record<string, unknown>): void => {
    publishSwFrontendResult({
        type: "share-received",
        data,
        text: String(data.text || data.title || data.url || ""),
        persist: true
    });
    void focusShareClients();
};

const focusShareClients = async (): Promise<void> => {
    try {
        const scope = globalThis as unknown as {
            clients?: {
                matchAll?: (query?: { type?: string; includeUncontrolled?: boolean }) => Promise<
                    Array<{ focus?: () => Promise<unknown> }>
                >;
            };
        };
        const clients = await scope.clients?.matchAll?.({ type: "window", includeUncontrolled: true });
        const first = clients?.[0];
        if (first && typeof first.focus === "function") await first.focus();
    } catch {
        /* share POST 302 still opens the landing page */
    }
};
