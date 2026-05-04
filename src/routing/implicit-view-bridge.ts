/**
 * Implicit view messaging bridge — sits outside view implementations.
 *
 * WHY: Shell/registry can bind receive paths explicitly; this layer additionally
 * discovers `View` hosts in the live DOM (including nested additions and shadow roots)
 * and wires the same {@link bindViewReceiveChannel} surface without importing transport
 * into view modules. Uses MutationObserver teardown when hosts detach.
 *
 * DOM staging (same subtree as addedNodes): optional attributes carrying JSON payloads so
 * SW/PWA/shell can drop pending | mail | defer-flush markers without importing views:
 *
 * - `data-cw-unified-pending="{ \"type\":\"content-share\",\"destination\":\"workcenter\",\"data\":{...} }"`
 *   → {@link enqueuePendingMessage} (drained when the destination view binds).
 * - `data-cw-unified-mail="{ ...same shape... }"` → immediate {@link sendProtocolMessage}.
 * - `data-cw-unified-defer-flush="workcenter"` or `"{ \"destination\":\"workcenter\" }"`
 *   → {@link replayQueuedMessagesForDestination} (IndexedDB mail/deferred replay).
 */

import type { View } from "shells/types";
import {
    getDestinationAliases,
    normalizeDestination,
    normalizeViewId
} from "com/config/Names";
import {
    enqueuePendingMessage,
    replayQueuedMessagesForDestination,
    sendProtocolMessage,
    type UnifiedMessage
} from "com/core/UnifiedMessaging";
import {
    bindViewReceiveChannel,
    type ViewReceiveBindingOptions
} from "./channel-mixin";
import { inferViewDestination } from "./view-message-routing";

/** Narrow structural check — imperative APIs (`handleMessage`, `addFiles`, …) stay on the element. */
export function isImplicitViewMessagingHost(node: unknown): node is View {
    if (!node || typeof node !== "object") return false;
    const el = node as Partial<View>;
    return (
        typeof el.handleMessage === "function" &&
        typeof el.id === "string" &&
        el.id.trim().length > 0
    );
}

export const STAGED_UNIFIED_SELECTOR =
    "[data-cw-unified-pending], [data-cw-unified-mail], [data-cw-unified-defer-flush]";

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
    if (!raw?.trim()) return null;
    try {
        const v = JSON.parse(raw) as unknown;
        return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function buildUnifiedMessageFromStaging(rec: Record<string, unknown>): UnifiedMessage | null {
    const destination =
        normalizeDestination(String(rec.destination ?? "")) || String(rec.destination ?? "").trim();
    if (!destination) return null;
    return {
        id: typeof rec.id === "string" ? rec.id : crypto.randomUUID(),
        type: String(rec.type || "content-share"),
        source: typeof rec.source === "string" ? rec.source : "dom-staged-unified",
        destination,
        contentType: typeof rec.contentType === "string" ? rec.contentType : undefined,
        data: (rec.data ?? rec.payload ?? {}) as object,
        metadata: {
            timestamp: Date.now(),
            ...(typeof rec.metadata === "object" && rec.metadata ? (rec.metadata as object) : {})
        }
    } as UnifiedMessage;
}

function readDeferFlushDestination(el: HTMLElement): string | null {
    const raw = el.getAttribute("data-cw-unified-defer-flush");
    if (!raw?.trim()) return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
        const rec = parseJsonObject(trimmed);
        const d = rec?.destination;
        return typeof d === "string" ? d : null;
    }
    return trimmed;
}

function consumeDeferFlush(el: HTMLElement): void {
    const destRaw = readDeferFlushDestination(el);
    if (!destRaw) return;
    const dest = normalizeDestination(destRaw) || normalizeViewId(destRaw);
    void replayQueuedMessagesForDestination(dest).catch(() => undefined);
    el.removeAttribute("data-cw-unified-defer-flush");
}

function consumePending(el: HTMLElement): void {
    const raw = el.getAttribute("data-cw-unified-pending");
    const rec = parseJsonObject(raw);
    if (!rec) return;
    const msg = buildUnifiedMessageFromStaging(rec);
    if (!msg?.destination) return;
    enqueuePendingMessage(msg.destination, msg);
    el.removeAttribute("data-cw-unified-pending");
}

function consumeMail(el: HTMLElement): void {
    const raw = el.getAttribute("data-cw-unified-mail");
    const rec = parseJsonObject(raw);
    if (!rec) return;
    const destination =
        normalizeDestination(String(rec.destination || "")) || String(rec.destination || "").trim();
    if (!destination) return;
    void sendProtocolMessage({
        type: String(rec.type || "dispatch"),
        destination,
        source: typeof rec.source === "string" ? rec.source : "dom-staged-mail",
        data: (rec.data ?? rec.payload ?? {}) as object,
        contentType: typeof rec.contentType === "string" ? rec.contentType : undefined,
        metadata:
            typeof rec.metadata === "object" && rec.metadata ? (rec.metadata as Record<string, unknown>) : {},
        purpose: Array.isArray(rec.purpose)
            ? (rec.purpose as ("invoke" | "mail" | "attach" | "deliver" | "defer")[])
            : typeof rec.purpose === "string"
                ? ([rec.purpose] as ("invoke" | "mail" | "attach" | "deliver" | "defer")[])
                : ["mail", "deliver"],
        op: typeof rec.op === "string" ? rec.op : "deliver",
        protocol: typeof rec.protocol === "string" ? (rec.protocol as "window") : undefined
    }).catch(() => undefined);
    el.removeAttribute("data-cw-unified-mail");
}

