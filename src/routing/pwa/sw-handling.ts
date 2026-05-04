/**
 * Window-side PWA integration helpers.
 *
 * This module bridges the main app with the service worker, share-target cache,
 * launch-queue API, and broadcast-based clipboard/share flows. It exists on the
 * page side, while `src/pwa/sw.ts` owns the worker-side behavior.
 */
import { initPWAClipboard } from "./pwa-copy";
import { showToast } from "../../boot/toast";
import { ensureServiceWorkerRegistered } from "./sw-url";
import { dispatchViewTransfer, type ViewTransferHint } from "com/core/ViewTransferRouting";
import { BROADCAST_CHANNELS } from "com/config/Names";
import { loadSettings } from "com/config/Settings";
import { summarizeForLog } from "com/core/LogSanitizer";
import {
    buildShareDataFromCachedPayload,
    consumeCachedShareTargetPayload as consumeCachedShareTargetPayloadFromGateway,
    storeShareTargetPayloadToCache as storeShareTargetPayloadToCacheGateway,
    type CachedShareTargetPayload
} from "com/core/ShareTargetGateway";
import { waitForIngressPipelineSlot } from "shared/policies/ingress-pipeline-guard";

// ============================================================================
// CSS INJECTION
// ============================================================================

/** Ensure the production app CSS bundle is present when the app boots outside extension pages. */
export const ensureAppCss = () => {
    // App is built as a JS module; make sure extracted CSS is loaded in production.
    // Skip extension pages: they have their own HTML entrypoints and CSS injection.
    const viteEnv = (import.meta as any)?.env;
    if (viteEnv?.DEV) return;
    if (typeof window === "undefined") return;
    if (globalThis?.location?.protocol === "chrome-extension:") return;

    const id = "rs-crossword-css";
    if (document.getElementById(id)) return;

    /*
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";

    // Resolve CSS relative to module location (handles /apps/cw/ mounting)
    // Module is at .../modules/index.js, CSS is at .../assets/crossword.css (resolved at runtime)
    try {
        // Go up from modules/ to app root, then into assets/
        const cssUrl = new URL("../assets/crossword.css", import.meta.url);
        link.href = cssUrl.toString();
    } catch {
        // Fallback: try document-relative path
        link.href = "assets/crossword.css";
    }

    // Handle load errors by trying alternative paths
    let altIndex = 0;
    link.onerror = () => {
        const altPaths = [
            // Relative to app root (if main entry, not in modules/)
            new URL("./assets/crossword.css", import.meta.url).toString(),
            // Absolute from document root
            "/assets/crossword.css",
            // Common app mounting paths
            "/apps/cw/assets/crossword.css",
        ];

        if (altIndex < altPaths.length) {
            const nextPath = altPaths[altIndex++];
            if (link.href !== nextPath) {
                console.warn(`[CSS] Trying path: ${nextPath}`);
                link.href = nextPath;
                return;
            }
        }
        link.onerror = null;
    };

    document.head.append(link);*/
};

// ============================================================================
// SERVICE WORKER INITIALIZATION
// ============================================================================

let _swRegistration: ServiceWorkerRegistration | null = null;
let _swInitPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let _swControllerReloadBound = false;
let _swReloadPending = false;
let _swUpdateInterval: number | null = null;
let _swOptions: { immediate?: boolean, onRegistered?: () => void, onRegisterError?: (error: any) => void } = {
    immediate: false,
    onRegistered: () => {
        console.log('[PWA] Service worker registered successfully');
    },
    onRegisterError: (error) => {
        console.error('[PWA] Service worker registration failed:', error);
    }
};

const bindControllerChangeReload = () => {
    if (_swControllerReloadBound || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    _swControllerReloadBound = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swReloadPending) return;
        _swReloadPending = true;
        console.log('[PWA] Service worker controller changed');
        globalThis?.dispatchEvent?.(new CustomEvent('sw-controller-changed'));
        // Reload only when explicitly requested by caller.
        if (_swOptions?.immediate === true) {
            globalThis.location.reload();
        }
    });
};

const activateWaitingWorker = (registration: ServiceWorkerRegistration, reason: 'initial' | 'updatefound') => {
    const waiting = registration?.waiting;
    if (!waiting) return false;
    console.log(`[PWA] Activating waiting service worker (${reason})`);
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
};

/**
 * Initialize PWA service worker early in the page lifecycle
 * This ensures share target and other PWA features work correctly
 */
