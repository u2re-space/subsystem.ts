/**
 * Window-side PWA integration helpers.
 *
 * This module bridges the main app with the service worker, share-target cache,
 * launch-queue API, and broadcast-based clipboard/share flows. It exists on the
 * page side, while `src/pwa/sw.ts` owns the worker-side behavior.
 */
import { initPWAClipboard } from "./pwa-copy";
import { deliverShareTargetInput } from "./sw-page-bridge";
import { bindIngressHosts } from "./ingress-host";
import { safeCacheMatch, safeCacheOpen } from "./sw-cache";
import { unwrapSwInteropMessage } from "../channel/UniformInterop";
import { showToast } from "../../boot/toast";
import { pathForSkuHostView } from "../../boot/history-base";
import { dropStaleServiceWorkerRegistrations, ensureServiceWorkerRegistered } from "./sw-url";
import { classifyIngressFile, classifyIngressFromBasename, dispatchViewTransfer, type ViewTransferHint } from "../channel/ViewTransferRouting";
import { applyLauncherIngress, installShellImageOpenListener, refineLauncherImageIngress, skuIngressHint } from "../channel/sku-ingress";
import { inferCwspSkuFromLocation, stashSkuHandoff } from "../../other/config/ecosystem-skus";
import { bindDirectoryForLaunchedFiles } from "@fest-lib/lure";
import {
    buildShareDataFromCachedPayload,
    consumeCachedShareTargetPayload,
    storeShareTargetPayloadToCache,
    type CachedShareTargetPayload
} from "../channel/ShareTargetGateway";

export { consumeCachedShareTargetPayload, storeShareTargetPayloadToCache };
import { waitForIngressPipelineSlot } from "../policies/ingress-pipeline-guard";
import { summarizeForLog } from "../channel/LogSanitizer";
import { unifiedMessaging } from "../channel/UnifiedMessaging";
import { loadSettings } from "com/config/Settings";
import { BROADCAST_CHANNELS } from "com/config/Names";
import { postWorkCenterCommand } from "../channel/workcenter-command-wire";
import { postProcessApi, processApiAuthFromSettings, readProcessApiResultText } from "../api/process-api";
import { classifyOpenKindFromPayload } from "../../other/config/open-policy";
import {
    formatProcessIngressResult,
    holdCapacitorIngressJob,
    instructionTextForIngress,
    allowProcessWebShareLaunch,
    allowProcessWebLaunchQueue,
    rememberProcessIngressSettings,
    resolveProcessIngressKind,
    writeProcessIngressClipboard
} from "../../other/config/process-ingress";

// ============================================================================
// EXTENSION VS PWA
// ============================================================================

/**
 * WHY: MV3 extension pages (`chrome-extension:`) do not expose PWA-relative routes (`/clipboard/pending`)
 * or the site service worker bundle. Running ingress here caused `fetch('/clipboard/pending')` →
 * `chrome-extension://…/clipboard/pending` (404) and needless SW / launch-queue churn during boot.
 *
 * IMPORTANT: Compare `href`/protocol explicitly — if `location.protocol` were ever missing briefly,
 * `undefined !== "chrome-extension:"` was true and the full PWA clipboard stack still ran.
 */
const shouldRunPwaIngress = (): boolean => {
    try {
        // WHY: never bare `window` — MV3 SW throws ReferenceError: window is not defined.
        const g = globalThis as unknown as {
            location?: Location;
            __CWS_SKIP_PWA__?: boolean;
            document?: Document;
        };
        if (g.__CWS_SKIP_PWA__) return false;
        const surface = String(g.document?.documentElement?.dataset?.cwspSurface || "");
        if (surface === "cwsp-control" || surface === "gateway") return false;
        const loc = g.location;
        if (!loc) return false;
        const href = String(loc.href ?? "");
        if (
            href.startsWith("chrome-extension://") ||
            href.startsWith("moz-extension://") ||
            href.startsWith("edge-extension://")
        ) {
            return false;
        }
        const p = String(loc.protocol ?? "");
        if (p === "chrome-extension:" || p === "moz-extension:" || p === "edge-extension:") return false;
        return p === "http:" || p === "https:";
    } catch {
        return false;
    }
};

// ============================================================================
// CSS INJECTION
// ============================================================================

/** Ensure the production app CSS bundle is present when the app boots outside extension pages. */
export const ensureAppCss = () => {
    // App is built as a JS module; make sure extracted CSS is loaded in production.
    // Skip extension pages: they have their own HTML entrypoints and CSS injection.
    if (import.meta.env.DEV) return;
    if (!(globalThis as { window?: unknown }).window) return;
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
let _swVisibilityUpdateBound = false;
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

/** WHY: a new worker often reaches `waiting` after boot — DEV-only nudge left #434 stuck. */
const bindWaitingActivation = (registration: ServiceWorkerRegistration): void => {
    const nudge = (reason: 'initial' | 'updatefound') => activateWaitingWorker(registration, reason);
    nudge('initial');
    try {
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
                if (worker.state === 'installed') nudge('updatefound');
            });
        });
    } catch {
        /* ignore */
    }
};