/**
 * Applies staged envelope markers inside `scope` (scope element + subtree via querySelectorAll).
 * Intended for MutationObserver added subtrees and shell-injected payloads.
 */
export function processStagedUnifiedMarkers(scope: HTMLElement): void {
    const matched = new Set<HTMLElement>();
    if (scope.matches(STAGED_UNIFIED_SELECTOR)) matched.add(scope);
    for (const n of scope.querySelectorAll(STAGED_UNIFIED_SELECTOR)) {
        matched.add(n as HTMLElement);
    }
    for (const el of matched) {
        if (!el.isConnected) continue;
        consumeDeferFlush(el);
        consumePending(el);
        consumeMail(el);
    }
}

function flushDeferredTransportForView(view: View, explicitDestination?: string): void {
    const dest = explicitDestination || inferViewDestination(String(view.id || ""));
    const aliases = getDestinationAliases(dest);
    const targets = new Set<string>();
    for (const x of [dest, ...aliases]) {
        const n = normalizeDestination(x) || String(x || "").trim();
        if (n) targets.add(normalizeViewId(n));
    }
    void (async () => {
        for (const t of targets) {
            try {
                await replayQueuedMessagesForDestination(t);
            } catch {
                /* ignore replay errors */
            }
        }
    })();
}

const cleanupByView = new WeakMap<View, () => void>();
/** Last bound element per canonical destination — avoids duplicate UnifiedMessaging handlers. */
const activeHostByDestination = new Map<string, View>();

function sealCleanup(view: View, destinationKey: string, inner: () => void): () => void {
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        inner();
        cleanupByView.delete(view);
        if (activeHostByDestination.get(destinationKey) === view) {
            activeHostByDestination.delete(destinationKey);
        }
    };
}

/**
 * Single receive-channel binding per live view instance; replaces any prior binding for the same destination id.
 * Safe to call from {@link ViewRegistry.load} and from DOM discovery.
 */
export function attachImplicitViewMessaging(
    view: View,
    options: ViewReceiveBindingOptions = {}
): () => void {
    if (!view.handleMessage) {
        return () => {};
    }

    const existing = cleanupByView.get(view);
    if (existing) return existing;

    const destination = options.destination || inferViewDestination(String(view.id || ""));
    const destinationKey = normalizeViewId(destination);

    const displaced = activeHostByDestination.get(destinationKey);
    if (displaced && displaced !== view) {
        cleanupByView.get(displaced)?.();
    }

    const inner = bindViewReceiveChannel(view, { ...options, destination });
    flushDeferredTransportForView(view, destination);

    const cleanup = sealCleanup(view, destinationKey, inner);
    cleanupByView.set(view, cleanup);
    activeHostByDestination.set(destinationKey, view);
    return cleanup;
}

export function detachImplicitViewMessaging(view: View): void {
    cleanupByView.get(view)?.();
}

function walkSubtreeNodes(entry: Node, visit: (el: HTMLElement) => void): void {
    const stack: Node[] = [entry];
    while (stack.length) {
        const cur = stack.pop()!;
        if (cur.nodeType === Node.ELEMENT_NODE) {
            const el = cur as HTMLElement;
            visit(el);
            const sr = el.shadowRoot;
            if (sr) {
                for (let i = sr.childNodes.length - 1; i >= 0; i--) {
                    stack.push(sr.childNodes[i]);
                }
            }
            for (let i = el.childNodes.length - 1; i >= 0; i--) {
                stack.push(el.childNodes[i]);
            }
        }
    }
}

function observeMutationRoot(observer: MutationObserver, observed: WeakSet<Node>, node: Node): void {
    if (observed.has(node)) return;
    observed.add(node);
    observer.observe(node, { childList: true, subtree: true });
}

export interface ImplicitViewMessagingBridgeOptions {
    /** Defaults to `document.documentElement` so overlays/portals outside the shell container still resolve. */
    root?: HTMLElement | Document;
}

/**
 * Starts observing DOM mutations; binds messaging hosts when connected and tears down when disconnected.
 */
export function startImplicitViewMessagingBridge(
    options: ImplicitViewMessagingBridgeOptions = {}
): () => void {
    const root =
        options.root instanceof Document ? options.root.documentElement : options.root ?? document.documentElement;

    if (!root || typeof MutationObserver === "undefined") {
        return () => {};
    }

    const observedRoots = new WeakSet<Node>();

    let scanConnect: (node: Node) => void = () => {};
    const scanDisconnect = (node: Node): void => {
        walkSubtreeNodes(node, (el) => {
            if (!isImplicitViewMessagingHost(el)) return;
            if (!el.isConnected) detachImplicitViewMessaging(el);
        });
    };

    const observer = new MutationObserver((records) => {
        for (const rec of records) {
            rec.addedNodes.forEach(scanConnect);
            rec.removedNodes.forEach(scanDisconnect);
        }
    });

    scanConnect = (node: Node): void => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const host = node as HTMLElement;
            if (host.isConnected) processStagedUnifiedMarkers(host);
        }
        walkSubtreeNodes(node, (el) => {
            if (el.shadowRoot) observeMutationRoot(observer, observedRoots, el.shadowRoot);
            if (!el.isConnected || !isImplicitViewMessagingHost(el)) return;
            attachImplicitViewMessaging(el);
        });
    };

    observeMutationRoot(observer, observedRoots, root);
    scanConnect(root);

    return () => {
        observer.disconnect();
        walkSubtreeNodes(root, (el) => {
            if (isImplicitViewMessagingHost(el)) detachImplicitViewMessaging(el);
        });
    };
}