export const initServiceWorker = async (_options: { immediate?: boolean, onRegistered?: () => void, onRegisterError?: (error: any) => void } = _swOptions): Promise<ServiceWorkerRegistration | null> => {
    _swOptions = { ..._swOptions, ...(_options || {}) };

    // Return cached promise if already initializing
    if (_swInitPromise) return _swInitPromise;

    _swInitPromise = (async () => {
        // Skip in extension context
        if (typeof globalThis === 'undefined') return null;
        const protocol = (globalThis?.location?.protocol || '').toLowerCase();
        if (protocol === 'chrome-extension:' || protocol === 'file:' || protocol === 'about:') return null;
        if (protocol !== 'https:' && protocol !== 'http:') return null;
        if (!('serviceWorker' in navigator)) {
            console.warn('[PWA] Service workers not supported');
            return null;
        }

        try {
            const registration = await ensureServiceWorkerRegistered();
            if (!registration) {
                console.error('[PWA] Service worker registration failed: no valid sw.js found');
                return null;
            }

            _swRegistration = registration;
            const viteEnv = (import.meta as any)?.env;
            bindControllerChangeReload();

            // In dev, aggressively activate updated SW to avoid stale Workbox routes breaking Vite module fetches.
            // This prevents "Failed to fetch dynamically imported module: /src/..." when an old SW is still controlling the page.
            try {
                if (_swOptions?.immediate === true && registration.waiting) {
                    activateWaitingWorker(registration, 'initial');
                }
            } catch (e) {
                console.warn('[PWA] Failed to auto-activate waiting service worker:', e);
            }

            // Handle updates
            registration?.addEventListener?.('updatefound', () => {
                const newWorker = registration?.installing;
                if (newWorker) {
                    newWorker?.addEventListener?.('statechange', () => {
                        if (newWorker?.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[PWA] New service worker available');
                            showToast({ message: 'App update available', kind: 'info' });
                            try {
                                if (_swOptions?.immediate === true && !activateWaitingWorker(registration, 'updatefound') && viteEnv?.DEV) {
                                    // In dev, try one more time after a micro-delay while waiting worker settles.
                                    globalThis.setTimeout(() => {
                                        try {
                                            activateWaitingWorker(registration, 'updatefound');
                                        } catch (retryError) {
                                            console.warn('[PWA] Delayed SW activation failed:', retryError);
                                        }
                                    }, 0);
                                }
                            } catch (e) {
                                console.warn('[PWA] Failed to auto-activate waiting service worker on updatefound:', e);
                            }
                        }
                    });
                }
            });

            // Check for updates periodically (every 30 minutes) — prod only; dev SW churn is noisy.
            if (_swUpdateInterval) {
                globalThis?.clearInterval?.(_swUpdateInterval);
                _swUpdateInterval = null;
            }
            if (!viteEnv?.DEV) {
                _swUpdateInterval = globalThis?.setInterval?.(() => {
                    registration?.update?.().catch?.(console.warn);
                }, 30 * 60 * 1000) as unknown as number | null;
            }

            console.log('[PWA] Service worker registered successfully');
            return registration;
        } catch (error) {
            console.error('[PWA] Service worker registration failed:', error);
            return null;
        }
    })();

    return _swInitPromise;
};

/**
 * Get current service worker registration
 */
export const getServiceWorkerRegistration = () => _swRegistration;

/**
 * Wait for service worker to be ready
 */
export const waitForServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
    if (_swRegistration) return _swRegistration;
    return _swInitPromise || initServiceWorker();
};

// ============================================================================
// BROADCAST RECEIVERS
// ============================================================================

let _receiversCleanup: (() => void) | null = null;

/** Initialize one-time clipboard/share receivers used by the window-side PWA bridge. */
export const initReceivers = () => {
    if (_receiversCleanup) return;
    _receiversCleanup = initPWAClipboard();
};

// ============================================================================
// SHARE TARGET PROCESSING
// ============================================================================

interface ShareDataInput {
    title?: string;
    text?: string;
    url?: string;
    sharedUrl?: string;
    files?: File[] | any[];
    fileCount?: number;
    imageCount?: number;
    timestamp?: number;
    aiProcessed?: boolean;
    aiEnabled?: boolean;
    results?: any[];
    source?: string;
    hint?: ViewTransferHint;
}

const inferShareContentType = (shareData: ShareDataInput): "markdown" | "text" | "image" | "file" | "url" | "other" => {
    const files = Array.isArray(shareData.files) ? shareData.files.filter((f): f is File => f instanceof File) : [];
    const text = String(shareData.text || "").trim();
    const url = String(shareData.url || shareData.sharedUrl || "").trim();

    if (files.length > 0) {
        const file = files[0];
        const name = String(file?.name || "").toLowerCase();
        const mime = String(file?.type || "").toLowerCase();
        if (mime.startsWith("image/")) return "image";
        if (mime === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".mdown")) return "markdown";
        if (mime.startsWith("text/")) return "text";
        return "file";
    }

    if (text) return "text";
    if (url) return "url";
    return "other";
};

const isTextLikeFile = (file: File): boolean => {
    const name = String(file?.name || "").toLowerCase();
    const mime = String(file?.type || "").toLowerCase();
    if (mime === "text/markdown" || mime === "text/plain" || mime === "text/html") return true;
    if (mime.startsWith("text/")) return true;
    return (
        name.endsWith(".md") ||
        name.endsWith(".markdown") ||
        name.endsWith(".mdown") ||
        name.endsWith(".txt") ||
        name.endsWith(".html") ||
        name.endsWith(".htm")
    );
};

const hydrateTextPayloadFromFiles = async (shareData: ShareDataInput): Promise<ShareDataInput> => {
    const files = Array.isArray(shareData.files) ? shareData.files.filter((f): f is File => f instanceof File) : [];
    if (!files.length || String(shareData.text || "").trim()) return shareData;

    const firstTextFile = files.find(isTextLikeFile);
    if (!firstTextFile) return shareData;

    try {
        const text = await firstTextFile.text();
        const trimmed = text?.trim?.();
        if (!trimmed) return shareData;
        return {
            ...shareData,
            title: shareData.title || firstTextFile.name,
            text: trimmed
        };
    } catch {
        return shareData;
    }
};