/** Re-fetch `sw.js` from network; helps when CDN/proxy cache or long-lived tabs hide updates. */
const probeServiceWorkerUpdate = async (registration: ServiceWorkerRegistration | null): Promise<void> => {
    await dropStaleServiceWorkerRegistrations();
    let live = registration;
    try {
        live = (await navigator.serviceWorker.getRegistration()) ?? registration;
    } catch {
        /* keep caller’s registration */
    }
    if (!live?.update) return;
    const src = live.active?.scriptURL || live.waiting?.scriptURL || live.installing?.scriptURL || "";
    if (!src) return;
    await live.update().catch((e) => console.warn('[PWA] registration.update failed:', e));
};

const bindServiceWorkerLifecycleUpdateChecks = (registration: ServiceWorkerRegistration): void => {
    if (_swVisibilityUpdateBound || typeof document === 'undefined') return;
    _swVisibilityUpdateBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        void probeServiceWorkerUpdate(registration);
    });
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
                if (import.meta.env.DEV) {
                    console.warn(
                        "[PWA] Service worker not registered (dev): probe failed for dev-sw/sw.js — check Vite BASE_URL matches vite-plugin-pwa dev worker path."
                    );
                } else {
                    console.error("[PWA] Service worker registration failed: no valid sw.js found");
                }
                return null;
            }

            _swRegistration = registration;
            bindControllerChangeReload();

            await probeServiceWorkerUpdate(registration);
            bindServiceWorkerLifecycleUpdateChecks(registration);

            bindWaitingActivation(registration);

            // Handle updates
            registration?.addEventListener?.('updatefound', () => {
                const newWorker = registration?.installing;
                if (newWorker) {
                    newWorker?.addEventListener?.('statechange', () => {
                        if (newWorker?.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[PWA] New service worker available');
                            showToast({ message: 'App update available', kind: 'info' });
                            activateWaitingWorker(registration, 'updatefound');
                        }
                    });
                }
            });

            // Check for updates periodically (every 30 minutes) — prod only; dev SW churn is noisy.
            if (_swUpdateInterval) {
                globalThis?.clearInterval?.(_swUpdateInterval);
                _swUpdateInterval = null;
            }
            if (!import.meta.env.DEV) {
                _swUpdateInterval = globalThis?.setInterval?.(() => {
                    registration?.update?.().catch?.(console.warn);
                }, 5 * 60 * 1000) as unknown as number | null;
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
    const clipboard = initPWAClipboard();
    const hosts = bindIngressHosts();
    _receiversCleanup = () => {
        clipboard();
        hosts();
    };
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
        const kind = classifyIngressFile(files[0]);
        if (kind === "image") return "image";
        if (kind === "markdown") return "markdown";
        if (kind === "text") return "text";
        return "file";
    }

    const fcEarly = Number(shareData.fileCount ?? 0);
    /**
     * Match {@link getContentType}: sidecar `url` must not block basename classification while blobs hydrate.
     * WHY: empty `probe` must fall through — previously we returned `"file"` and never reached `url` / `text`.
     */
    if (fcEarly > 0) {
        const probe =
            (typeof shareData.hint?.filename === "string" && shareData.hint.filename.trim()) ||
            (typeof shareData.title === "string" && shareData.title.trim()) ||
            "";
        if (probe) {
            const bk = classifyIngressFromBasename(probe);
            if (bk === "markdown") return "markdown";
            if (bk === "text") return "text";
            if (bk === "image") return "image";
            return "file";
        }
    }

    if (text) return "text";
    if (url) return "url";
    if (fcEarly > 0) return "file";
    return "other";
};

/** Read textual file body for hydrate + launch-queue staging ({@link classifyIngressFile}). */
const isTextLikeFile = (file: File): boolean => {
    const k = classifyIngressFile(file);
    return k === "markdown" || k === "text";
};

const hydrateTextPayloadFromFiles = async (shareData: ShareDataInput): Promise<ShareDataInput> => {
    const files = Array.isArray(shareData.files) ? shareData.files.filter((f): f is File => f instanceof File) : [];
    if (!files.length) return shareData;

    const existingInline = String(shareData.text || "").trim();

    /** OS launch-queue merges / pending payloads can retain old `text` while `files[]` is the real doc. */
    const sourceKey = String(shareData.source || "");
    const preferReadFromFiles =
        sourceKey === "launch-queue" ||
        sourceKey === "cached-bootstrap" ||
        sourceKey === "share-target" ||
        !existingInline;

    if (!preferReadFromFiles) return shareData;

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

/**
 * WHY: `/share-target?shared=1` can run before SW finishes persisting blobs; routing on metadata alone
 * sent markdown/text shares to Work Center on mobile (`files=[]`, inferred type=`other`/`file`).
 */
const awaitHydratedSharePayloadWithRetries = async (
    base: ShareDataInput,
    maxAttempts = 12
): Promise<ShareDataInput> => {
    let merged = { ...base };
    const expected = Number(merged.fileCount ?? 0);
    if (expected > 0 && !merged.files?.length) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const hydrated = await hydrateTransferPayloadFromCache({ clear: false });
                if (hydrated?.files?.length) {
                    merged = { ...merged, ...hydrated, files: hydrated.files };
                    break;
                }
            } catch {
                /* noop */
            }
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 80 * attempt));
        }
    }
    return merged;
};

