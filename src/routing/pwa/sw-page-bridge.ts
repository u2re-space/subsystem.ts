/*
 * Filename: sw-page-bridge.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-page-bridge.ts
 * FIND:sw-page
 * TAG:process,sw-result
 *
 * Page-side SW ↔ Work Center delivery. Replays pending after SW update,
 * bfcache, or a result that landed while the view was unbound.
 */
import { unifiedMessaging } from "../channel/UnifiedMessaging";
import { unwrapSwInteropMessage } from "../channel/UniformInterop";
import { postWorkCenterCommand } from "../channel/workcenter-command-wire";
import { readProcessApiResultText } from "../api/process-api-result";
import {
    consumeCachedShareTargetPayload,
    buildShareDataFromCachedPayload
} from "../channel/ShareTargetGateway";
import { PROCESS_PENDING_PATH } from "./sw-result-wire";

const RESULT_TYPES = new Set([
    "ai-result",
    "share-target-result",
    "share-target-input",
    "share-received",
    "process-api-result",
    "content-cached",
    "content-received",
    "pending-operations",
    "commit-to-clipboard"
]);

let bound = false;
const seenKeys = new Set<string>();

const remember = (key: string): boolean => {
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    if (seenKeys.size > 48) {
        const first = seenKeys.values().next().value;
        if (first) seenKeys.delete(first);
    }
    return true;
};

const resultKey = (type: string, text: string, raw: unknown): string => {
    const id = raw && typeof raw === "object" ? String((raw as { id?: unknown }).id || "") : "";
    const files = raw && typeof raw === "object" && Array.isArray((raw as { files?: unknown }).files)
        ? (raw as { files: Array<{ name?: string; size?: number }> }).files
        : [];
    const fileSig = files.map((file) => `${file?.name || ""}:${file?.size || 0}`).join(",");
    return id || `${type}:${text.replace(/\s+/g, " ").slice(0, 400)}:${fileSig}`;
};

const asWorkCenterPayload = (type: string, data: unknown, text: string): Record<string, unknown> => {
    if (data && typeof data === "object") {
        const row = data as Record<string, unknown>;
        if (type === "share-target-input" || type === "share-received") {
            return { ...row, source: row.source || "share-target" };
        }
        if (type === "ai-result" || type === "process-api-result") {
            return row.success != null || row.data != null || row.fallback != null
                ? row
                : { success: true, data: text || row, rawData: row };
        }
        if (row.content != null || row.rawData != null) return row;
    }
    return {
        content: text,
        rawData: data,
        timestamp: Date.now(),
        source: "service-worker"
    };
};

const hydrateShareInput = async (data: unknown): Promise<Record<string, unknown>> => {
    const base = data && typeof data === "object" ? { ...(data as Record<string, unknown>) } : {};
    const inline = Array.isArray(base.files)
        ? base.files.filter((file): file is File => typeof File !== "undefined" && file instanceof File)
        : [];
    if (inline.length) {
        return { ...base, files: inline, fileCount: inline.length, source: base.source || "share-target" };
    }
    try {
        const cached = await consumeCachedShareTargetPayload({ clear: false });
        if (!cached) return { ...base, source: base.source || "share-target" };
        const built = buildShareDataFromCachedPayload(cached) as Record<string, unknown>;
        const files = Array.isArray(cached.files) ? cached.files : [];
        return {
            ...base,
            ...built,
            files,
            fileCount: files.length || Number(base.fileCount || built.fileCount || 0),
            text: base.text || built.text,
            title: base.title || built.title,
            url: base.url || built.url || built.sharedUrl,
            source: "share-target"
        };
    } catch {
        return { ...base, source: base.source || "share-target" };
    }
};

export const deliverShareTargetInput = async (data: unknown): Promise<boolean> => {
    const payload = await hydrateShareInput(data);
    return deliverSwResultToWorkCenter("share-target-input", payload, String(payload.text || payload.title || ""));
};

export const deliverSwResultToWorkCenter = async (
    type: string,
    data: unknown,
    extraText = ""
): Promise<boolean> => {
    if (type === "share-received") return deliverShareTargetInput(data);
    const text = extraText.trim() || readProcessApiResultText(data);
    const key = resultKey(type, text, data);
    if (!remember(key)) return false;
    const payload = asWorkCenterPayload(type, data, text);
    postWorkCenterCommand({
        type: "ingress.apply",
        payload: { type, data: payload, content: text }
    });
    try {
        await unifiedMessaging.sendMessage({
            type,
            source: "sw-page-bridge",
            destination: "workcenter",
            data: payload,
            metadata: { priority: "high", fromServiceWorker: true }
        } as Parameters<typeof unifiedMessaging.sendMessage>[0]);
    } catch {
        /* command bus already posted */
    }
    return true;
};

