import { sendProtocolMessage, enqueuePendingMessage, type UnifiedMessage } from "com/core/UnifiedMessaging";
import { summarizeForLog } from "com/core/LogSanitizer";
import { normalizeDestination, viewBroadcastChannelName } from "com/config/Names";

/**
 * Canonical classification for share-target / launch-queue files (extension often beats flaky MIME).
 * Viewer-first routing treats `markdown` + `text`; other kinds stay on Work Center or sibling sinks.
 */
export const classifyIngressFile = (file: File): "markdown" | "text" | "image" | "file" => {
    const name = String(file?.name || "").toLowerCase();
    const mime = String(file?.type || "").toLowerCase();

    if (mime.startsWith("image/")) return "image";

    const mdTail = /\.(?:md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)(?:$|[?#])/i;
    if (mime === "text/markdown" || mdTail.test(name)) return "markdown";

    if (mime.startsWith("text/")) return "text";
    if (
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "application/xhtml+xml" ||
        mime === "application/javascript" ||
        mime === "application/typescript" ||
        mime === "application/x-typescript"
    ) {
        return "text";
    }

    const textTail =
        /\.(?:txt|text|html|htm|css|scss|sass|less|json|csv|xml|yaml|yml|log|ini|env|toml|graphql|svg|tsx?|jsx?|mts|cts|cjs|mjs|vue|svelte|rst)(?:$|[?#])/i;
    if (textTail.test(name)) {
        return mdTail.test(name) ? "markdown" : "text";
    }

    if (!mime || mime === "application/octet-stream") {
        if (mdTail.test(name)) return "markdown";
    }

    if (/\.(?:png|jpe?g|gif|webp|bmp)(?:$|[?#])/i.test(name)) return "image";

    return "file";
};

/** Filename-only classification when blobs are still in Cache Storage (`fileCount` but `files=[]`). */
export const classifyIngressFromBasename = (raw: string): "markdown" | "text" | "image" | "file" => {
    const t = raw.trim().replace(/\\/g, "/");
    const cut = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
    const nameOnly = ((cut >= 0 ? t.slice(cut + 1) : t) || "").trim();
    if (!nameOnly) return "file";
    try {
        return classifyIngressFile(
            new File([], nameOnly, { type: "application/octet-stream" })
        );
    } catch {
        return "file";
    }
};

export type ViewTransferSource = "share-target" | "launch-queue" | "pending" | "clipboard";

export type ViewTransferDestination =
    | "viewer"
    | "workcenter"
    | "explorer"
    | "editor"
    | "history"
    | "settings"
    | "home"
    | "print";

export type ViewTransferActionHint = "open" | "attach" | "save" | "process";

export interface ViewTransferHint {
    destination?: ViewTransferDestination;
    action?: ViewTransferActionHint;
    contentType?: string;
    filename?: string;
}

export interface ViewTransferPayload {
    source: ViewTransferSource;
    route: "share-target" | "launch-queue" | "clipboard";
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
    /** Mirrors share payload `fileCount` when blobs are not yet hydrated (helps routing/classification). */
    fileCount?: number;
    pending?: boolean;
    hint?: ViewTransferHint;
    metadata?: Record<string, unknown>;
}

export interface ViewTransferResolved {
    destination: ViewTransferDestination;
    routePath: `/${ViewTransferDestination}`;
    messageType: string;
    contentType: string;
    data: Record<string, unknown>;
    metadata: Record<string, unknown>;
}

const getContentType = (payload: ViewTransferPayload): string => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    const text = String(payload.text || "").trim();
    const url = String(payload.url || "").trim();

    const meta =
        payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
            ? (payload.metadata as Record<string, unknown>)
            : {};
    const expectedFileCount = Math.max(
        Number(meta.fileCount) || 0,
        Number(payload.fileCount) || 0
    );
    /** Android share-target often ships a `content:`/`https:` URL together with attachments; blobs may hydrate later. */
    const filesStillPending = files.length === 0 && expectedFileCount > 0;

    if (payload.hint?.contentType && !filesStillPending) {
        return String(payload.hint.contentType);
    }

    if (files.length > 0) {
        const kind = classifyIngressFile(files[0]);
        if (kind === "image") return "image";
        if (kind === "markdown") return "markdown";
        if (kind === "text") return "text";
        return "file";
    }

    /** SW metadata row often beats File[] hydration (`fileCount` only) — classify from title/filename hint. */
    const nameProbe =
        (typeof payload.hint?.filename === "string" && payload.hint.filename.trim()) ||
        (typeof payload.title === "string" && payload.title.trim()) ||
        "";
    const tryBasename = !text && nameProbe && (!url || filesStillPending);
    if (tryBasename) {
        const nk = classifyIngressFromBasename(nameProbe);
        if (nk === "markdown") return "markdown";
        if (nk === "text") return "text";
        if (nk === "image") return "image";
        if (filesStillPending && nk === "file") return "file";
    }

    if (url) {
        const normalized = url.split("#")[0].split("?")[0].toLowerCase();
        if (/\.(md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)$/.test(normalized)) return "markdown";
        return "url";
    }
    if (text) return "text";
    return "other";
};

const pickDestination = (payload: ViewTransferPayload, contentType: string): ViewTransferDestination => {
    if (payload.hint?.action === "save") return "explorer";
    /** Readable docs should win over stale `hint.destination` from cached/share envelopes. */
    if (contentType === "markdown" || contentType === "text") return "viewer";

    if (payload.hint?.destination) return payload.hint.destination;
    if (payload.hint?.action === "process" || payload.hint?.action === "attach") return "workcenter";
    if (payload.hint?.action === "open") return "viewer";

    if (contentType === "url") return "workcenter";
    if (contentType === "image" || contentType === "file") return "workcenter";
    return "workcenter";
};

const toMessageType = (destination: ViewTransferDestination, hint?: ViewTransferHint): string => {
    if (destination === "viewer") return hint?.action === "open" ? "content-load" : "content-view";
    if (destination === "explorer") return "file-save";
    if (destination === "workcenter") return "content-attach";
    if (destination === "editor") return "content-load";
    return "content-share";
};

export const resolveViewTransfer = (payload: ViewTransferPayload): ViewTransferResolved => {
    const contentType = getContentType(payload);
    const destination = pickDestination(payload, contentType);
    const messageType = toMessageType(destination, payload.hint);
    const files = Array.isArray(payload.files) ? payload.files : [];

    const data: Record<string, unknown> = {
        title: payload.title,
        text: payload.text,
        content: payload.text,
        url: payload.url,
        files,
        filename: payload.hint?.filename || files[0]?.name,
        source: payload.source,
        route: payload.route,
        hint: payload.hint
    };

    const resolved: ViewTransferResolved = {
        destination: normalizeDestination(destination) as ViewTransferDestination,
        routePath: `/${destination}`,
        messageType,
        contentType,
        data,
        metadata: {
            source: payload.source,
            route: payload.route,
            pending: Boolean(payload.pending),
            hint: payload.hint,
            ...(payload.metadata || {})
        }
    };

    console.log("[ViewTransfer] Resolved transfer:", summarizeForLog({
        source: payload.source,
        route: payload.route,
        pending: payload.pending,
        hint: payload.hint,
        contentType,
        destination,
        messageType,
        fileCount: files.length
    }));

    return resolved;
};

const mirrorTransferToViewChannel = (resolved: ViewTransferResolved, message: UnifiedMessage): void => {
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const ch = new BroadcastChannel(viewBroadcastChannelName(resolved.destination));
        ch.postMessage({ type: "view-transfer", message });
        ch.close();
    } catch (e) {
        console.warn("[ViewTransfer] View-channel mirror failed:", e);
    }
};

export const dispatchViewTransfer = async (
    payload: ViewTransferPayload
): Promise<{ delivered: boolean; resolved: ViewTransferResolved }> => {
    const resolved = resolveViewTransfer(payload);
    const files = Array.isArray(payload.files) ? payload.files : [];
    const hasBinaryPayload = resolved.contentType === "image" || resolved.contentType === "file";
    const message: UnifiedMessage = {
        id: crypto.randomUUID(),
        type: resolved.messageType,
        destination: normalizeDestination(resolved.destination),
        contentType: resolved.contentType,
        data: resolved.data,
        metadata: resolved.metadata,
        source: `view-transfer:${payload.source}`
    };

    console.log("[ViewTransfer] Dispatching message:", summarizeForLog({
        destination: message.destination,
        type: message.type,
        contentType: message.contentType,
        metadata: message.metadata
    }));

    mirrorTransferToViewChannel(resolved, message);

    let queuedAsPending = false;
    if (payload.pending && !hasBinaryPayload) {
        try {
            // Keep pending transport JSON-safe: markdown/text/url flows can be replayed
            // without binary `File[]` payload because text/url is already hydrated.
            const pendingMessage: UnifiedMessage = {
                ...message,
                data: {
                    ...(message.data || {}),
                    files: []
                }
            };
            enqueuePendingMessage(resolved.destination, pendingMessage);
            queuedAsPending = true;
        } catch (error) {
            console.warn("[ViewTransfer] Failed to enqueue pending message:", error);
        }
    }

    const deliveredNow = await sendProtocolMessage({
        ...message,
        purpose: ["deliver", "mail"],
        protocol: "window",
        op: payload.hint?.action === "open" ? "invoke" : "deliver",
        srcChannel: message.source,
        dstChannel: normalizeDestination(resolved.destination),
    });
    const delivered = deliveredNow || queuedAsPending;
    console.log("[ViewTransfer] Message delivery status:", {
        deliveredNow,
        queuedAsPending,
        hasBinaryPayload,
        delivered,
        destination: resolved.destination,
        routePath: resolved.routePath
    });
    return { delivered, resolved };
};