/**
 * Merge lightweight URL entry (`/share-target?shared=1&title=…`) with Cache Storage payload.
 * WHY: `extractShareContent` can see a title "handle" and skip the cache branch while `File[]` only lives in the cache.
 */
const mergeUrlParamsShareWithCache = async (fromUrl: ShareDataInput): Promise<ShareDataInput> => {
    try {
        const cache = await safeCacheOpen("share-target-data");
        if (!cache) {
            return { ...fromUrl, source: "share-target" };
        }
        const origin = (globalThis as { location?: { origin?: string } }).location?.origin || "https://localhost";
        const shareKey = new URL("/share-target-data", origin).href;
        const response = (await safeCacheMatch(cache, shareKey)) || (await safeCacheMatch(cache, "/share-target-data"));
        if (!response) {
            return { ...fromUrl, source: "share-target" };
        }
        const row = (await response.json().catch(() => null)) as ShareDataInput | null;
        if (!row) {
            return { ...fromUrl, source: "share-target" };
        }
        const hydrated = await awaitHydratedSharePayloadWithRetries(row);
        const hFiles = Array.isArray(hydrated.files)
            ? hydrated.files.filter((f): f is File => f instanceof File)
            : [];
        const uFiles = Array.isArray(fromUrl.files)
            ? fromUrl.files.filter((f): f is File => f instanceof File)
            : [];
        const files = hFiles.length > 0 ? hFiles : uFiles;
        const fc = Math.max(
            Number(hydrated.fileCount ?? 0),
            Number(fromUrl.fileCount ?? 0),
            files.length
        );
        const hintA = typeof fromUrl.hint === "object" && fromUrl.hint !== null ? { ...fromUrl.hint } : {};
        const hintB =
            typeof hydrated.hint === "object" && hydrated.hint !== null ? { ...(hydrated.hint as object) } : {};
        const hint =
            Object.keys({ ...hintB, ...hintA }).length > 0
                ? {
                      ...hintB,
                      ...hintA,
                      filename: hintA.filename || hintB.filename || files[0]?.name
                  }
                : files[0]?.name
                  ? { filename: files[0].name }
                  : undefined;

        return {
            ...fromUrl,
            ...hydrated,
            title: hydrated.title || fromUrl.title,
            text: hydrated.text ?? fromUrl.text,
            url: hydrated.url || fromUrl.url,
            sharedUrl: hydrated.sharedUrl || fromUrl.sharedUrl,
            files: files.length ? files : undefined,
            fileCount: fc > 0 ? fc : hydrated.fileCount ?? fromUrl.fileCount,
            imageCount: hydrated.imageCount ?? fromUrl.imageCount,
            ...(hint ? { hint } : {}),
            source: "share-target"
        };
    } catch (error) {
        console.warn("[ShareTarget] mergeUrlParamsShareWithCache failed:", error);
        return { ...fromUrl, source: "share-target" };
    }
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

    let autoProcessShared = true;
    let loadedSettings: Awaited<ReturnType<typeof loadSettings>> | null = null;
    try {
        loadedSettings = await loadSettings().catch(() => null);
        rememberProcessIngressSettings(loadedSettings);
        autoProcessShared = (loadedSettings?.ai?.autoProcessShared ?? true) !== false;
        const { rememberOpenPolicyFromSettings } = await import("../../other/config/open-policy");
        rememberOpenPolicyFromSettings(loadedSettings);
    } catch {
        autoProcessShared = true;
    }

    const sku = inferCwspSkuFromLocation();
    const skuHint = await refineLauncherImageIngress(
        skuIngressHint(preparedData, { sku, autoProcessShared, settings: loadedSettings }),
        files
    );
    const forceAttachToWorkCenter =
        !skuHint && (await shouldForceWorkCenterAttachment(preparedData));
    const textLike =
        inferShareContentType(preparedData) === "markdown" || inferShareContentType(preparedData) === "text";

    const mergedViewerHint: ViewTransferHint | undefined =
        !skuHint && textLike && !forceAttachToWorkCenter
            ? {
                  ...hint,
                  destination: "viewer",
                  action: "open",
                  filename: hint?.filename || files[0]?.name
              }
            : undefined;

    const resolvedHint: ViewTransferHint | undefined = skuHint
        ? { ...hint, ...skuHint }
        : forceAttachToWorkCenter
          ? { destination: "workcenter", action: "attach", ...(hint || {}) }
          : mergedViewerHint ?? hint;

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
        fileCount: preparedData.fileCount ?? files.length,
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

    if (sku === "process" && resolvedHint?.action === "process") {
        try {
            await processShareTargetData(preparedData, true);
        } catch (error) {
            console.warn("[ViewTransfer] Process SKU auto-AI failed:", error);
        }
    }
    if (resolved.destination === "home") {
        const capacitorNative = (() => {
            try {
                const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
                return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
            } catch {
                return false;
            }
        })();
        // WHY: Capacitor http(s) SEND already pins via MainActivity; JS must not add a second tile.
        const urlish = String(preparedData.url || preparedData.sharedUrl || "").trim()
            || /^(https?:\/\/|www\.)/i.test(String(preparedData.text || "").trim());
        if (capacitorNative && files.length === 0 && urlish) {
            /* native pin path owns URL shares */
        } else try {
            const kind = await applyLauncherIngress({
                files,
                title: preparedData.title,
                text: preparedData.text,
                url: preparedData.url || preparedData.sharedUrl,
                action: resolvedHint?.action
            });
            if (kind === "wallpaper") {
                showToast({ message: "Wallpaper updated", kind: "success" });
            } else if (kind === "shortcut") {
                showToast({ message: "Shortcut added", kind: "success" });
            }
        } catch (error) {
            console.warn("[ViewTransfer] Launcher share apply failed:", error);
        }
    }

    const currentPath = (globalThis?.location?.pathname || "").replace(/\/+$/, "") || "/";
    // WHY: md.u2re.space / dedicated SKU hosts live at `/`. Hard-nav to `/viewer` + SPA writing `/` is a bootloop.
    const destPath = pathForSkuHostView(resolved.routePath);
    const destNorm = destPath.replace(/\/+$/, "") || "/";
    let silentRoute = false;
    try {
        const sp = new URLSearchParams(globalThis?.location?.search || "");
        silentRoute = sp.get("silent") === "1" || sp.get("silent") === "true";
    } catch {
        silentRoute = false;
    }

    const tryNavigateLiveShell = async (): Promise<boolean> => {
        if (!delivered) return false;
        try {
            const { bootLoader } = await import("boot/BootLoader");
            const shell = bootLoader.getShell();
            const supportsSingletonViewReuse =
                shell && !["window", "tabbed", "environment"].includes(shell.id);
            if (!supportsSingletonViewReuse || !shell.getElement?.()?.isConnected) {
                return false;
            }

            const activeView = shell.getContext?.().navigationState?.currentView;

            /**
             * WHY: Ingress replay (launch-queue / pending) defaults markdown/text to destination
             * `viewer`. After the user opens Work Center, routing here would call `navigate('viewer')`
             * and hide Work Center even though payloads were already delivered via unified messaging.
             * Share Target flows keep `source === "share-target"` and still bump to the viewer when appropriate.
             */
            if (
                resolved.destination === "viewer" &&
                activeView === "workcenter" &&
                source !== "share-target"
            ) {
                console.log("[ViewTransfer] Skipping steal to viewer — staying on Work Center", {
                    source,
                    pending,
                    delivered
                });
                return true;
            }

            // WHY: `force` bypasses same-view early-return so lifecycle `onShow` runs — fixes Work Center /
            // viewer not repainting after automatic ingress while already on that route path.
            await shell.navigate(resolved.destination, undefined, { force: true });
            console.log("[ViewTransfer] Routed through live shell:", resolved.routePath);
            return true;
        } catch (error) {
            console.warn("[ViewTransfer] Live shell routing failed, falling back to hard navigation:", error);
            return false;
        }
    };

    if (silentRoute) {
        if (currentPath !== destNorm) {
            console.log("[ViewTransfer] Silent mode: skipping navigation; delivery via channels only:", destNorm);
        } else {
            await tryNavigateLiveShell();
        }
        return delivered;
    }

    if (resolved.destination === "home" || sku === "launcher") {
        await tryNavigateLiveShell();
        return delivered;
    }

    if (currentPath !== destNorm) {
        const liveOk = await tryNavigateLiveShell();
        if (!liveOk) {
            const native = (() => {
                try {
                    const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
                    return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
                } catch {
                    return false;
                }
            })();
            /* INVARIANT: Capacitor SKUs have no `/viewer` path — hard-nav blanks the WebView. */
            if (native) {
                console.warn("[ViewTransfer] Skipping hard navigation on Capacitor:", destNorm);
                return delivered;
            }
            const nextUrl = new URL(globalThis?.location?.href);
            nextUrl.pathname = destPath;
            nextUrl.search = "";
            nextUrl.hash = "";
            if (pending) {
                nextUrl.searchParams.set("shared", "1");
            }
            console.log("[ViewTransfer] Navigating to resolved route:", nextUrl.toString());
            globalThis.location.href = nextUrl.toString();
        }
        return delivered;
    }

    await tryNavigateLiveShell();
    console.log("[ViewTransfer] Already on resolved route:", destNorm);
    return delivered;
};

