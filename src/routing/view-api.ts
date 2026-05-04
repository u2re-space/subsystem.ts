/**
 * View-scoped POST API + BroadcastChannel bridge.
 * - Production: service worker intercepts POST /{view} and fans out to clients.
 * - Dev (no SW): Vite middleware returns devRelay JSON; this module posts to rs-view-* locally.
 */

import { normalizeDestination, normalizeViewId, viewBroadcastChannelName } from "com/config/Names";
import { createProtocolEnvelope, sendProtocolMessage } from "com/core/UnifiedMessaging";

export type ViewPostChannelPayload = {
    type: "view-post";
    viewId: string;
    bodyText: string;
    contentType: string;
};

export type ViewTransferChannelPayload = {
    type: "view-transfer";
    message: unknown;
};

export type ViewOpenTarget = "window" | "frame" | "shell" | "base" | "minimal" | "headless";

export type ViewOpenRequest = {
    viewId: string;
    target?: ViewOpenTarget;
    params?: Record<string, string>;
    pid?: string;
    /** POST-style body payload (JSON data, options) */
    body?: unknown;
    /** MIME type hint for body */
    contentType?: string;
    /** Named channel for inter-process messaging */
    channel?: string;
    /** Attached data assets from another process */
    attachments?: Array<{
        hash?: string;
        name: string;
        type?: string;
        mimeType?: string;
        size: number;
        data: File | Blob | string;
        source?: string;
    }>;
    /** Window sub-type: "regular" or "tabbed" */
    windowType?: string;
    /** Force new task/instance */
    newTask?: boolean;
};

export function postViewChannelPayload(viewId: string, payload: unknown): void {
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const bc = new BroadcastChannel(viewBroadcastChannelName(normalizeViewId(viewId)));
        bc.postMessage(payload);
        bc.close();
    } catch (e) {
        console.warn("[view-api] Broadcast to view channel failed:", e);
    }
}

export async function postInterViewMessage(input: {
    source: string;
    destination: string;
    type: string;
    data?: Record<string, unknown>;
    contentType?: string;
    purpose?: ("invoke" | "mail" | "attach" | "deliver" | "defer")[];
    op?: string;
    metadata?: Record<string, unknown>;
}): Promise<boolean> {
    const destination = normalizeDestination(input.destination) || normalizeViewId(input.destination);
    const envelope = createProtocolEnvelope({
        type: input.type,
        source: input.source,
        destination,
        contentType: input.contentType,
        data: input.data || {},
        purpose: input.purpose || ["deliver", "mail"],
        op: input.op || "deliver",
        protocol: "window",
        srcChannel: input.source,
        dstChannel: destination,
        metadata: input.metadata || {}
    });

    postViewChannelPayload(destination, {
        type: "view-transfer",
        message: envelope
    } satisfies ViewTransferChannelPayload);

    return sendProtocolMessage(envelope);
}

/**
 * Preferred API: POST body to /{viewId}. Shell / web components listen on {@link viewBroadcastChannelName}.
 */
export async function postViewApi(
    viewId: string,
    body: BodyInit,
    init: RequestInit = {}
): Promise<Response> {
    const id = normalizeViewId(String(viewId || "").replace(/^\/+|\/+$/g, "").toLowerCase());
    const res = await fetch(`/${id}`, {
        method: "POST",
        credentials: "same-origin",
        ...init,
        body
    });

    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
        try {
            const data = (await res.clone().json()) as {
                devRelay?: boolean;
                bodyText?: string;
                contentType?: string;
            };
            if (data?.devRelay === true && typeof data.bodyText === "string") {
                postViewChannelPayload(id, {
                    type: "view-post",
                    viewId: id,
                    bodyText: data.bodyText,
                    contentType: String(data.contentType || "")
                } satisfies ViewPostChannelPayload);
            }
        } catch {
            // ignore JSON parse errors
        }
    }

    return res;
}

export function subscribeViewChannel(
    viewId: string,
    handler: (event: MessageEvent) => void
): () => void {
    if (typeof BroadcastChannel === "undefined") return () => {};

    const bc = new BroadcastChannel(viewBroadcastChannelName(normalizeViewId(viewId)));
    bc.addEventListener("message", handler);
    return () => {
        bc.removeEventListener("message", handler);
        bc.close();
    };
}

/**
 * Ask active shell/router to open a view using query-like envelope semantics.
 * Window shell listens to this event and can map request to a process frame.
 */
export function requestOpenView(request: ViewOpenRequest): void {
    const viewId = String(request?.viewId || "").trim().toLowerCase();
    if (!viewId) return;
    globalThis?.dispatchEvent?.(new CustomEvent("cw:view-open-request", {
        detail: {
            viewId,
            target: request?.target || "window",
            params: request?.params || {},
            pid: request?.pid || null,
            body: request?.body,
            contentType: request?.contentType,
            channel: request?.channel,
            attachments: request?.attachments,
            windowType: request?.windowType,
            newTask: request?.newTask,
        }
    }));
}