const shouldForceWorkCenterAttachment = async (shareData: ShareDataInput): Promise<boolean> => {
    const contentType = inferShareContentType(shareData);

    // Explicit SW signal has highest priority for this share payload.
    if (typeof shareData.aiEnabled === "boolean") {
        return shareData.aiEnabled === false && !(contentType === "text" || contentType === "markdown");
    }

    // Fallback to current app settings if share packet does not carry aiEnabled.
    try {
        const settings = await loadSettings().catch(() => null);
        return (settings?.ai?.autoProcessShared ?? true) === false && !(contentType === "text" || contentType === "markdown");
    } catch {
        return false;
    }
};

const extractTransferHint = (shareData: ShareDataInput): ViewTransferHint | undefined => {
    const hint = shareData?.hint;
    if (!hint || typeof hint !== "object") return undefined;
    return hint;
};

const hydrateTransferPayloadFromCache = async (opts: { clear?: boolean } = {}): Promise<ShareDataInput | null> => {
    const cachedPayload = await consumeCachedShareTargetPayload(opts);
    if (!cachedPayload) return null;
    return buildShareDataFromCachedPayload(cachedPayload) as ShareDataInput;
};

const routeToTransferView = async (
    shareData: ShareDataInput,
    source: "share-target" | "launch-queue" | "pending",
    hint?: ViewTransferHint,
    pending = false
): Promise<boolean> => {
    await waitForIngressPipelineSlot();

    const preparedData = await hydrateTextPayloadFromFiles(shareData);

    const files = Array.isArray(preparedData.files)
        ? preparedData.files.filter((file): file is File => file instanceof File)
        : [];

    console.log("[ViewTransfer] Pipeline input:", summarizeForLog({
        source,
        pending,
        hint,
        title: preparedData.title,
        text: preparedData.text,
        url: preparedData.url || preparedData.sharedUrl,
        fileCount: files.length,
        fileCountReported: preparedData.fileCount,
        imageCountReported: preparedData.imageCount,
        timestamp: preparedData.timestamp
    }));

    const forceAttachToWorkCenter = await shouldForceWorkCenterAttachment(preparedData);
    const resolvedHint: ViewTransferHint | undefined = forceAttachToWorkCenter
        ? { destination: "workcenter", action: "attach", ...(hint || {}) }
        : (
            hint ||
            (inferShareContentType(preparedData) === "markdown" || inferShareContentType(preparedData) === "text"
                ? { destination: "viewer", action: "open", filename: files[0]?.name }
                : undefined)
        );

    console.log("[ViewTransfer] Hint resolution:", {
        forceAttachToWorkCenter,
        inputHint: summarizeForLog(hint),
        resolvedHint: summarizeForLog(resolvedHint)
    });

    const { delivered, resolved } = await dispatchViewTransfer({
        source,
        route: source === "launch-queue" ? "launch-queue" : "share-target",
        title: preparedData.title,
        text: preparedData.text,
        url: preparedData.url || preparedData.sharedUrl,
        files,
        hint: resolvedHint,
        pending,
        metadata: {
            timestamp: preparedData.timestamp || Date.now(),
            fileCount: preparedData.fileCount ?? files.length,
            imageCount: preparedData.imageCount ?? files.filter((f) => f.type.startsWith("image/")).length
        }
    });

    console.log("[ViewTransfer] Dispatch result:", {
        delivered,
        destination: resolved.destination,
        routePath: resolved.routePath,
        messageType: resolved.messageType,
        contentType: resolved.contentType
    });

    const currentPath = (globalThis?.location?.pathname || "").replace(/\/+$/, "") || "/";
    let silentRoute = false;
    try {
        const sp = new URLSearchParams(globalThis?.location?.search || "");
        silentRoute = sp.get("silent") === "1" || sp.get("silent") === "true";
    } catch {
        silentRoute = false;
    }

    if (!silentRoute && currentPath !== resolved.routePath) {
        // WHY: when the payload is already delivered (or safely staged in the
        // pending inbox), reuse the current shell instead of bouncing through a
        // hard reload. This keeps markdown/viewer launches on the same surface.
        if (delivered) {
            try {
                const { bootLoader } = await import("boot/ts/BootLoader");
                const shell = bootLoader.getShell();
                const supportsSingletonViewReuse = shell && !["window", "tabbed", "environment"].includes(shell.id);
                if (supportsSingletonViewReuse && shell.getElement?.()?.isConnected) {
                    await shell.navigate(resolved.destination);
                    console.log("[ViewTransfer] Routed through live shell:", resolved.routePath);
                    return delivered;
                }
            } catch (error) {
                console.warn("[ViewTransfer] Live shell routing failed, falling back to hard navigation:", error);
            }
        }

        const nextUrl = new URL(globalThis?.location?.href);
        nextUrl.pathname = resolved.routePath;
        nextUrl.search = "";
        nextUrl.hash = "";
        if (pending) {
            // Cold-start handoff: force cache-backed share bootstrap on next load.
            nextUrl.searchParams.set("shared", "1");
        }
        console.log("[ViewTransfer] Navigating to resolved route:", nextUrl.toString());
        globalThis.location.href = nextUrl.toString();
    } else {
        if (silentRoute && currentPath !== resolved.routePath) {
            console.log("[ViewTransfer] Silent mode: skipping navigation; delivery via channels only:", resolved.routePath);
        } else {
            console.log("[ViewTransfer] Already on resolved route:", resolved.routePath);
        }
    }

    return delivered;
};

/**
 * Extract processable content from share data
 * Handles various formats from SW, server, or direct input
 */
