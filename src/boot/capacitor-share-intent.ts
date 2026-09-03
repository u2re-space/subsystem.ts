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

type ParsedShare = {
    text: string;
    title: string;
    name: string;
    mime: string;
    asset: ShareAsset | null;
    pending: boolean;
};

const emptyParsedShare = (): ParsedShare => ({
    text: "",
    title: "",
    name: "",
    mime: "",
    asset: null,
    pending: false
});

const parseSharePayload = (
    detail: ShareIntentDetail | null | undefined
): ParsedShare => {
    if (detail == null) return emptyParsedShare();
    if (typeof detail === "string") {
        const trimmed = detail.trim();
        if (!trimmed) return emptyParsedShare();
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
                name: String(parsed?.name || "").trim(),
                mime: String(parsed?.mime || "").trim(),
                asset: parsed?.asset && typeof parsed.asset === "object"
                    ? parsed.asset
                    : parsed?.name
                      ? { name: parsed.name, mimeType: parsed.mime }
                      : null,
                pending: parsed?.pending === true
            };
        } catch {
            return { ...emptyParsedShare(), text: trimmed };
        }
    }
    return {
        text: String(detail.text || "").trim(),
        title: String(detail.title || "").trim(),
        name: String(detail.name || "").trim(),
        mime: String(detail.mime || "").trim(),
        asset: detail.asset && typeof detail.asset === "object"
            ? detail.asset
            : detail.name
              ? { name: detail.name, mimeType: detail.mime }
              : null,
        pending: detail.pending === true
    };
};

