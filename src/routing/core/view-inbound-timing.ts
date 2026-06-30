/**
 * Scheduling helpers for unified view ingress (launch-queue, share-target, pending replay, mail, …).
 *
 * WHY: Ingress can arrive mid shell transition before render sinks attach; pacing delivery (RAF
 * fences, MutationObserver until connected / `[data-render-target]`, subtree animation settle) plus
 * per-view serialization avoids stale markdown and reorder races across bursts.
 */

import type { View } from "shells/types";
import type { UnifiedMessage } from "com/core/UnifiedMessaging";

// ---------------------------------------------------------------------------
// Payload heuristics (file / attachment-bearing messages)
// ---------------------------------------------------------------------------

function getViewHTMLElement(view: View): HTMLElement | null {
    try {
        if (typeof HTMLElement !== "undefined" && view instanceof HTMLElement) {
            return view;
        }
    } catch {
        /* ignore instanceof quirks across realms */
    }
    return null;
}

function payloadRecordContainsRenderableFiles(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const rec = payload as Record<string, unknown>;

    const hasFileLike = (v: unknown): boolean =>
        (typeof File !== "undefined" && v instanceof File) || (typeof Blob !== "undefined" && v instanceof Blob);

    if (hasFileLike(rec.file) || hasFileLike(rec.blob)) return true;

    const files = rec.files;
    if (Array.isArray(files) && files.some((x) => hasFileLike(x))) return true;

    const attachments = rec.attachments;
    if (Array.isArray(attachments)) {
        for (const a of attachments) {
            if (!a || typeof a !== "object") continue;
            const data = (a as { data?: unknown }).data;
            if (hasFileLike(data)) return true;
        }
    }

    return false;
}

function payloadContainsRenderableFilesDeep(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const rec = payload as Record<string, unknown>;
    if (payloadRecordContainsRenderableFiles(rec)) return true;
    const nested = rec.data;
    if (nested && typeof nested === "object" && payloadRecordContainsRenderableFiles(nested as Record<string, unknown>)) {
        return true;
    }
    const topAtt = rec.attachments;
    if (Array.isArray(topAtt)) {
        for (const a of topAtt) {
            if (!a || typeof a !== "object") continue;
            const data = (a as { data?: unknown }).data;
            const has =
                (typeof File !== "undefined" && data instanceof File) ||
                (typeof Blob !== "undefined" && data instanceof Blob);
            if (has) return true;
        }
    }
    return false;
}

const FILE_INGRESS_TYPES = new Set([
    "content-share",
    "share-target-input",
    "share-target-result",
    "content-attach",
    "file-attach"
]);

/** Narrow heuristic: ingress that carries blobs/files benefits from delayed delivery. */
export function shouldDeferIngressForRenderableFiles(message: UnifiedMessage, mappedType: string): boolean {
    if (!FILE_INGRESS_TYPES.has(String(mappedType || "").toLowerCase())) return false;

    const top = message as Record<string, unknown>;
    return payloadContainsRenderableFilesDeep(top);
}

// ---------------------------------------------------------------------------
// Broad deferral + paint / DOM settle
// ---------------------------------------------------------------------------

/** Lightweight control handlers — skipping timing fences keeps sliders/toggles responsive. */
const SKIP_UNIFIED_INGRESS_TIMING = new Set(["settings-update", "history-update", "home-update"]);

/**
 * Most unified ingress paths should settle the host before calling `handleMessage`.
 * WHY: Applies to viewer, Work Center attachments, explorer saves, staged mail, … not launch-queue-only.
 */
export function shouldDeferUnifiedIngressUntilStable(_message: UnifiedMessage, mappedType: string): boolean {
    return !SKIP_UNIFIED_INGRESS_TIMING.has(String(mappedType || "").toLowerCase());
}

/** One frame + microtask — enough when the viewer host and sinks already exist (common for launch-queue bursts). */
async function quickPaintFence(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
}

/**
 * Softer barrier when the DOM still needs layout (first paint / route change): double RAF without an extra idle delay.
 */
async function stepPaintFenceModerate(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
}

const MO_CONNECTED_MS = 220;
const MO_SINK_MS = 280;
/** Cap how long we wait on enter transitions so a burst of opens still reaches the latest file quickly. */
const ANIM_CAP_DEFAULT_MS = 160;
const ANIM_CAP_HOT_PATH_MS = 90;

/** Minimal shell (no HTMLElement view host): one frame before mutating viewer state — was too slow with full fence. */
export async function settleIngressPaintForMinimalShell(): Promise<void> {
    await quickPaintFence();
}

export async function waitUntilViewConnectedToDocument(view: View, timeoutMs = MO_CONNECTED_MS): Promise<void> {
    const el = getViewHTMLElement(view);
    if (!el) return;
    if (el.isConnected) return;
    const rootEl =
        typeof document !== "undefined" && document.documentElement instanceof HTMLElement ? document.documentElement : null;
    if (!rootEl) return;

    await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            try {
                mo.disconnect();
            } catch {
                /* noop */
            }
            clearTimeout(tid);
            resolve();
        };
        const mo = new MutationObserver(() => {
            if (el.isConnected) finish();
        });
        mo.observe(rootEl, { childList: true, subtree: true });
        const tid = setTimeout(finish, timeoutMs);
    });
}