/** Capacitor / sku-boot entry: stage files then run the same share pipeline as PWA. */
export const ingestSharePayload = async (
    shareData: ShareDataInput,
    source: "share-target" | "launch-queue" = "share-target"
): Promise<boolean> => {
    const capacitorNative = (() => {
        try {
            const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
            return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
        } catch {
            return false;
        }
    })();
    // WHY: Transfer APK ShareActivity + files-hub already staged/offered.
    // Stashing a viewer handoff opens a view this SKU does not mount.
    if (capacitorNative && inferCwspSkuFromLocation() === "transfer") {
        return true;
    }
    const files = Array.isArray(shareData.files)
        ? shareData.files.filter((f): f is File => f instanceof File)
        : [];
    try {
        await storeShareTargetPayloadToCache({
            files,
            meta: {
                title: shareData.title,
                text: shareData.text,
                url: shareData.url || shareData.sharedUrl,
                source,
                route: source,
                timestamp: shareData.timestamp || Date.now(),
                fileCount: files.length || shareData.fileCount,
                imageCount: shareData.imageCount,
                hint: shareData.hint
            }
        });
    } catch {
        /* cache optional */
    }
    try {
        await deliverShareTargetInput({
            ...shareData,
            files,
            source: shareData.source || source,
            fileCount: files.length || shareData.fileCount
        });
    } catch {
        /* Work Center command bus optional — SKU route still runs */
    }
    const file = files[0];
    try {
        const looksText =
            !!file &&
            (/^text\/|json|markdown|xml|javascript|typescript/i.test(String(file.type || "")) ||
                /\.(?:md|markdown|txt|json|html?|css|js|ts|tsx|yml|yaml|csv|log|xml)$/i.test(file.name));
        const content = looksText && file ? await file.text() : String(shareData.text || "");
        if (content.trim() || file?.name) {
            stashSkuHandoff({
                dest: inferCwspSkuFromLocation() === "process" ? "workcenter" : "viewer",
                content,
                filename: String(file?.name || shareData.title || ""),
                src: String(shareData.url || shareData.sharedUrl || "")
            });
        }
    } catch {
        /* sessionStorage optional */
    }
    return routeToTransferView(shareData, source, extractTransferHint(shareData), capacitorNative);
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

const shareProcessKey = (shareData: ShareDataInput): string =>
    [
        shareData.timestamp || 0,
        shareData.title || "",
        (shareData.text || "").slice(0, 64),
        shareData.url || shareData.sharedUrl || "",
        shareData.fileCount || shareData.files?.length || 0
    ].join("|");

const recentShareProcess = new Map<string, Promise<boolean>>();

const extractProcessApiText = (result: unknown): string => {
    if (!result || typeof result !== "object") return "";
    const row = result as Record<string, unknown>;
    if (row.success === false || row.ok === false) return "";
    const inner = row.result && typeof row.result === "object" ? (row.result as Record<string, unknown>) : null;
    const candidates = [row.data, inner?.data, inner?.text, inner?.content, row.result, row.text];
    for (const item of candidates) {
        const text = formatProcessIngressResult(item);
        if (text.trim()) return text;
    }
    return "";
};

const deliverProcessIngressResult = async (
    text: string,
    raw: unknown,
    copyToClipboard: boolean
): Promise<void> => {
    if (copyToClipboard && text.trim()) {
        const wrote = await writeProcessIngressClipboard(text);
        try {
            const clipboardChannel = new BroadcastChannel(CHANNELS.CLIPBOARD);
            clipboardChannel.postMessage({ type: "copy", data: text });
            clipboardChannel.close();
        } catch {
            /* bus optional */
        }
        if (wrote) showToast({ message: "Processed and copied", kind: "success" });
    }
    try {
        postWorkCenterCommand({
            type: "ingress.apply",
            payload: {
                type: "share-target-result",
                data: {
                    content: text,
                    rawData: raw,
                    timestamp: Date.now(),
                    source: "share-target"
                }
            }
        });
        await unifiedMessaging.sendMessage({
            type: "share-target-result",
            source: "share-target",
            destination: "workcenter",
            data: {
                content: text,
                rawData: raw,
                timestamp: Date.now(),
                source: "share-target",
                action: "Processing (/api/process/processing)"
            },
            metadata: { priority: "high" }
        } as any);
    } catch {
        postWorkCenterCommand({
            type: "ingress.apply",
            payload: {
                type: "share-target-result",
                data: { content: text, rawData: raw, timestamp: Date.now(), source: "share-target" }
            }
        });
    }
};

/**
 * Process share payloads on the page side when the service worker either did
 * not process them or only delivered metadata.
 * INVARIANT: one AI pass per payload. Attach-mode kinds return false here.
 */
export const processShareTargetData = async (shareData: ShareDataInput, skipIfEmpty = false): Promise<boolean> => {
    const key = shareProcessKey(shareData);
    const pending = recentShareProcess.get(key);
    if (pending) return pending;

    const job = runProcessShareTargetData(shareData, skipIfEmpty);
    recentShareProcess.set(key, job);
    try {
        return await job;
    } finally {
        globalThis.setTimeout(() => {
            if (recentShareProcess.get(key) === job) recentShareProcess.delete(key);
        }, 8000);
    }
};

const runProcessShareTargetData = async (shareData: ShareDataInput, skipIfEmpty = false): Promise<boolean> => {
    console.log("[ShareTarget] Processing shared data:", {
        hasText: !!shareData.text,
        hasUrl: !!shareData.url,
        fileCount: shareData.files?.length || shareData.fileCount || 0,
        imageCount: shareData.imageCount || 0,
        source: shareData.source || "unknown",
        aiProcessed: shareData.aiProcessed
    });

    if (shareData.aiProcessed && shareData.results?.length) {
        console.log("[ShareTarget] AI already processed in SW, showing result");
        showToast({ message: "Content processed by service worker", kind: "success" });
        return true;
    }

    const settings = await loadSettings().catch(() => null);
    rememberProcessIngressSettings(settings);
    const kind = classifyOpenKindFromPayload({
        files: Array.isArray(shareData.files) ? shareData.files.filter((f): f is File => f instanceof File) : [],
        text: shareData.text,
        url: shareData.url || shareData.sharedUrl,
        title: shareData.title,
        hint: shareData.hint
    });
    const ingress = resolveProcessIngressKind(settings, kind);
    if (ingress.mode !== "process") {
        console.log("[ShareTarget] Kind policy is attach — skip AI");
        return false;
    }
    await holdCapacitorIngressJob(settings);
    const customInstruction = instructionTextForIngress(settings, shareData.hint?.instructionId || ingress.instructionId);

    const { content, type } = extractShareContent(shareData);

    console.log("[ShareTarget] Extracted content:", { content: content?.substring(0, 50), type, kind: ingress.kind });

    if (!content && type !== "file") {
        if (skipIfEmpty) {
            console.log("[ShareTarget] No content to process (skipping)");
            return false;
        }

        if (shareData.fileCount && shareData.fileCount > 0) {
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

        const fileToBase64 = (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        };

        let processingContent: string;
        let contentType: string;

        if (type === "file" && shareData.files?.[0]) {
            const file = shareData.files[0] as File;
            console.log("[ShareTarget] Processing file:", { name: file.name, type: file.type, size: file.size });
            processingContent = await fileToBase64(file);
            contentType = "base64";
        } else if (content) {
            processingContent = content;
            contentType = "text";
            console.log("[ShareTarget] Processing text content, length:", content.length);
        } else {
            throw new Error("No processable content found");
        }

        const analyze = settings?.ai?.shareTargetMode === "analyze";
        console.log("[ShareTarget] Calling unified processing API");
        const posted = await postProcessApi(
            "processing",
            {
                content: processingContent,
                text: contentType === "text" ? processingContent : undefined,
                input: processingContent,
                url: type === "url" ? content : undefined,
                contentType,
                processingType: analyze ? "general-processing" : "recognize-content",
                mode: analyze ? "analyze" : "smartRecognize",
                customInstruction: customInstruction || undefined,
                metadata: {
                    source: "share-target",
                    title: shareData.title || "Shared Content",
                    timestamp: Date.now(),
                    kind: ingress.kind,
                    instructionId: ingress.instructionId || ""
                }
            },
            processApiAuthFromSettings(settings)
        );

        if (!posted.ok) {
            throw new Error(`Processing API failed: ${posted.status || posted.error || "network"}`);
        }

        const result = posted.json;
        const text = readProcessApiResultText(result) || extractProcessApiText(result);
        console.log("[ShareTarget] Unified processing completed:", { ok: result?.ok, success: result?.success });

        if (text) {
            shareData.aiProcessed = true;
            await deliverProcessIngressResult(text, result.data ?? result.result ?? result, ingress.copyToClipboard === true);
            return true;
        }

        const errorMsg = result?.error || "AI processing returned no data";
        console.warn("[ShareTarget] AI processing failed:", errorMsg);

        const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
        shareChannel.postMessage({
            type: "ai-result",
            data: { success: false, error: errorMsg }
        });
        shareChannel.close();

        showToast({ message: `Processing failed: ${errorMsg}`, kind: "warning" });
        return false;
    } catch (error: any) {
        console.error("[ShareTarget] Processing error:", error);

        console.log("[ShareTarget] Attempting server-side fallback");
        const fallbackResult = await tryServerSideProcessing(shareData, ingress.copyToClipboard === true);
        if (fallbackResult) {
            console.log("[ShareTarget] Server-side fallback succeeded");
            shareData.aiProcessed = true;
            return true;
        }

        console.warn("[ShareTarget] All processing methods failed");

        const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
        shareChannel.postMessage({
            type: "ai-result",
            data: { success: false, error: error?.message || String(error) }
        });
        shareChannel.close();

        showToast({ message: `Processing failed: ${error?.message || "Unknown error"}`, kind: "error" });
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

/**
 * Fallback to server-side AI processing when client-side fails
 * Broadcasts results to PWA clipboard handlers instead of copying directly
 */
const tryServerSideProcessing = async (shareData: ShareDataInput, copyToClipboard = true): Promise<boolean> => {
    try {
        const { content, type } = extractShareContent(shareData);
        if (!content) return false;

        console.log("[ShareTarget] Attempting server-side AI fallback");

        // Get API settings
        const { getRuntimeSettings } = await import("../../other/config/RuntimeSettings");
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
            const text = String(result.data);
            console.log("[ShareTarget] Broadcasting server-side result to clipboard handlers");
            await deliverProcessIngressResult(text, result.data, copyToClipboard);
            const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
            shareChannel.postMessage({
                type: "ai-result",
                data: { success: true, data: text }
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
    // WHY: Process PWA has no OS Share Target, but Launch Queue stages into this same
    // consumer (`?shared=1` / cache). Do not return early — only the manifest stays share-off.
    if (!allowProcessWebShareLaunch()) {
        console.log("[ShareTarget] Process PWA/Web OS share-target is off; launch-queue replay stays on");
    }
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
            source: "url-params",
            hint: params.get("filename") ? { filename: params.get("filename") || undefined } : undefined
        };
        const shareId = String(params.get("shareId") || "").trim();

        console.log("[ShareTarget] Share data from URL params:", summarizeForLog({
            title: shareFromParams.title,
            text: shareFromParams.text,
            url: shareFromParams.url,
            sharedUrl: shareFromParams.sharedUrl
        }));

        // Clean up URL
        const cleanUrl = new URL(globalThis?.location?.href);
        ["shared", "action", "title", "text", "url", "sharedUrl", "shareId", "filename", "sku"].forEach((p) =>
            cleanUrl.searchParams.delete(p)
        );
        globalThis?.history?.replaceState?.({}, "", cleanUrl.pathname + cleanUrl.hash);

        void (async () => {
            if (shareId) {
                try {
                    const res = await fetch(`/api/vds/share/${encodeURIComponent(shareId)}`);
                    if (res.ok) {
                        const row = (await res.json()) as {
                            title?: string;
                            text?: string;
                            url?: string;
                            files?: Array<{ name?: string; type?: string; data?: string }>;
                        };
                        const { dataUrlToFile } = await import("../channel/sku-ingress");
                        const files: File[] = [];
                        for (const item of row.files || []) {
                            if (!item?.data) continue;
                            const file = await dataUrlToFile(
                                item.data,
                                String(item.name || "shared.bin"),
                                String(item.type || "application/octet-stream")
                            );
                            if (file) files.push(file);
                        }
                        if (row.title && !shareFromParams.title) shareFromParams.title = row.title;
                        if (row.text && !shareFromParams.text) shareFromParams.text = row.text;
                        if (row.url && !shareFromParams.sharedUrl) shareFromParams.sharedUrl = row.url;
                        if (files.length) {
                            shareFromParams.files = files;
                            shareFromParams.fileCount = files.length;
                        }
                    }
                } catch (error) {
                    console.warn("[ShareTarget] VDS share stash missed:", error);
                }
            }
            const transferPayload = await mergeUrlParamsShareWithCache(shareFromParams);
            const { content, type } = extractShareContent(transferPayload);
            const pendingFiles = Number(transferPayload.fileCount ?? 0) > 0;
            console.log("[ShareTarget] After cache merge:", summarizeForLog({
                title: transferPayload.title,
                text: transferPayload.text,
                url: transferPayload.url,
                fileCount: transferPayload.fileCount,
                filesLen: transferPayload.files?.length
            }));
            console.log("[ShareTarget] Extracted (merged):", { content: content?.substring(0, 50), type });

            if (content || type === "file" || pendingFiles) {
                console.log("[ShareTarget] Routing merged share payload");
                try {
                    const delivered = await routeToTransferView(
                        transferPayload,
                        "share-target",
                        extractTransferHint(transferPayload),
                        true
                    );
                    if (!delivered) {
                        await processShareTargetData(transferPayload, true);
                    }
                } catch (error) {
                    console.warn("[ShareTarget] Route transfer failed, falling back to processing:", error);
                    await processShareTargetData(transferPayload, true);
                }
            } else {
                console.log("[ShareTarget] Nothing to route after merge");
            }
        })().catch((e) => console.warn("[ShareTarget] shared=1 async flow failed:", e));

        return;
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
            const unwrapped = unwrapSwInteropMessage(event.data);
            const msgType = unwrapped?.type || event.data?.type;
            const msgData = unwrapped?.data ?? event.data?.data;

            console.log("[ShareTarget] Broadcast received:", { type: msgType, hasData: !!msgData });

            if ((msgType === "share-received" || msgType === "share-target-input") && msgData) {
                console.log("[ShareTarget] Share notification received:", {
                    hasText: !!msgData.text,
                    hasUrl: !!msgData.url,
                    fileCount: msgData.fileCount || 0,
                    aiEnabled: msgData.aiEnabled,
                    source: msgData.source
                });

                let transferPayload: ShareDataInput = await awaitHydratedSharePayloadWithRetries(msgData);

                const hadInlineFiles =
                    Array.isArray(msgData.files) && msgData.files.some((f: unknown) => f instanceof File);
                if (
                    !hadInlineFiles &&
                    Array.isArray(transferPayload.files) &&
                    transferPayload.files.some((f) => f instanceof File)
                ) {
                    showToast({
                        message: `Received ${transferPayload.files!.filter((f) => f instanceof File).length || msgData.fileCount || 0} shared file(s)`,
                        kind: "info",
                    });
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
    if (!allowProcessWebLaunchQueue()) {
        console.log("[LaunchQueue] Process PWA/Web launch-queue is off");
        return;
    }
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
                            } catch (permError) {
                                console.warn('[LaunchQueue] Permission or access error for file handle:', permError, fileHandle);
                                failedHandles.push(fileHandle);
                            }
                        } else if (fileHandle instanceof File) {
                            // Already a File object
                            console.log('[LaunchQueue] File handle is already a File object:', fileHandle.name, fileHandle.type);
                            files.push(fileHandle);
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
                    // Single textual document → viewer first on hub; specialized SKUs keep their own sink.
                    const mdForBind = files.find((file) => isTextLikeFile(file)) || files[0];
                    const launchSku = inferCwspSkuFromLocation();
                    let hint: ViewTransferHint | undefined =
                        files.length === 1 && isTextLikeFile(files[0]) && (!launchSku || launchSku === "crx")
                            ? { destination: "viewer", action: "open", filename: files[0]?.name }
                            : { filename: files[0]?.name };

                    /**
                     * WHY: Launch Queue drops the parent folder. Same user-activation can still
                     * open showDirectoryPicker({ startIn: fileHandle }) so relative images resolve.
                     * Abort / missing API is fine — sidecar files + viewer Assets button remain.
                     */
                    const startHandle = $files.find(
                        (handle) => handle && typeof (handle as FileSystemFileHandle).getFile === "function"
                    ) as FileSystemFileHandle | undefined;
                    try {
                        const bound = await bindDirectoryForLaunchedFiles({
                            startIn: startHandle,
                            files,
                            filename: hint?.filename || mdForBind?.name
                        });
                        if (bound) {
                            hint = {
                                ...(hint || { destination: "viewer", action: "open", filename: mdForBind?.name }),
                                source: bound.virtualPath
                            };
                        }
                    } catch (error) {
                        console.warn("[LaunchQueue] Asset directory bind skipped:", error);
                    }
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
                            url.pathname = pathForSkuHostView("/share-target");
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
            const shareKey = new URL("/share-target-data", globalThis.location.origin).href;
            await cache?.put?.(shareKey, new Response(JSON.stringify({
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

let _ingressPwaPromise: Promise<void> | null = null;

/**
 * Single entry for page boot: SW registration, share-target URL/cache pipeline, clipboard receivers, launch queue.
 * Called from {@link BootLoader} so share-target is not dead code and runs after settings but before shell paint-heavy work.
 */
export const initIngressPWA = async (): Promise<void> => {
    if (_ingressPwaPromise) return _ingressPwaPromise;

    _ingressPwaPromise = (async () => {
        if (typeof globalThis === "undefined" || !(globalThis as { window?: unknown }).window) return;
        try {
            installShellImageOpenListener();
        } catch {
            /* home drop/paste hook optional */
        }
        if (!shouldRunPwaIngress()) return;
        try {
            /**
             * Always `immediate: false` here — dev + `immediate: true` caused `controllerchange` → `location.reload()`
             * mid-boot before shell/styles mounted (blank white screen).
             *
             * Dev still calls `activateWaitingWorker` inside `initServiceWorker` when a `waiting` worker exists so
             * Vite/asset routes update without forcing an early hard reload on every visitor.
             */
            await initServiceWorker({ immediate: false });
        } catch (error) {
            console.warn("[PWA] Service worker registration failed:", error);
        }
        try {
            initReceivers();
        } catch (error) {
            console.warn("[PWA] initReceivers failed:", error);
        }
        try {
            handleShareTarget();
        } catch (error) {
            console.warn("[PWA] handleShareTarget failed:", error);
        }
        void setupLaunchQueueConsumer().catch((error) =>
            console.warn("[PWA] setupLaunchQueueConsumer failed:", error)
        );
    })();

    return _ingressPwaPromise;
};