const looksLikeFileShare = (echo: {
    hasFile?: boolean;
    mime?: string;
    name?: string;
    title?: string;
    url?: string;
    text?: string;
}): boolean => {
    if (echo.hasFile) return true;
    const mime = String(echo.mime || "").toLowerCase();
    const name = String(echo.name || echo.title || "").toLowerCase();
    if (mime.startsWith("image/") || mime.startsWith("application/") || mime.startsWith("audio/") || mime.startsWith("video/")) {
        return true;
    }
    if (/\.(pdf|docx?|odt|rtf|pptx?|xlsx?|md|markdown|txt|png|jpe?g|gif|webp|html?|csv|json)$/i.test(name)) {
        return true;
    }
    return false;
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
        const root = document.documentElement;
        const sku = String(root?.dataset?.cwspSku || "").trim();
        if (sku === "document") return true;
        const surface = String(root?.dataset?.cwspSurface || "");
        if (surface === "cw-document" || surface === "cw-markdown" || surface === "cw-document-crx") {
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
};

const isTransferSku = (): boolean => {
    try {
        return String(document.documentElement?.dataset?.cwspSku || "").trim() === "transfer";
    } catch {
        return false;
    }
};

const consumeNativePendingShare = async (): Promise<{
    text: string;
    title: string;
    url: string;
    name: string;
    mime: string;
    files: File[];
} | null> => {
    try {
        const { invokeCwsPlatformIPC } = await import("com/routing/native/cws-bridge");
        const peek = await invokeCwsPlatformIPC({ channel: "launcher:pending-share" });
        if (!peek?.ok) return null;
        /* INVARIANT: Document viewer owns the stash. Ack here leaves Open-with/Share blank. */
        if (isDocumentSku()) return null;
        const echo = (peek.echo || peek) as {
            text?: string;
            title?: string;
            name?: string;
            mime?: string;
            url?: string;
            hasFile?: boolean;
            stashedAt?: number | string;
        };
        const stashedAt = Number(echo.stashedAt || 0) || undefined;
        const flagged =
            echo.hasFile === true || echo.hasFile === "true" || (echo.hasFile as unknown) === 1 || echo.hasFile === "1";
        if (!echo.text && !echo.title && !echo.name && !echo.url && !flagged) return null;
        const { dataUrlToFile, filenameFromLocalShareUri, isAndroidLocalShareUri } = await import(
            "com/routing/channel/sku-ingress"
        );
        let text = String(echo.text || "").trim();
        const title = String(echo.title || echo.name || "").trim();
        const name = String(echo.name || "").trim();
        const mime = String(echo.mime || "").trim();
        let url = String(echo.url || "").trim();
        const files: File[] = [];
        const local = isAndroidLocalShareUri(url) || isAndroidLocalShareUri(text);
        const wantFile = flagged || local || looksLikeFileShare({ ...echo, hasFile: flagged });
        const pullFile = async (): Promise<void> => {
            const read = await invokeCwsPlatformIPC({ channel: "launcher:read-share-file" });
            const blob = (read.echo || read) as { data?: string; name?: string; mime?: string };
            if (!blob?.data) return;
            const file = await dataUrlToFile(
                blob.data,
                String(blob.name || echo.name || filenameFromLocalShareUri(url || text) || "shared.bin"),
                String(blob.mime || echo.mime || "application/octet-stream")
            );
            if (file) files.push(file);
        };
        if (wantFile) await pullFile();
        if (wantFile && !files.length) {
            const status = await invokeCwsPlatformIPC({ channel: "storage:all-files-status" }).catch(() => null);
            const granted = Boolean((status?.echo as { allFilesAccess?: boolean } | undefined)?.allFilesAccess);
            if (!granted) {
                await invokeCwsPlatformIPC({ channel: "storage:all-files-request" }).catch(() => null);
                const { showToast } = await import("./toast");
                showToast({ message: "Allow all-files access, then share the file again", kind: "warning" });
                /* WHY: do not ack — stash stays until the user shares again with the grant. */
                return null;
            }
            await invokeCwsPlatformIPC({ channel: "launcher:restash-share-file" }).catch(() => null);
            await pullFile();
        }
        if (wantFile && !files.length) {
            /* INVARIANT: a file share without bytes must not become EXTRA_TEXT in chat. */
            return null;
        }
        if (files.length || (!local && (text || url))) {
            await invokeCwsPlatformIPC({
                channel: "launcher:ack-share",
                payload: stashedAt ? { stashedAt } : {}
            }).catch(() => null);
        }
        if (isAndroidLocalShareUri(url)) url = "";
        if (isAndroidLocalShareUri(text)) text = "";
        if (!text && !url && !files.length) return null;
        return { text, title, url, name, mime, files };
    } catch {
        return null;
    }
};

const ingestParsedShare = async (input: {
    text?: string;
    title?: string;
    url?: string;
    name?: string;
    mime?: string;
    files?: File[];
}): Promise<void> => {
    const { ingestSharePayload } = await import("com/routing/pwa/sw-handling");
    const filename = String(input.files?.[0]?.name || input.name || input.title || "").trim();
    await ingestSharePayload({
        title: input.title || input.name || undefined,
        text: input.text || undefined,
        url: input.url || undefined,
        files: input.files?.length ? input.files : undefined,
        fileCount: input.files?.length || 0,
        timestamp: Date.now(),
        source: "share-target",
        hint: filename ? { filename } : undefined
    });
    try {
        const { flushHeldIngressToWorkCenter } = await import("com/routing/channel/sku-ingress");
        await flushHeldIngressToWorkCenter();
    } catch {
        /* Work Center host optional */
    }
};

let installed = false;
let ingestChain: Promise<void> = Promise.resolve();

const enqueueShareIngest = (job: () => Promise<void>): void => {
    ingestChain = ingestChain.then(job, job);
};

export const installCapacitorShareIntentBridge = (): void => {
    if (!isCapacitorNative() || installed) return;
    installed = true;
    // WHY: Transfer APK ShareActivity + files-hub own inbound share.
    // Viewer ingest is dead here (enabled views are network/settings/history).
    if (isTransferSku()) return;

    const handler = (ev: Event): void => {
        void (async () => {
            const { text, title, name, mime, asset, pending } = parseSharePayload(
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
                    hint: { filename: name || title || files[0]?.name }
                });
                const row = ingress.resolveProcessIngressKind(settings, kind);
                if (row.mode === "process") {
                    const { ensureCapacitorBridgeDaemonStarted } = await import(
                        "./capacitor-settings-permissions"
                    );
                    await ensureCapacitorBridgeDaemonStarted({
                        ...(settings || {}),
                        shell: { ...(settings?.shell || {}), bridgeDaemonEnabled: true }
                    });
                }
                // WHY: Process SKU: attach stays in chat; process writes the AI result.
                // Never overwrite the clipboard with the raw share on this SKU.
                const skipRawClipboard =
                    row.mode === "process" ||
                    String(document.documentElement?.dataset?.cwspSku || "").trim() === "process";
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
                    if (pending && isDocumentSku()) {
                        try {
                            window.dispatchEvent(
                                new CustomEvent("cwsp:document-open", { detail: { source: "share-intent" } })
                            );
                        } catch {
                            /* viewer pull is also bound to cws:shareIntent */
                        }
                        return;
                    }
                    if (pending) {
                        const native = await consumeNativePendingShare();
                        if (native) {
                            await ingestParsedShare(native);
                            return;
                        }
                        /* WHY: pending Share Target is on disk. Event text is a 400-char clip — not the file. */
                        return;
                    }
                    const { dataUrlToFile } = await import("com/routing/channel/sku-ingress");
                    const files: File[] = [];
                    if (asset?.data) {
                        const file = await dataUrlToFile(
                            asset.data,
                            String(asset.name || name || "shared.bin"),
                            String(asset.mimeType || asset.type || mime || "application/octet-stream")
                        );
                        if (file) files.push(file);
                    }
                    if (!text && !files.length && !asset) return;
                    await ingestParsedShare({
                        text,
                        title: title || name || asset?.name,
                        name,
                        mime,
                        files
                    });
                } catch {
                    /* SKU pipeline optional — clipboard fan-out already ran */
                }
            });
        })().catch(() => { /* best-effort */ });
    };

    window.addEventListener("cws:shareIntent", handler);
    /* WHY: warm attach while MainActivity is already resumed can drop cws:shareIntent.
     * Pull the native stash on visibility the same way Document pulls Open-with. */
    const pullPending = (): void => {
        if (isDocumentSku() || isTransferSku()) return;
        try {
            if (document.visibilityState && document.visibilityState !== "visible") return;
        } catch {
            /* ignore */
        }
        enqueueShareIngest(async () => {
            const native = await consumeNativePendingShare().catch(() => null);
            if (native) await ingestParsedShare(native);
        });
    };
    document.addEventListener("visibilitychange", pullPending);
    window.addEventListener("pageshow", pullPending);
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
        if (isDocumentSku() || isTransferSku()) return;
        const native = await consumeNativePendingShare().catch(() => null);
        if (native) await ingestParsedShare(native);
    });
};