const RENDER_SINK_SELECTORS = ["[data-render-target]", "[data-raw-target]"] as const;

function shallowSinkPresent(host: HTMLElement): boolean {
    for (const sel of RENDER_SINK_SELECTORS) {
        try {
            if (host.querySelector(sel)) return true;
            if (host.shadowRoot?.querySelector(sel)) return true;
        } catch {
            /* noop */
        }
    }
    return false;
}

function needsRenderableSinkWait(mappedType: string, message: UnifiedMessage): boolean {
    const mt = String(mappedType || "").toLowerCase();
    if (mt === "content-load" || mt === "markdown-content" || mt === "content-view") return true;
    return shouldDeferIngressForRenderableFiles(message, mappedType);
}

export async function waitForRenderableSinkMounted(view: View, timeoutMs = MO_SINK_MS): Promise<void> {
    const el = getViewHTMLElement(view);
    if (!el) return;
    if (shallowSinkPresent(el)) return;

    await new Promise<void>((resolve) => {
        let done = false;
        const observers: MutationObserver[] = [];
        const finish = () => {
            if (done) return;
            done = true;
            for (const ob of observers) {
                try {
                    ob.disconnect();
                } catch {
                    /* noop */
                }
            }
            clearTimeout(tid);
            resolve();
        };

        const onMut = () => {
            if (shallowSinkPresent(el)) finish();
        };

        const watch = (root: Node) => {
            const mo = new MutationObserver(onMut);
            mo.observe(root, { childList: true, subtree: true });
            observers.push(mo);
        };

        watch(el);
        if (el.shadowRoot) watch(el.shadowRoot);

        const tid = setTimeout(finish, timeoutMs);
        onMut();
    });
}

async function waitRunningSubtreeAnimations(view: View, hangMs = ANIM_CAP_DEFAULT_MS): Promise<void> {
    const el = getViewHTMLElement(view);
    if (!el?.isConnected) return;

    try {
        const getAnims =
            typeof (el as unknown as HTMLElement & { getAnimations?: (opts?: object) => Animation[] }).getAnimations ===
            "function"
                ? (el as unknown as HTMLElement & { getAnimations: (opts?: object) => Animation[] }).getAnimations.bind(el)
                : null;
        const anims = getAnims ? getAnims({ subtree: true }).filter((a) => a.playState === "running") : [];
        if (anims.length === 0) return;

        await Promise.race([
            Promise.all(
                anims.map((a) =>
                    typeof a?.finished?.then === "function" ? a.finished.catch(() => undefined) : Promise.resolve()
                )
            ),
            new Promise<void>((resolve) => setTimeout(resolve, hangMs))
        ]);
    } catch {
        /* non-fatal */
    }
}

/** Full settle pipeline before `handleMessage` on HTMLElement-backed hosts. */
export async function settleIngressTargetBeforeDelivery(
    view: View,
    message: UnifiedMessage,
    mappedType: string
): Promise<void> {
    const el = getViewHTMLElement(view);
    const needSink = needsRenderableSinkWait(mappedType, message);
    const hotPath = Boolean(el?.isConnected && (!needSink || shallowSinkPresent(el)));

    if (hotPath) {
        await quickPaintFence();
        await waitRunningSubtreeAnimations(view, ANIM_CAP_HOT_PATH_MS);
        return;
    }

    await stepPaintFenceModerate();
    await waitUntilViewConnectedToDocument(view, MO_CONNECTED_MS);
    if (needSink) {
        await waitForRenderableSinkMounted(view, MO_SINK_MS);
    }
    await waitRunningSubtreeAnimations(view, ANIM_CAP_DEFAULT_MS);
    await quickPaintFence();
}

/**
 * Compatibility: previously file-only callers ran `waitAfterViewStableForIngress` standalone.
 * New pipeline is {@link settleIngressTargetBeforeDelivery}; this retains animation settling only.
 */
export async function waitAfterViewStableForIngress(view: View): Promise<void> {
    await waitRunningSubtreeAnimations(view, ANIM_CAP_DEFAULT_MS);
}

const ingressDeliveryChains = new WeakMap<View, Promise<void>>();

/** Serialize ingress bursts per concrete View identity (HTMLElement instance). */
export function scheduleSerialViewIngressDelivery(view: View, task: () => Promise<void>): Promise<void> {
    const prev = ingressDeliveryChains.get(view) ?? Promise.resolve();
    const next = prev
        .then(() => task())
        .catch((err) => {
            console.warn("[ViewIngress] delivery failed:", (view as { id?: string })?.id, err);
        });
    ingressDeliveryChains.set(view, next);
    return next;
}