export const ingestSwClientMessage = (value: unknown): boolean => {
    const unwrapped = unwrapSwInteropMessage(value);
    if (!unwrapped) return false;
    const type = unwrapped.type;
    if (!RESULT_TYPES.has(type)) return false;
    if (type === "pending-operations" && Array.isArray(unwrapped.operations)) {
        for (const operation of unwrapped.operations) {
            const row = operation as { type?: string; data?: unknown };
            if (row?.type === "ai-result" || row?.data) {
                void deliverSwResultToWorkCenter("ai-result", row.data ?? row);
            }
        }
        return true;
    }
    if (type === "commit-to-clipboard" && Array.isArray(unwrapped.results)) {
        for (const result of unwrapped.results) {
            const row = result as { data?: unknown };
            if (row?.data) void deliverSwResultToWorkCenter("ai-result", row.data);
        }
        return true;
    }
    if (type === "share-received" || type === "share-target-input") {
        void deliverShareTargetInput(unwrapped.data);
        return true;
    }
    void deliverSwResultToWorkCenter(type, unwrapped.data);
    return true;
};

const replayProcessPending = async (): Promise<void> => {
    try {
        const loc = (globalThis as { location?: Location }).location;
        if (!loc || !/^https?:$/.test(String(loc.protocol || ""))) return;
        const href = String(loc.href || "");
        if (href.startsWith("chrome-extension://") || href.startsWith("moz-extension://")) return;
        const response = await fetch(PROCESS_PENDING_PATH, { cache: "no-store" });
        const type = String(response.headers.get("content-type") || "").toLowerCase();
        if (!response.ok || !type.includes("application/json")) return;
        const json = (await response.json()) as { operations?: Array<{ id?: string; type?: string; text?: string; raw?: unknown; data?: unknown }> };
        const operations = Array.isArray(json?.operations) ? json.operations : [];
        if (!operations.length) return;
        for (const operation of operations) {
            const opType = String(operation.type || "process-api-result");
            const payload = operation.raw ?? operation.data ?? operation;
            if (opType === "share-received" || opType === "share-target-input") {
                await deliverShareTargetInput(payload);
                continue;
            }
            await deliverSwResultToWorkCenter(opType, payload, String(operation.text || ""));
        }
        await fetch(PROCESS_PENDING_PATH, { method: "DELETE", cache: "no-store" }).catch(() => undefined);
    } catch {
        /* pending route is SW-only */
    }
};

/** Bind SW postMessage + deferred replay. Idempotent. */
export const bindSwPageBridge = (): (() => void) => {
    if (bound) return () => undefined;
    bound = true;
    const onSwMessage = (event: MessageEvent): void => {
        ingestSwClientMessage(event.data);
    };
    try {
        navigator.serviceWorker?.addEventListener("message", onSwMessage);
    } catch {
        /* no SW */
    }
    const replayShareCache = (): void => {
        void consumeCachedShareTargetPayload({ clear: false })
            .then((cached) => {
                if (!cached) return;
                const age = Date.now() - Number(cached.meta?.timestamp || Date.now());
                if (age > 5 * 60 * 1000) return;
                const hasFiles = Array.isArray(cached.files) && cached.files.length > 0;
                const meta = cached.meta || {};
                if (!hasFiles && !meta.text && !meta.url && !meta.title) return;
                return deliverShareTargetInput({ ...meta, files: cached.files, source: "share-target" });
            })
            .catch(() => undefined);
    };
    const replay = (): void => {
        void replayProcessPending();
        replayShareCache();
        void unifiedMessaging.processQueuedMessages("workcenter").catch(() => undefined);
    };
    const onShow = (): void => replay();
    const onVisible = (): void => {
        if ((globalThis as { document?: Document }).document?.visibilityState === "visible") replay();
    };
    globalThis.addEventListener?.("pageshow", onShow);
    globalThis.addEventListener?.("online", onShow);
    globalThis.addEventListener?.("visibilitychange", onVisible);
    try {
        navigator.serviceWorker?.addEventListener("controllerchange", onShow);
    } catch {
        /* ignore */
    }
    replay();
    return () => {
        bound = false;
        try {
            navigator.serviceWorker?.removeEventListener("message", onSwMessage);
            navigator.serviceWorker?.removeEventListener("controllerchange", onShow);
        } catch {
            /* ignore */
        }
        globalThis.removeEventListener?.("pageshow", onShow);
        globalThis.removeEventListener?.("online", onShow);
        globalThis.removeEventListener?.("visibilitychange", onVisible);
    };
};