const extractShareContent = (shareData: ShareDataInput): { content: string | null; type: 'text' | 'url' | 'file' | null } => {
    // Check for text content first
    const text = shareData.text?.trim();
    if (text) {
        return { content: text, type: 'text' };
    }

    // Check for URL (handle both 'url' and 'sharedUrl' from server)
    const url = (shareData.url || shareData.sharedUrl)?.trim();
    if (url) {
        return { content: url, type: 'url' };
    }

    // Check for title as fallback
    const title = shareData.title?.trim();
    if (title) {
        return { content: title, type: 'text' };
    }

    // Check for actual file objects
    if (Array.isArray(shareData.files) && shareData.files.length > 0) {
        const firstFile = shareData.files[0];
        if (firstFile instanceof File || firstFile instanceof Blob) {
            return { content: null, type: 'file' };
        }
    }

    return { content: null, type: null };
};

/**
 * Process share payloads on the page side when the service worker either did
 * not process them or only delivered metadata.
 */
export const processShareTargetData = async (shareData: ShareDataInput, skipIfEmpty = false): Promise<boolean> => {
    console.log("[ShareTarget] Processing shared data:", {
        hasText: !!shareData.text,
        hasUrl: !!shareData.url,
        fileCount: shareData.files?.length || shareData.fileCount || 0,
        imageCount: shareData.imageCount || 0,
        source: shareData.source || 'unknown',
        aiProcessed: shareData.aiProcessed
    });

    // If AI already processed in SW, just show result info
    if (shareData.aiProcessed && shareData.results?.length) {
        console.log("[ShareTarget] AI already processed in SW, showing result");
        showToast({ message: "Content processed by service worker", kind: "success" });
        return true;
    }

    const { content, type } = extractShareContent(shareData);

    console.log("[ShareTarget] Extracted content:", { content: content?.substring(0, 50), type });

    if (!content && type !== 'file') {
        if (skipIfEmpty) {
            console.log("[ShareTarget] No content to process (skipping)");
            return false;
        }

        // Check if there's file metadata but no actual files
        if (shareData.fileCount && shareData.fileCount > 0) {
            // Files were processed in SW, this is just metadata notification
            console.log("[ShareTarget] Files processed in service worker");
            showToast({ message: "Files received and being processed", kind: "info" });
            return true;
        }

        console.warn("[ShareTarget] No content to process");
        showToast({ message: "No content received to process", kind: "warning" });
        return false;
    }

    try {
        console.log("[ShareTarget] Starting AI processing for type:", type);
        showToast({ message: "Processing shared content...", kind: "info" });

        // Utility function to convert file to base64
        const fileToBase64 = (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        };

        // Use unified processing endpoint
        console.log("[ShareTarget] Using unified processing endpoint");

        let processingContent: any;
        let contentType: string;

        if (type === 'file' && shareData.files?.[0]) {
            const file = shareData.files[0] as File;
            console.log("[ShareTarget] Processing file:", { name: file.name, type: file.type, size: file.size });

            // Convert file to base64 for API transport
            const base64 = await fileToBase64(file);
            processingContent = base64;
            contentType = 'base64';
        } else if (content) {
            processingContent = content;
            contentType = 'text';
            console.log("[ShareTarget] Processing text content, length:", content.length);
        } else {
            throw new Error("No processable content found");
        }

        // Call unified processing endpoint
        console.log("[ShareTarget] Calling unified processing API");
        const response = await fetch('/api/processing', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: processingContent,
                contentType,
                processingType: 'general-processing',
                metadata: {
                    source: 'share-target',
                    title: shareData.title || 'Shared Content',
                    timestamp: Date.now()
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Processing API failed: ${response.status}`);
        }

        const result = await response.json();
        console.log("[ShareTarget] Unified processing completed:", { success: result.success });

        if (result.success && result.data) {
            console.log("[ShareTarget] Processing result via unified messaging");

            // Send to clipboard if configured
            const clipboardChannel = new BroadcastChannel(CHANNELS.CLIPBOARD);
            clipboardChannel.postMessage({
                type: 'copy',
                data: result.data
            });
            clipboardChannel.close();

            // Send to workcenter for display (destination-aware)
            try {
                const { unifiedMessaging } = await import("com/core/UnifiedMessaging");
                await unifiedMessaging.sendMessage({
                    type: 'share-target-result',
                    source: 'share-target',
                    destination: 'workcenter',
                    data: {
                        content: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
                        rawData: result.data,
                        timestamp: Date.now(),
                        source: 'share-target',
                        action: 'Processing (/api/processing)',
                        metadata: result.metadata
                    },
                    metadata: { priority: 'high' }
                } as any);
            } catch (e) {
                // Fallback to legacy broadcast (best-effort)
                const workCenterChannel = new BroadcastChannel(BROADCAST_CHANNELS.WORK_CENTER);
                workCenterChannel.postMessage({
                    type: 'share-target-result',
                    data: {
                        content: result.data,
                        rawData: result.data,
                        timestamp: Date.now(),
                        source: 'share-target',
                        action: 'Processing (/api/processing)',
                        metadata: result.metadata
                    }
                });
                workCenterChannel.close();
            }

            return true;
        } else {
            const errorMsg = result?.error || "AI processing returned no data";
            console.warn("[ShareTarget] AI processing failed:", errorMsg);

            // Broadcast error to clipboard handlers
            const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
            shareChannel.postMessage({
                type: 'ai-result',
                data: { success: false, error: errorMsg }
            });
            shareChannel.close();

            showToast({ message: `Processing failed: ${errorMsg}`, kind: "warning" });
            return false;
        }
    } catch (error: any) {
        console.error("[ShareTarget] Processing error:", error);

        // Try fallback to server-side AI processing
        console.log("[ShareTarget] Attempting server-side fallback");
        const fallbackResult = await tryServerSideProcessing(shareData);
        if (fallbackResult) {
            console.log("[ShareTarget] Server-side fallback succeeded");
            return true;
        }

        console.warn("[ShareTarget] All processing methods failed");

        // Broadcast error to clipboard handlers
        const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
        shareChannel.postMessage({
            type: 'ai-result',
            data: { success: false, error: error?.message || String(error) }
        });
        shareChannel.close();

        showToast({ message: `Processing failed: ${error?.message || 'Unknown error'}`, kind: "error" });
        return false;
    }
};

// BroadcastChannel names (using centralized naming system)
export const CHANNELS = {
    SHARE_TARGET: BROADCAST_CHANNELS.SHARE_TARGET,
    TOAST: BROADCAST_CHANNELS.TOAST,
    CLIPBOARD: BROADCAST_CHANNELS.CLIPBOARD,
    MINIMAL_APP: BROADCAST_CHANNELS.MINIMAL_APP,
    MAIN_APP: BROADCAST_CHANNELS.MAIN_APP,
    FILE_EXPLORER: BROADCAST_CHANNELS.FILE_EXPLORER,
    PRINT_VIEWER: BROADCAST_CHANNELS.PRINT_VIEWER
} as const;

// ============================================================================
// SHARE TARGET CACHE CONSUMPTION (FILES)
// ============================================================================

export const storeShareTargetPayloadToCache = async (payload: { files: File[]; meta?: any }): Promise<boolean> =>
    storeShareTargetPayloadToCacheGateway(payload);

/**
 * Read and (optionally) clear share-target cached payload, including real files.
 * This is used by Basic edition to attach incoming files to WorkCenter or open markdown.
 */
export const consumeCachedShareTargetPayload = async (opts: { clear?: boolean } = {}): Promise<CachedShareTargetPayload | null> =>
    consumeCachedShareTargetPayloadFromGateway(opts);

/**
 * Fallback to server-side AI processing when client-side fails
 * Broadcasts results to PWA clipboard handlers instead of copying directly
 */
const tryServerSideProcessing = async (shareData: ShareDataInput): Promise<boolean> => {
    try {
        const { content, type } = extractShareContent(shareData);
        if (!content) return false;

        console.log("[ShareTarget] Attempting server-side AI fallback");

        // Get API settings
        const { getRuntimeSettings } = await import("com/config/RuntimeSettings");
        const settings = await getRuntimeSettings().catch(() => null);
        const apiKey = settings?.ai?.apiKey;

        if (!apiKey) {
            console.log("[ShareTarget] No API key for server fallback");
            return false;
        }

        // Call server-side AI endpoint
        const response = await fetch('/api/share/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: type === 'text' ? content : undefined,
                url: type === 'url' ? content : undefined,
                title: shareData.title,
                apiKey,
                baseUrl: settings?.ai?.baseUrl,
                model: settings?.ai?.customModel || settings?.ai?.model
            })
        });

        if (!response.ok) {
            console.warn("[ShareTarget] Server fallback failed:", response.status);
            return false;
        }

        const result = await response.json();
        if (result?.ok && result?.data) {
            // Broadcast result to PWA clipboard handlers
            console.log("[ShareTarget] Broadcasting server-side result to clipboard handlers");
            const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
            shareChannel.postMessage({
                type: 'ai-result',
                data: { success: true, data: String(result.data) }
            });
            shareChannel.close();
            return true;
        }

        return false;
    } catch (error) {
        console.warn("[ShareTarget] Server fallback error:", error);
        return false;
    }
};

/**
 * Consume share-target payloads from URL params, cache recovery, session
 * storage, launch flows, and BroadcastChannel notifications.
 *
 * INVARIANT: this function favors routing content into the normal transfer/view
 * pipeline first, and only falls back to local processing when delivery cannot
 * be staged or routed.
 */
export const handleShareTarget = () => {
    const params = new URLSearchParams(globalThis?.location?.search);
    const shared = params.get("shared");
    const hasExplicitSharedFlow = shared === "1" || shared === "true" || shared === "test";
    let routedFromSessionPending = false;

    // Handle URL params from server-side share handler
    if (shared === "1" || shared === "true") {
        console.log("[ShareTarget] Detected shared=1 URL param, processing server-side share");

        // Extract share data from URL params (server-side handler)
        const shareFromParams: ShareDataInput = {
            title: params.get("title") || undefined,
            text: params.get("text") || undefined,
            url: params.get("url") || undefined,
            sharedUrl: params.get("sharedUrl") || undefined,
            timestamp: Date.now(),
            source: 'url-params'
        };

        console.log("[ShareTarget] Share data from URL params:", summarizeForLog({
            title: shareFromParams.title,
            text: shareFromParams.text,
            url: shareFromParams.url,
            sharedUrl: shareFromParams.sharedUrl
        }));

        // Clean up URL
        const cleanUrl = new URL(globalThis?.location?.href);
        ['shared', 'action', 'title', 'text', 'url', 'sharedUrl'].forEach(p => cleanUrl.searchParams.delete(p));
        globalThis?.history?.replaceState?.({}, "", cleanUrl.pathname + cleanUrl.hash);

        // Check if we have content from params
        const { content, type } = extractShareContent(shareFromParams);
        console.log("[ShareTarget] Extracted from URL params:", { content: content?.substring(0, 50), type });

        if (content || type === 'file') {
            console.log("[ShareTarget] Processing from URL params");
            routeToTransferView(shareFromParams, "share-target", extractTransferHint(shareFromParams), true).catch((error) => {
                console.warn("[ShareTarget] Route transfer failed, falling back to processing:", error);
                processShareTargetData(shareFromParams, true);
            });
            return; // Don't also check cache
        } else {
            console.log("[ShareTarget] No processable content in URL params, checking cache");
        }

        // No content in params, try cache
        if ('caches' in globalThis) {
            caches.open("share-target-data")
                .then(cache => cache?.match?.("/share-target-data"))
                .then(response => response?.json?.())
                .then(async (data: ShareDataInput | undefined) => {
                    if (data) {
                        let transferPayload: ShareDataInput = data;

                        // Hydrate real files for metadata-only cached payloads.
                        if ((data.fileCount ?? 0) > 0 && !data.files?.length) {
                            try {
                                const cachedTransferPayload = await hydrateTransferPayloadFromCache({ clear: false });
                                if (cachedTransferPayload) {
                                    transferPayload = {
                                        ...cachedTransferPayload,
                                        ...data
                                    };
                                }
                            } catch (cacheError) {
                                console.warn("[ShareTarget] Failed to hydrate cached share files from URL flow:", cacheError);
                            }
                        }

                        console.log("[ShareTarget] Retrieved cached data:", summarizeForLog(transferPayload));
                        const delivered = await routeToTransferView(transferPayload, "share-target", extractTransferHint(transferPayload), true);
                        if (!delivered) {
                            await processShareTargetData(transferPayload, true);
                        }
                    } else {
                        console.log("[ShareTarget] No cached share data found");
                    }
                })
                .catch(e => console.warn("[ShareTarget] Cache retrieval failed:", e));
        }
    } else if (shared === "test") {
        // Test mode - just show confirmation
        showToast({ message: "Share target route working", kind: "info" });

        const cleanUrl = new URL(globalThis?.location?.href);
        cleanUrl.searchParams.delete("shared");
        globalThis?.history?.replaceState?.({}, "", cleanUrl.pathname + cleanUrl.hash);
    }

    // Check for pending share data from sessionStorage (server-side handler fallback)
    try {
        const pendingData = sessionStorage.getItem("rs-pending-share");
        if (pendingData) {
            sessionStorage.removeItem("rs-pending-share");
            const shareData = JSON.parse(pendingData) as ShareDataInput;
            console.log("[ShareTarget] Found pending share in sessionStorage:", summarizeForLog(shareData));
            routedFromSessionPending = true;
            routeToTransferView(shareData, "pending", extractTransferHint(shareData), true).catch((error) => {
                console.warn("[ShareTarget] Pending transfer routing failed:", error);
            });
        }
    } catch (e) {
        // Ignore sessionStorage errors
    }

    // Recovery path for cold/fresh starts where OS/file launch happened but
    // neither URL params nor session pending marker survived.
    if (!hasExplicitSharedFlow && !routedFromSessionPending) {
        void (async () => {
            try {
                let cachedPayload: CachedShareTargetPayload | null = null;
                let meta: Record<string, unknown> = {};
                let files: File[] = [];
                let expectedFileCount = 0;

                // On cold start, metadata can appear before file blobs are fully written to cache.
                // Retry a few short times so we don't dispatch a "fileCount>0 but files=[]" payload.
                for (let attempt = 1; attempt <= 4; attempt++) {
                    cachedPayload = await consumeCachedShareTargetPayload({ clear: false });
                    meta = (cachedPayload?.meta && typeof cachedPayload.meta === "object")
                        ? (cachedPayload.meta as Record<string, unknown>)
                        : {};
                    files = Array.isArray(cachedPayload?.files) ? cachedPayload.files : [];
                    expectedFileCount = Number(meta?.fileCount || 0);

                    if (expectedFileCount <= 0 || files.length > 0) break;
                    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200 * attempt));
                }

                const timestamp = Number(meta?.timestamp || Date.now());
                const ageMs = Date.now() - timestamp;

                // Keep this bootstrap narrow to avoid replaying stale payloads.
                if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5 * 60 * 1000) return;

                const transferPayload: ShareDataInput = {
                    ...(buildShareDataFromCachedPayload({
                        meta: meta as any,
                        files,
                        fileMeta: cachedPayload?.fileMeta || []
                    }) as ShareDataInput),
                    fileCount: files.length || expectedFileCount,
                    timestamp,
                    source: "cached-bootstrap"
                };

                if (
                    !transferPayload.text &&
                    !transferPayload.url &&
                    !transferPayload.title &&
                    (transferPayload.fileCount ?? 0) <= 0
                ) {
                    return;
                }

                console.log("[ShareTarget] Bootstrap recovery from cached payload:", summarizeForLog({
                    source: transferPayload.source,
                    fileCount: transferPayload.fileCount,
                    imageCount: transferPayload.imageCount,
                    hasText: !!transferPayload.text,
                    hasUrl: !!transferPayload.url,
                    ageMs
                }));

                const delivered = await routeToTransferView(transferPayload, "pending", extractTransferHint(transferPayload), true);
                const hasBinaryPayload = Array.isArray(transferPayload.files) && transferPayload.files.length > 0;
                if (delivered && !hasBinaryPayload) {
                    await consumeCachedShareTargetPayload({ clear: true }).catch(() => null);
                }
            } catch (error) {
                console.warn("[ShareTarget] Cached bootstrap recovery failed:", error);
            }
        })();
    }

    // Listen for real-time share target broadcasts from service worker
    // Note: AI results are handled by PWA clipboard receivers, this handles share notifications
    if (typeof BroadcastChannel !== "undefined") {
        const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
        shareChannel.addEventListener("message", async (event) => {
            const msgType = event.data?.type;
            const msgData = event.data?.data;

            console.log("[ShareTarget] Broadcast received:", { type: msgType, hasData: !!msgData });

            if (msgType === "share-received" && msgData) {
                console.log("[ShareTarget] Share notification received:", {
                    hasText: !!msgData.text,
                    hasUrl: !!msgData.url,
                    fileCount: msgData.fileCount || 0,
                    aiEnabled: msgData.aiEnabled,
                    source: msgData.source
                });

                let transferPayload: ShareDataInput = msgData;

                // If SW only sent metadata counters, hydrate real files from cache so they can be attached.
                if ((msgData.fileCount ?? 0) > 0 && !msgData.files?.length) {
                    try {
                        const cachedTransferPayload = await hydrateTransferPayloadFromCache({ clear: false });
                        if (cachedTransferPayload) {
                            transferPayload = {
                                ...cachedTransferPayload,
                                ...msgData
                            };
                            showToast({ message: `Received ${cachedTransferPayload.files?.length || msgData.fileCount || 0} shared file(s)`, kind: "info" });
                        }
                    } catch (cacheError) {
                        console.warn("[ShareTarget] Failed to hydrate cached share files:", cacheError);
                    }
                }

                if (
                    transferPayload.files?.length ||
                    transferPayload.text ||
                    transferPayload.url ||
                    transferPayload.title ||
                    (transferPayload.fileCount ?? 0) > 0
                ) {
                    console.log("[ShareTarget] Processing broadcasted share data");
                    const delivered = await routeToTransferView(transferPayload, "share-target", extractTransferHint(transferPayload), true);
                    if (!delivered) {
                        await processShareTargetData(transferPayload, true);
                    }
                } else if ((msgData.fileCount ?? 0) > 0) {
                    showToast({ message: `Processing ${msgData.fileCount} file(s)...`, kind: "info" });
                }
            } else if (msgType === "ai-result") {
                console.log("[ShareTarget] AI result broadcast received (handled by PWA clipboard)");
            }
        });

        console.log("[ShareTarget] Broadcast channel listener set up");
    } else {
        console.warn("[ShareTarget] BroadcastChannel not available");
    }
};

// ============================================================================
// LAUNCH QUEUE TYPES AND HANDLING
// ============================================================================

// Type definitions for Launch Queue API
interface LaunchParams {
    files: FileSystemFileHandle[];
    targetURL?: string;
}

interface LaunchQueue {
    setConsumer(callback: (launchParams: LaunchParams) => void): void;
}

declare global {
    interface Window {
        launchQueue?: LaunchQueue;
    }
}

/**
 * Register the browser Launch Queue consumer used for direct file-open flows.
 *
 * WHY: launched files can arrive before the destination view is mounted, so the
 * handler stages them in cache first and then routes them into the normal
 * transfer pipeline.
 */
export const setupLaunchQueueConsumer = async () => {
    if (!('launchQueue' in globalThis)) {
        console.log('[LaunchQueue] launchQueue API not available');
        return;
    }

    try {
        // Set up the consumer for launch queue
        globalThis?.launchQueue?.setConsumer?.((launchParams: LaunchParams) => {
            console.log('[LaunchQueue] Launch params received:', summarizeForLog({
                fileHandleCount: launchParams?.files?.length || 0,
                hasTargetUrl: !!launchParams?.targetURL,
                targetURL: launchParams?.targetURL
            }));
            const $files = [...launchParams.files];

            // Handle files from launch queue
            if (!$files || $files.length === 0) {
                console.log('[LaunchQueue] No files in launch params - this may indicate:');
                console.log('  - File opener was used but no files were selected');
                console.log('  - Launch queue consumer called with empty payload');
                console.log('  - Permission issues preventing file access');
                console.log('  - Browser compatibility issues');
                return;
            }

            //
            console.log(`[LaunchQueue] Processing ${$files.length} file handle(s)`);

            // Convert FileSystemHandle objects to actual File objects
            const files: File[] = [];
            const failedHandles: any[] = [];
            let hasMarkdownFile = false;

            //
            (async () => {
                for (const fileHandle of $files) {
                    try {
                        console.log('[LaunchQueue] Processing file handle:', {
                            name: fileHandle.name || 'unknown',
                            type: fileHandle.constructor.name,
                            hasGetFile: typeof fileHandle.getFile === 'function',
                            isFile: fileHandle instanceof File
                        });

                        // For file handles, get the actual file
                        if (fileHandle.getFile) {
                            try {
                                // Check if we have permission to access the file
                                if ('queryPermission' in fileHandle) {
                                    let permission = await (fileHandle as any).queryPermission({ mode: 'read' });
                                    console.log('[LaunchQueue] File handle permission:', permission);
                                    if (permission === 'prompt' && 'requestPermission' in fileHandle) {
                                        try {
                                            permission = await (fileHandle as any).requestPermission({ mode: 'read' });
                                            console.log('[LaunchQueue] File handle permission requested:', permission);
                                        } catch (permissionError) {
                                            console.warn('[LaunchQueue] requestPermission failed:', permissionError);
                                        }
                                    }
                                    if (permission !== 'granted') {
                                        console.warn('[LaunchQueue] No permission to access file:', fileHandle.name, permission);
                                        failedHandles.push(fileHandle);
                                        continue;
                                    }
                                }

                                const file = await fileHandle.getFile();
                                console.log('[LaunchQueue] Got file from handle:', file.name, file.type, file.size);
                                files.push(file);
                                // Check if this is a markdown file
                                if (file.type === 'text/markdown' || file.name.toLowerCase().endsWith('.md')) {
                                    hasMarkdownFile = true;
                                }
                            } catch (permError) {
                                console.warn('[LaunchQueue] Permission or access error for file handle:', permError, fileHandle);
                                failedHandles.push(fileHandle);
                            }
                        } else if (fileHandle instanceof File) {
                            // Already a File object
                            console.log('[LaunchQueue] File handle is already a File object:', fileHandle.name, fileHandle.type);
                            files.push(fileHandle);
                            // Check if this is a markdown file
                            if (fileHandle.type === 'text/markdown' || fileHandle.name.toLowerCase().endsWith('.md')) {
                                hasMarkdownFile = true;
                            }
                        } else {
                            console.warn('[LaunchQueue] Unknown file handle type:', fileHandle.constructor.name);
                            failedHandles.push(fileHandle);
                        }
                    } catch (error) {
                        console.warn('[LaunchQueue] Failed to get file from handle:', error, fileHandle);
                        failedHandles.push(fileHandle);
                    }
                }

                console.log(`[LaunchQueue] Successfully processed ${files.length} files, ${failedHandles.length} failed`);

                // Check if we have any successfully processed files
                if (files.length === 0) {
                    if (failedHandles.length > 0) {
                        console.error('[LaunchQueue] All file handles failed to process');
                        showToast({
                            message: `Failed to process ${failedHandles.length} launched file(s)`,
                            kind: 'error'
                        });
                    } else {
                        console.log('[LaunchQueue] No files to process after filtering');
                    }
                    return;
                }

                if (files.length > 0) {
                    const hint: ViewTransferHint | undefined = (hasMarkdownFile && files.length === 1)
                        ? { destination: "viewer", action: "open", filename: files[0]?.name }
                        : undefined;
                    const timestamp = Date.now();
                    const imageCount = files?.filter?.(f => f.type.startsWith('image/')).length;

                    // INVARIANT: launch-queue files stage into the same cache-backed
                    // ingress pipeline as share-target, then the normal share-target
                    // consumer performs the eventual routing and optional processing.
                    const staged = await storeShareTargetPayloadToCache({
                        files,
                        meta: {
                            timestamp,
                            source: 'launch-queue',
                            route: 'launch-queue',
                            hint,
                            fileCount: files.length,
                            imageCount,
                        }
                    });
                    if (!staged) {
                        console.warn('[LaunchQueue] Failed to pre-stage files to cache');
                    }

                    console.log('[LaunchQueue] Staged launch queue payload:', {
                        fileCount: files.length,
                        imageCount,
                        fileTypes: files?.map?.(f => ({ name: f.name, type: f.type, size: f.size })),
                        source: 'launch-queue',
                        staged
                    });

                    // Show immediate feedback that files were received
                    showToast({
                        message: `Received ${files.length} file(s)`,
                        kind: 'info'
                    });

                    if (staged) {
                        const delivered = await routeToTransferView({
                            title: files[0]?.name,
                            files,
                            fileCount: files.length,
                            imageCount,
                            timestamp,
                            source: 'launch-queue',
                            hint,
                        }, 'launch-queue', hint, true);

                        if (!delivered) {
                            const url = new URL(globalThis?.location?.href);
                            url.pathname = '/share-target';
                            url.searchParams.set('shared', '1');
                            url.hash = '';
                            globalThis.location.href = url.toString();
                        }
                    } else {
                        showToast({
                            message: `Failed to stage ${files.length} launched file(s)`,
                            kind: 'error'
                        });
                    }
                }

                // Handle any target URL if present (for custom protocol launches)
                if (launchParams.targetURL) {
                    console.log('[LaunchQueue] Target URL:', launchParams.targetURL);
                    // Could handle URL-based launches here if needed
                }
            })();
        });

        console.log('[LaunchQueue] Consumer set up successfully');
    } catch (error) {
        console.error('[LaunchQueue] Failed to set up consumer:', error);
    }
};

// ============================================================================
// PENDING SHARE DATA HANDLING
// ============================================================================

/**
 * Recover pending share payloads staged by server-side handlers when no worker
 * was active to own the original share request.
 */
export const checkPendingShareData = async () => {
    try {
        const pendingData = globalThis?.sessionStorage?.getItem?.("rs-pending-share");
        if (!pendingData) return null;

        // Clear immediately to prevent duplicate processing
        globalThis?.sessionStorage?.removeItem?.("rs-pending-share");

        const shareData = JSON.parse(pendingData);
        console.log("[ShareTarget] Found pending share data:", summarizeForLog(shareData));

        // Store in cache for the normal share target flow to pick up
        if ('caches' in window) {
            const cache = await globalThis?.caches?.open?.('share-target-data');
            await cache?.put?.('/share-target-data', new Response(JSON.stringify({
                ...shareData,
                files: [],
                timestamp: shareData.timestamp || Date.now()
            }), {
                headers: { 'Content-Type': 'application/json' }
            }));
        }

        return shareData;
    } catch (error) {
        console.warn("[ShareTarget] Failed to process pending share data:", error);
        return null;
    }
};