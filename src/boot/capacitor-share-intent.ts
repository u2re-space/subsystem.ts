/**
 * Capacitor share / process-text bridge (Android → WebView).
 * FIND:open-policy
 *
 * Fans out to the clipboard bus and runs the SKU share pipeline
 * (process → AI/attach, document → viewer, explorer → path/ask, shell → pin/wallpaper).
 * Document SKU does not ack pending-share — the viewer pull paints then acks.
 */

import { isCapacitorNative } from "./capacitor-permissions";
import { splitMultiValueList } from "cwsp-shared/multi-value-list";

type ShareAsset = {
    hash?: string;
    name?: string;
    mimeType?: string;
    type?: string;
    size?: number;
    source?: string;
    data?: string;
};

type ShareIntentDetail = {
    text?: string;
    title?: string;
    action?: string;
    name?: string;
    mime?: string;
    pending?: boolean;
    asset?: ShareAsset;
} | string;

const parseSharePayload = (
    detail: ShareIntentDetail | null | undefined
): { text: string; title: string; asset: ShareAsset | null; pending: boolean } => {
    if (detail == null) return { text: "", title: "", asset: null, pending: false };
    if (typeof detail === "string") {
        const trimmed = detail.trim();
        if (!trimmed) return { text: "", title: "", asset: null, pending: false };
        try {
            const parsed = JSON.parse(trimmed) as {
                text?: string;
                title?: string;
                name?: string;
                mime?: string;
                pending?: boolean;
                asset?: ShareAsset;
            };
            return {
                text: String(parsed?.text || "").trim() || (parsed?.asset ? "" : trimmed),
                title: String(parsed?.title || "").trim(),
                asset: parsed?.asset && typeof parsed.asset === "object"
                    ? parsed.asset
                    : parsed?.name
                      ? { name: parsed.name, mimeType: parsed.mime }
                      : null,
                pending: parsed?.pending === true
            };
        } catch {
            return { text: trimmed, title: "", asset: null, pending: false };
        }
    }
    return {
        text: String(detail.text || "").trim(),
        title: String(detail.title || "").trim(),
        asset: detail.asset && typeof detail.asset === "object"
            ? detail.asset
            : detail.name
              ? { name: detail.name, mimeType: detail.mime }
              : null,
        pending: detail.pending === true
    };
};

const readDestinationNodes = (settings: Record<string, unknown>): string[] => {
    const cwsp = (settings.cwsp && typeof settings.cwsp === "object")
        ? (settings.cwsp as Record<string, unknown>)
        : {};
    const raw =
        String(cwsp.shareIntentDestinationIds || cwsp.destinationNodeIds || "*").trim() || "*";
    if (raw === "*" || raw.toLowerCase() === "any") return ["*"];
    return splitMultiValueList(raw);
};

const isDocumentSku = (): boolean => {
    try {
        return String(document.documentElement?.dataset?.cwspSku || "").trim() === "document";
    } catch {
        return false;
    }
};

const consumeNativePendingShare = async (): Promise<{
    text: string;
    title: string;
    url: string;
    files: File[];
} | null> => {
    try {
        const { invokeCwsPlatformIPC } = await import("com/routing/native/cws-bridge");
        const peek = await invokeCwsPlatformIPC({ channel: "launcher:pending-share" });
        if (!peek?.ok) return null;
        const echo = (peek.echo || peek) as {
            text?: string;
            title?: string;
            name?: string;
            mime?: string;
            url?: string;
            hasFile?: boolean;
        };
        const text = String(echo.text || "").trim();
        const title = String(echo.title || echo.name || "").trim();
        const url = String(echo.url || "").trim();
        const files: File[] = [];
        if (echo.hasFile) {
            const read = await invokeCwsPlatformIPC({ channel: "launcher:read-share-file" });
            const blob = (read.echo || read) as { data?: string; name?: string; mime?: string };
            if (blob?.data) {
                const { dataUrlToFile } = await import("com/routing/channel/sku-ingress");
                const file = await dataUrlToFile(
                    blob.data,
                    String(blob.name || echo.name || "shared.bin"),
                    String(blob.mime || echo.mime || "application/octet-stream")
                );
                if (file) files.push(file);
            }
        }
        await invokeCwsPlatformIPC({ channel: "launcher:ack-share" }).catch(() => null);
        if (!text && !url && !files.length) return null;
        return { text, title, url, files };
    } catch {
        return null;
    }
};

const ingestParsedShare = async (input: {
    text?: string;
    title?: string;
    url?: string;
    files?: File[];
}): Promise<void> => {
    const { ingestSharePayload } = await import("com/routing/pwa/sw-handling");
    await ingestSharePayload({
        title: input.title || undefined,
        text: input.text || undefined,
        url: input.url || undefined,
        files: input.files?.length ? input.files : undefined,
        fileCount: input.files?.length || 0,
        source: "share-target"
    });
};

let installed = false;
let ingestChain: Promise<void> = Promise.resolve();

const enqueueShareIngest = (job: () => Promise<void>): void => {
    ingestChain = ingestChain.then(job, job);
};

export const installCapacitorShareIntentBridge = (): void => {
    if (!isCapacitorNative() || installed) return;
    installed = true;

    const handler = (ev: Event): void => {
        void (async () => {
            const { text, title, asset, pending } = parseSharePayload(
                (ev as CustomEvent<ShareIntentDetail>).detail
            );

            try {
                const [{ loadSettings }, ws, { classifyOpenKindFromPayload }, ingress] = await Promise.all([
                    import("com/config/Settings"),
                    import("shared/transport/websocket"),
                    import("com/config/open-policy"),
                    import("com/config/process-ingress")
                ]);
                const settings = await loadSettings();
                ingress.rememberProcessIngressSettings(settings);
                const files: File[] = [];
                if (asset?.data) {
                    const { dataUrlToFile } = await import("com/routing/channel/sku-ingress");
                    const file = await dataUrlToFile(
                        asset.data,
                        String(asset.name || "shared.bin"),
                        String(asset.mimeType || asset.type || "application/octet-stream")
                    );
                    if (file) files.push(file);
                }
                const kind = classifyOpenKindFromPayload({
                    text,
                    title,
                    files,
                    source: "share-target"
                });
                const row = ingress.resolveProcessIngressKind(settings, kind);
                if (row.backgroundClipboard) {
                    const { ensureCapacitorBridgeDaemonStarted } = await import(
                        "./capacitor-settings-permissions"
                    );
                    await ensureCapacitorBridgeDaemonStarted(settings);
                }
                // WHY: process + clipboard kinds write the AI result; do not overwrite with the raw share.
                const skipRawClipboard = row.mode === "process" && row.copyToClipboard !== false;
                if (!skipRawClipboard) {
                    const nodes = readDestinationNodes(settings as unknown as Record<string, unknown>);
                    ws.connectWS();
                    if (asset) {
                        ws.sendCoordinatorAct(
                            "clipboard:update",
                            { asset, source: "android-share" },
                            nodes
                        );
                    }
                    if (text) {
                        ws.sendCoordinatorAct(
                            "clipboard:update",
                            { text, source: "android-share" },
                            nodes
                        );
                    }
                }
            } catch {
                /* clipboard fan-out optional */
            }

            enqueueShareIngest(async () => {
                try {
                    /* WHY: Document viewer owns pending-share. Ack here deletes the stash
                     * before the painted view can pull, so the last markdown stays on screen. */
                    if (pending && isDocumentSku()) return;
                    if (pending) {
                        const native = await consumeNativePendingShare();
                        if (native) {
                            await ingestParsedShare(native);
                            return;
                        }
                    }
                    const { dataUrlToFile } = await import("com/routing/channel/sku-ingress");
                    const files: File[] = [];
                    if (asset?.data) {
                        const file = await dataUrlToFile(
                            asset.data,
                            String(asset.name || "shared.bin"),
                            String(asset.mimeType || asset.type || "application/octet-stream")
                        );
                        if (file) files.push(file);
                    }
                    if (!text && !files.length && !asset) return;
                    await ingestParsedShare({
                        text,
                        title: title || asset?.name,
                        files
                    });
                } catch {
                    /* SKU pipeline optional — clipboard fan-out already ran */
                }
            });
        })().catch(() => { /* best-effort */ });
    };

    window.addEventListener("cws:shareIntent", handler);
    enqueueShareIngest(async () => {
        /* WHY: consume after viewer mount — otherwise content-view has no handler. */
        await new Promise<void>((resolve) => {
            const done = () => resolve();
            try {
                if (document.documentElement?.dataset?.cwspBoot === "ready") {
                    done();
                    return;
                }
            } catch {
                /* ignore */
            }
            const onReady = () => {
                window.removeEventListener("cwsp:boot-ready", onReady);
                done();
            };
            window.addEventListener("cwsp:boot-ready", onReady);
            window.setTimeout(done, 4000);
        });
        if (isDocumentSku()) return;
        const native = await consumeNativePendingShare().catch(() => null);
        if (native) await ingestParsedShare(native);
    });
};
