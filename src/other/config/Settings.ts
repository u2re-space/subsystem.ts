import { JSOX } from "jsox";

//
import type { AppSettings } from "com/config/SettingsTypes";
import { DEFAULT_SETTINGS } from "com/config/SettingsTypes";
import { writeFileSmart } from "fest/lure";

//
export const SETTINGS_KEY = "rs-settings";
/** localStorage mirror for Capacitor WebView when IndexedDB is flaky or empty. */
export const SETTINGS_LS_MIRROR_KEY = "rs-settings.v1";

export type LoadSettingsOptions = {
    /** When false, skip merging native ApplicationSettings overlay (use before save merge). */
    nativeOverlay?: boolean;
};

const trimSetting = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const isCapacitorNativeShell = (): boolean => {
    try {
        const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

const readLocalStorageSettingsMirror = (): unknown | null => {
    try {
        const raw = globalThis.localStorage?.getItem?.(SETTINGS_LS_MIRROR_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
};

const writeLocalStorageSettingsMirror = (value: unknown): boolean => {
    try {
        globalThis.localStorage?.setItem?.(SETTINGS_LS_MIRROR_KEY, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
};

/** Only apply native fields that carry a non-empty value — empty bridge rows must not wipe IDB. */
const mergeNativeSettingsOverlay = (
    base: AppSettings,
    native: Partial<AppSettings> | null | undefined
): AppSettings => {
    if (!native || typeof native !== "object") return base;
    const patch: Partial<AppSettings> = {};
    const corePatch: NonNullable<Partial<AppSettings>["core"]> = {};
    let touched = false;

    const ep = trimSetting(native.core?.endpointUrl);
    if (ep) {
        corePatch.endpointUrl = ep;
        touched = true;
    }
    const userId = trimSetting(native.core?.userId);
    if (userId) {
        corePatch.userId = userId;
        touched = true;
    }
    const userKey = trimSetting(native.core?.userKey);
    if (userKey) {
        corePatch.userKey = userKey;
        touched = true;
    }
    const appClientId = trimSetting(native.core?.appClientId);
    if (appClientId) {
        corePatch.appClientId = appClientId;
        touched = true;
    }

    const socketPatch: NonNullable<Partial<AppSettings>["core"]>["socket"] = {};
    let socketTouched = false;
    const routeTarget = trimSetting(native.core?.socket?.routeTarget);
    if (routeTarget) {
        socketPatch.routeTarget = routeTarget;
        socketTouched = true;
    }
    const accessToken = trimSetting(native.core?.socket?.accessToken);
    if (accessToken) {
        socketPatch.accessToken = accessToken;
        socketTouched = true;
    }
    const clientAccessToken = trimSetting(native.core?.socket?.clientAccessToken);
    if (clientAccessToken) {
        socketPatch.clientAccessToken = clientAccessToken;
        socketTouched = true;
    }
    if (socketTouched) {
        corePatch.socket = socketPatch;
        touched = true;
    }

    const shellPatch: Partial<NonNullable<AppSettings["shell"]>> = {};
    let shellTouched = false;
    const shareDest = trimSetting(native.shell?.clipboardShareDestinationIds);
    if (shareDest) {
        shellPatch.clipboardShareDestinationIds = shareDest;
        shellTouched = true;
    }
    const inboundAllow = trimSetting(native.shell?.clipboardInboundAllowIds);
    if (inboundAllow) {
        shellPatch.clipboardInboundAllowIds = inboundAllow;
        shellTouched = true;
    }
    if (shellTouched) {
        patch.shell = shellPatch;
        touched = true;
    }

    if (!touched) return base;
    patch.core = corePatch;
    return mergeAppSettingsShape(base, patch);
};

//
export const splitPath = (path: string) => path.split(".");
export const getByPath = (source: any, path: string) => splitPath(path).reduce<any>((acc, key) => (acc == null ? acc : acc[key]), source);
export const slugify = (value: string) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

//
export const DB_NAME = 'req-store';
export const STORE = 'settings';

type WebDavCreateClient = (remoteURL: string, options?: Record<string, unknown>) => any;
let createWebDavClient: WebDavCreateClient | null = null;

const mergeAppSettingsShape = (base: AppSettings, patch: Partial<AppSettings> | null | undefined): AppSettings => {
    if (!patch || typeof patch !== "object") return base;
    return {
        ...base,
        ...patch,
        core: {
            ...(base.core || {}),
            ...(patch.core || {}),
            network: {
                ...(base.core?.network || {}),
                ...(patch.core?.network || {})
            },
            socket: {
                ...(base.core?.socket || {}),
                ...(patch.core?.socket || {})
            },
            interop: {
                ...(base.core?.interop || {}),
                ...(patch.core?.interop || {})
            },
            ops: {
                ...(base.core?.ops || {}),
                ...(patch.core?.ops || {})
            },
            admin: {
                ...(base.core?.admin || {}),
                ...(patch.core?.admin || {})
            }
        },
        ai: {
            ...(base.ai || {}),
            ...(patch.ai || {}),
            mcp: patch.ai?.mcp ?? base.ai?.mcp ?? [],
            customInstructions: patch.ai?.customInstructions ?? base.ai?.customInstructions ?? [],
            activeInstructionId: patch.ai?.activeInstructionId ?? base.ai?.activeInstructionId ?? ""
        },
        webdav: {
            ...(base.webdav || {}),
            ...(patch.webdav || {})
        },
        timeline: {
            ...(base.timeline || {}),
            ...(patch.timeline || {})
        },
        appearance: {
            ...(base.appearance || {}),
            ...(patch.appearance || {}),
            markdown: {
                ...(base.appearance?.markdown || {}),
                ...(patch.appearance?.markdown || {}),
                page: {
                    ...(base.appearance?.markdown?.page || {}),
                    ...(patch.appearance?.markdown?.page || {})
                },
                modules: {
                    ...(base.appearance?.markdown?.modules || {}),
                    ...(patch.appearance?.markdown?.modules || {})
                },
                plugins: {
                    ...(base.appearance?.markdown?.plugins || {}),
                    ...(patch.appearance?.markdown?.plugins || {})
                }
            }
        },
        speech: {
            ...(base.speech || {}),
            ...(patch.speech || {})
        },
        grid: {
            ...(base.grid || {}),
            ...(patch.grid || {})
        },
        shell: {
            ...(base.shell || {}),
            ...(patch.shell || {})
        }
    };
};

const getWebDavCreateClient = async (): Promise<WebDavCreateClient | null> => {
    if (createWebDavClient != null) return createWebDavClient;
    /*try {
        const mod = await import("webdav/web")?.catch?.((e) => { console.warn(e); return null; });
        console.log("[Settings] getWebDavCreateClient - mod:", mod);
        if (mod != null && typeof mod?.createClient === "function") {
            createWebDavClient = mod.createClient as WebDavCreateClient;
            return createWebDavClient;
        }
    } catch {
        // WebDAV is optional and not required in service-worker-only flows.
    }*/
    return null;
};

// Check if we're in a content script context (restricted storage access)
// Content scripts are extension scripts injected into third-party pages
// They have chrome.runtime but run on http/https pages (not chrome-extension://)
const isContentScriptContext = (): boolean => {
    try {
        // Must have chrome.runtime to be a content script (extensions only)
        // Regular PWA/web apps don't have chrome.runtime
        if (typeof chrome === "undefined" || !chrome?.runtime) return false;

        // Content scripts run on http/https pages but have chrome.runtime
        // Extension pages run on chrome-extension:// protocol
        if (typeof window !== "undefined" && globalThis?.location?.protocol?.startsWith("http")) {
            // This is a content script - extension code running on a web page
            return true;
        }

        return false;
    } catch {
        return false; // If we can't determine, assume NOT a content script (allow access)
    }
};

//
const hasChromeStorage = () => typeof chrome !== "undefined" && chrome?.storage?.local;

//
async function idbOpen(): Promise<IDBDatabase> {
    // Check if indexedDB is available and accessible
    if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB not available");
    }

    // In content scripts on some pages, indexedDB access throws DOMException
    if (isContentScriptContext()) {
        throw new Error("IndexedDB not accessible in content script context");
    }

    return new Promise<IDBDatabase>((res, rej) => {
        try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        } catch (e) {
            rej(e);
        }
    });
}

//
export const idbGetSettings = async (key: string = SETTINGS_KEY): Promise<any> => {
    try {
        if (hasChromeStorage()) {
            console.log("[Settings] Using chrome.storage.local for get");
            const chromeValue = await new Promise<any>((res) => {
                try {
                    chrome.storage.local.get([key], (result) => {
                        if (chrome.runtime.lastError) {
                            console.warn("[Settings] chrome.storage.local.get error:", chrome.runtime.lastError);
                            res(null);
                        } else {
                            console.log("[Settings] chrome.storage.local.get success, has data:", !!result[key]);
                            res(result[key]);
                        }
                    });
                } catch (e) {
                    console.warn("[Settings] chrome.storage access failed:", e);
                    res(null);
                }
            });
            if (chromeValue != null) return chromeValue;
        }

        if (typeof indexedDB !== "undefined") {
            console.log("[Settings] Using IndexedDB for get");
            const db = await idbOpen();
            const idbValue = await new Promise<any>((res, rej) => {
                const tx = db.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => {
                    console.log("[Settings] IndexedDB get success, has data:", !!req.result?.value);
                    res(req.result?.value);
                    db.close();
                };
                req.onerror = () => {
                    console.warn("[Settings] IndexedDB get error:", req.error);
                    rej(req.error);
                    db.close();
                };
            });
            if (idbValue != null) return idbValue;
        } else {
            console.warn("[Settings] IndexedDB not available");
        }
    } catch (e) {
        console.warn("[Settings] Settings storage access failed:", e);
    }

    const mirror = readLocalStorageSettingsMirror();
    if (mirror != null) {
        console.log("[Settings] Using localStorage mirror fallback for get");
        return mirror;
    }
    return null;
}

//
export const idbPutSettings = async (value: any, key: string = SETTINGS_KEY): Promise<void> => {
    let idbOk = false;
    let lsOk = false;

    if (hasChromeStorage()) {
        await new Promise<void>((res, rej) => {
            try {
                chrome.storage.local.set({ [key]: value }, () => {
                    if (chrome.runtime.lastError) {
                        rej(chrome.runtime.lastError);
                    } else {
                        res();
                    }
                });
            } catch (e) {
                rej(e);
            }
        });
        return;
    }

    lsOk = writeLocalStorageSettingsMirror(value);

    try {
        if (typeof indexedDB === "undefined") {
            if (!lsOk && isCapacitorNativeShell()) {
                throw new Error("Settings storage unavailable (no IndexedDB or localStorage)");
            }
            return;
        }

        const db = await idbOpen();
        await new Promise<void>((res, rej) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ key, value });
            tx.oncomplete = () => { idbOk = true; res(); db.close(); };
            tx.onerror = () => { rej(tx.error); db.close(); };
        });
    } catch (e) {
        console.warn("[Settings] IndexedDB write failed:", e);
        if (!lsOk && isCapacitorNativeShell()) {
            throw new Error("Settings could not be saved (IndexedDB and localStorage failed)");
        }
    }

    if (!idbOk && lsOk) {
        console.log("[Settings] persisted to localStorage mirror (IndexedDB skipped or failed)");
    }
}

/** Normalize `core.endpointUrl` for equality checks (scheme + host + port, lowercase). */
export const normalizeCoreEndpointOrigin = (raw: string): string => {
    const t = (raw || "").trim();
    if (!t) return "";
    try {
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
        const u = new URL(withScheme);
        return `${u.protocol}//${u.host}`.toLowerCase();
    } catch {
        return t.toLowerCase();
    }
};

/**
 * True when persisted settings explicitly contain `shell.maintainHubSocketConnection`
 * (Shell section was saved with that field — distinct from merge-time defaults).
 */
export const didPersistShellMaintainHubSocket = async (): Promise<boolean> => {
    try {
        const raw = await idbGetSettings();
        const stored = typeof raw === "string" ? JSOX.parse(raw) as any : raw;
        if (!stored || typeof stored !== "object") return false;
        const shell = (stored as any).shell;
        return (
            typeof shell === "object" &&
            shell !== null &&
            Object.prototype.hasOwnProperty.call(shell, "maintainHubSocketConnection")
        );
    } catch {
        return false;
    }
};

const isChromeExtensionRuntime = (): boolean => {
    try {
        const id = (globalThis as unknown as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
        return typeof id === "string" && id.length > 0;
    } catch {
        return false;
    }
};

/**
 * MV3 Chrome extension: skip hub WebSocket bootstrap until the user saves Settings or points
 * {@link AppSettings.core.endpointUrl} away from the bundled dev default. Avoids console spam and
 * useless probes when cwsp is not running on localhost.
 */
export const shouldDeferCrxHubSocketBootstrap = async (settings: AppSettings): Promise<boolean> => {
    if (!isChromeExtensionRuntime()) return false;
    if (await didPersistShellMaintainHubSocket()) return false;
    const defaultEp = normalizeCoreEndpointOrigin(DEFAULT_SETTINGS.core?.endpointUrl || "");
    const currentEp = normalizeCoreEndpointOrigin(settings.core?.endpointUrl || "");
    return Boolean(defaultEp) && currentEp === defaultEp;
};

//
export const loadSettings = async (opts?: LoadSettingsOptions): Promise<AppSettings> => {
    try {
        let raw = await idbGetSettings();
        if (raw == null) {
            raw = readLocalStorageSettingsMirror();
        }
        const stored = typeof raw === "string" ? JSOX.parse(raw) as any : raw;

        console.log("[Settings] loadSettings - raw type:", typeof raw, "stored type:", typeof stored);

        if (stored && typeof stored === "object") {
            let result = {
                core: {
                    ...DEFAULT_SETTINGS.core,
                    ...(stored as any)?.core,
                    network: {
                        ...(DEFAULT_SETTINGS.core?.network || {}),
                        ...((stored as any)?.core?.network || {})
                    },
                    socket: {
                        ...(DEFAULT_SETTINGS.core?.socket || {}),
                        ...((stored as any)?.core?.socket || {})
                    },
                    interop: {
                        ...(DEFAULT_SETTINGS.core?.interop || {}),
                        ...((stored as any)?.core?.interop || {})
                    },
                    ops: {
                        ...(DEFAULT_SETTINGS.core?.ops || {}),
                        ...((stored as any)?.core?.ops || {})
                    },
                    admin: {
                        ...(DEFAULT_SETTINGS.core?.admin || {}),
                        ...((stored as any)?.core?.admin || {})
                    }
                },
                ai: {
                    ...DEFAULT_SETTINGS.ai, ...(stored as any)?.ai,
                    mcp: (stored as any)?.ai?.mcp || [],
                    customInstructions: (stored as any)?.ai?.customInstructions || [],
                    activeInstructionId: (stored as any)?.ai?.activeInstructionId || ""
                },
                webdav: { ...DEFAULT_SETTINGS.webdav, ...(stored as any)?.webdav },
                timeline: { ...DEFAULT_SETTINGS.timeline, ...(stored as any)?.timeline },
                appearance: {
                    ...DEFAULT_SETTINGS.appearance,
                    ...(stored as any)?.appearance,
                    markdown: {
                        ...(DEFAULT_SETTINGS.appearance?.markdown || {}),
                        ...((stored as any)?.appearance?.markdown || {}),
                        page: {
                            ...(DEFAULT_SETTINGS.appearance?.markdown?.page || {}),
                            ...((stored as any)?.appearance?.markdown?.page || {})
                        },
                        modules: {
                            ...(DEFAULT_SETTINGS.appearance?.markdown?.modules || {}),
                            ...((stored as any)?.appearance?.markdown?.modules || {})
                        },
                        plugins: {
                            ...(DEFAULT_SETTINGS.appearance?.markdown?.plugins || {}),
                            ...((stored as any)?.appearance?.markdown?.plugins || {})
                        }
                    }
                },
                speech: { ...DEFAULT_SETTINGS.speech, ...(stored as any)?.speech },
                grid: { ...DEFAULT_SETTINGS.grid, ...(stored as any)?.grid },
                shell: {
                    ...(DEFAULT_SETTINGS.shell || {}),
                    ...((stored as any)?.shell || {})
                }
            };

            // CWSAndroid bridge may expose canonical native settings projection.
            // WHY: On Capacitor WebView, IDB/localStorage is the Settings UI source of truth;
            // native prefs are a downstream sink — overlaying stale native values wipes saved fields.
            try {
                if (opts?.nativeOverlay !== false && !isCapacitorNativeShell()) {
                    const { getNativeUnifiedSettings, isCwsNativeIpcAvailable } = await import("../../routing/native/cws-bridge");
                    if (isCwsNativeIpcAvailable()) {
                        const nativeSettings = await getNativeUnifiedSettings();
                        if (nativeSettings && typeof nativeSettings === "object") {
                            result = mergeNativeSettingsOverlay(
                                result as AppSettings,
                                nativeSettings as Partial<AppSettings>
                            );
                        }
                    }
                }
            } catch {
                // bridge optional in web / extension contexts
            }

            console.log("[Settings] loadSettings result:", {
                hasApiKey: !!result.ai?.apiKey,
                instructionCount: result.ai?.customInstructions?.length || 0,
                activeInstructionId: result.ai?.activeInstructionId || "(none)"
            });

            return result as AppSettings;
        }

        console.log("[Settings] loadSettings - no stored data, returning defaults");
    } catch (e) {
        console.warn("[Settings] loadSettings error:", e);
    }
    return JSOX.parse(JSOX.stringify(DEFAULT_SETTINGS as any) as string) as unknown as AppSettings;
};

//
export const saveSettings = async (settings: AppSettings) => {
    const current = await loadSettings({ nativeOverlay: false });

    // For arrays and special fields, prefer explicit values from settings,
    // then fall back to current, then to defaults.
    // Use explicit undefined check (not nullish coalescing) to preserve empty arrays/strings
    const getMcp = () => {
        if (settings.ai?.mcp !== undefined) return settings.ai.mcp;
        if (current.ai?.mcp !== undefined) return current.ai.mcp;
        return [];
    };

    const getCustomInstructions = () => {
        if (settings.ai?.customInstructions !== undefined) return settings.ai.customInstructions;
        if (current.ai?.customInstructions !== undefined) return current.ai.customInstructions;
        return [];
    };

    const getActiveInstructionId = () => {
        // Check if activeInstructionId is explicitly set (including empty string)
        if (Object.prototype.hasOwnProperty.call(settings.ai || {}, 'activeInstructionId')) {
            return settings.ai?.activeInstructionId ?? "";
        }
        // Fall back to current value
        if (current.ai?.activeInstructionId !== undefined) {
            return current.ai.activeInstructionId;
        }
        return "";
    };

    const merged: AppSettings = {
        core: {
            ...(DEFAULT_SETTINGS.core || {}),
            ...(current.core || {}),
            ...(settings.core || {}),
            network: {
                ...(DEFAULT_SETTINGS.core?.network || {}),
                ...(current.core?.network || {}),
                ...(settings.core?.network || {})
            },
            socket: {
                ...(DEFAULT_SETTINGS.core?.socket || {}),
                ...(current.core?.socket || {}),
                ...(settings.core?.socket || {})
            },
            interop: {
                ...(DEFAULT_SETTINGS.core?.interop || {}),
                ...(current.core?.interop || {}),
                ...(settings.core?.interop || {})
            },
            ops: {
                ...(DEFAULT_SETTINGS.core?.ops || {}),
                ...(current.core?.ops || {}),
                ...(settings.core?.ops || {})
            },
            admin: {
                ...(DEFAULT_SETTINGS.core?.admin || {}),
                ...(current.core?.admin || {}),
                ...(settings.core?.admin || {})
            }
        },
        ai: {
            ...(DEFAULT_SETTINGS.ai || {}),
            ...(current.ai || {}),
            ...(settings.ai || {}),
            mcp: getMcp(),
            customInstructions: getCustomInstructions(),
            activeInstructionId: getActiveInstructionId()
        },
        webdav: {
            ...(DEFAULT_SETTINGS.webdav || {}),
            ...(current.webdav || {}),
            ...(settings.webdav || {})
        },
        timeline: {
            ...(DEFAULT_SETTINGS.timeline || {}),
            ...(current.timeline || {}),
            ...(settings.timeline || {})
        },
        appearance: {
            ...(DEFAULT_SETTINGS.appearance || {}),
            ...(current.appearance || {}),
            ...(settings.appearance || {}),
            markdown: {
                ...(DEFAULT_SETTINGS.appearance?.markdown || {}),
                ...(current.appearance?.markdown || {}),
                ...(settings.appearance?.markdown || {}),
                page: {
                    ...(DEFAULT_SETTINGS.appearance?.markdown?.page || {}),
                    ...(current.appearance?.markdown?.page || {}),
                    ...(settings.appearance?.markdown?.page || {})
                },
                modules: {
                    ...(DEFAULT_SETTINGS.appearance?.markdown?.modules || {}),
                    ...(current.appearance?.markdown?.modules || {}),
                    ...(settings.appearance?.markdown?.modules || {})
                },
                plugins: {
                    ...(DEFAULT_SETTINGS.appearance?.markdown?.plugins || {}),
                    ...(current.appearance?.markdown?.plugins || {}),
                    ...(settings.appearance?.markdown?.plugins || {})
                }
            }
        },
        speech: {
            ...(DEFAULT_SETTINGS.speech || {}),
            ...(current.speech || {}),
            ...(settings.speech || {})
        },
        grid: {
            ...(DEFAULT_SETTINGS.grid || {}),
            ...(current.grid || {}),
            ...(settings.grid || {})
        },
        shell: {
            ...(DEFAULT_SETTINGS.shell || {}),
            ...(current.shell || {}),
            ...(settings.shell || {})
        }
    };
    await idbPutSettings(merged);
    try {
        const { initCwsNativeBridge, patchNativeUnifiedSettings, isCwsNativeIpcAvailable } = await import("../../routing/native/cws-bridge");
        if (isCwsNativeIpcAvailable()) {
            await initCwsNativeBridge().catch(() => null);
            const patched = await patchNativeUnifiedSettings(merged as unknown as Record<string, unknown>);
            if (!patched) {
                console.warn("[Settings] native settings patch did not confirm ok");
            }
        }
    } catch (e) {
        console.warn("[Settings] native settings patch failed:", e);
    }
    try {
        const { applyAirpadRuntimeFromAppSettings, syncAirpadRemoteConfigFromAppSettings } = await import("views/airpad/config/config");
        applyAirpadRuntimeFromAppSettings(merged);
        syncAirpadRemoteConfigFromAppSettings(merged, { persist: true });
    } catch (e) {
        console.warn("[Settings] AirPad runtime sync failed:", e);
    }
    updateWebDavSettings(merged)?.catch?.(console.warn.bind(console));
    return merged;
};

// Утилита для склейки путей без дублей слэшей
const joinPath = (base: string, name?: string, addTrailingSlash = false) => {
    const b = (base || "/").replace(/\/+$/g, "") || "/";
    const n = (name || "").replace(/^\/+/g, "");
    let out = b === "/" ? `/${n}` : `${b}/${n}`;
    if (addTrailingSlash) out = out.replace(/\/?$/g, "/");
    return out.replace(/\/{2,}/g, "/");
};

const isDirHandle = (h: any) => (h?.kind === 'directory');
const safeTime = (v: any) => {
    const t = new Date(v as any).getTime();
    return Number.isFinite(t) ? t : 0;
};

type SyncOptions = {
    // Для download: удалять локальные записи, которых нет на сервере
    pruneLocal?: boolean;
    // Для upload: удалять записи на сервере, которых нет локально
    pruneRemote?: boolean;
};

/** Lazy `fest/lure` — keeps content scripts / lightweight callers from pulling lure + UI CSS. */
let lureFsPromise: Promise<{ getDirectoryHandle: typeof import("fest/lure").getDirectoryHandle; readFile: typeof import("fest/lure").readFile }> | null = null;
const loadLureFs = () => {
    if (!lureFsPromise) {
        lureFsPromise = import("fest/lure").then((m) => ({
            getDirectoryHandle: m.getDirectoryHandle,
            readFile: m.readFile,
        }));
    }
    return lureFsPromise;
};

// DOWNLOAD: не прибавляем path к filename — берём filename как есть
const downloadContentsToOPFS = async (
    webDavClient,
    path = "/",
    opts: SyncOptions = {},
    rootHandle: FileSystemDirectoryHandle | null = null
) => {
    const { getDirectoryHandle, readFile } = await loadLureFs();
    const files = await webDavClient
        ?.getDirectoryContents?.(path || "/")
        ?.catch?.((e) => { console.warn(e); return []; }) as any;

    // Если включено — удаляем локальные элементы, которых нет на сервере
    if (opts.pruneLocal && files?.length > 0) {
        try {
            const dirHandle = await getDirectoryHandle(rootHandle, path)?.catch?.(() => null);
            if (dirHandle?.entries) {
                const localEntries = await Array.fromAsync(dirHandle.entries());
                const remoteNames = new Set(files?.map?.((f) => f?.basename).filter(Boolean));
                await Promise.all(
                    (localEntries as [string, FileSystemDirectoryHandle | FileSystemFileHandle][])
                        .filter(([name]) => !remoteNames.has(name))
                        .map(([name]) =>
                            dirHandle.removeEntry(name, { recursive: true })?.catch?.(console.warn.bind(console))
                        )
                );
            }
        } catch (e) {
            console.warn(e);
        }
    }

    return Promise.all(
        files.map(async (file) => {
            const isDir = file?.type === "directory";
            // ВАЖНО: filename уже абсолютный путь на сервере относительно base-URL клиента
            const fullPath = isDir ? joinPath(file.filename, "", true) : file.filename;

            if (isDir) {
                return downloadContentsToOPFS(webDavClient, fullPath, opts, rootHandle);
            }

            if (file?.type === "file") {
                const localMeta = await readFile(rootHandle, fullPath).catch(() => null);
                const localMtime = safeTime(localMeta?.lastModified);
                const remoteMtime = safeTime(file?.lastmod);

                if (remoteMtime > localMtime) {
                    const contents = await webDavClient
                        .getFileContents(fullPath)
                        .catch((e) => { console.warn(e); return null; });

                    if (!contents || contents.byteLength === 0) return;

                    // mime может отсутствовать — ставим разумный дефолт
                    const mime = (file as any)?.mime || "application/octet-stream";
                    return writeFileSmart(rootHandle, fullPath, new File([contents], file.basename, { type: mime }));
                }
            }
        })
    );
};

// UPLOAD: аккуратно собираем пути; сравниваем даты безопасно
const uploadOPFSToWebDav = async (
    webDavClient,
    dirHandle: FileSystemDirectoryHandle | null = null,
    path = "/",
    opts: SyncOptions = {}
) => {
    const { getDirectoryHandle } = await loadLureFs();
    const effectiveDirHandle = dirHandle ?? (await getDirectoryHandle(null, path, { create: true })?.catch?.(console.warn.bind(console)));
    const entries = await Array.fromAsync(effectiveDirHandle?.entries?.() ?? []);

    //
    if (path != "/") {
        // Небольшая правка: гарантированно получаем entries из handle
        // Если включено — удаляем на сервере всё, чего нет локально в текущем каталоге
        if (opts.pruneRemote && entries?.length >= 0) {
            const remoteItems = await webDavClient
                .getDirectoryContents(path || '/')
                .catch((e) => { console.warn(e); return []; }) as FileStat[];

            // Локальные имена (в текущем каталоге)
            const localSet = new Set(
                (entries as [string, FileSystemDirectoryHandle | FileSystemFileHandle][])
                    .map(([name]) => name.toLowerCase())
            );

            // Удаляем только то, чего точно нет локально по ИМЕНИ (без includes)
            const extra = remoteItems.filter((r) => {
                const base = (r?.basename || '').toLowerCase();
                return base && !localSet.has(base);
            });

            // Файлы сначала, директории потом
            const filesFirst = [
                ...extra.filter((x) => x.type !== 'directory'),
                //...extra.filter((x) => x.type === 'directory'),
            ];

            for (const r of filesFirst) {
                const remotePath = r.filename || joinPath(path, r.basename, r.type === 'directory');
                try {
                    await webDavClient.deleteFile(remotePath);
                } catch (e) {
                    console.warn('delete failed:', remotePath, e);
                }
            }
        }
    }

    //
    await Promise.all(
        (entries as [string, FileSystemDirectoryHandle | FileSystemFileHandle][])
            .map(async ([name, fileOrDir]) => {
                const isDir = isDirHandle(fileOrDir);
                const remotePath = joinPath(path, name, isDir);

                if (isDir) {
                    const dirPathNoSlash = joinPath(path, name, false);
                    const exists = await webDavClient.exists(dirPathNoSlash).catch((_e) => { return false; });
                    if (!exists) {
                        await webDavClient.createDirectory(dirPathNoSlash, { recursive: true }).catch(console.warn);
                    }
                    return uploadOPFSToWebDav(webDavClient, fileOrDir as FileSystemDirectoryHandle, remotePath, opts);
                }

                // File
                const fileHandle = fileOrDir as FileSystemFileHandle;
                const fileContent = await fileHandle.getFile();
                if (!fileContent || fileContent.size === 0) return;

                //
                const fullFilePath = joinPath(path, name, false);
                const remoteStat = await webDavClient.stat(fullFilePath).catch(() => null);
                const remoteMtime = safeTime(remoteStat?.lastmod);
                const localMtime = safeTime(fileContent.lastModified);

                //
                if (!remoteStat || localMtime > remoteMtime) {
                    await webDavClient.putFileContents(fullFilePath, await fileContent.arrayBuffer(), { overwrite: true })
                        .catch((_e) => { return null; });
                }
            })
    );

};

//
const getHostOnly = (address: string) => {
    const url = new URL(address);
    return url.protocol + url.hostname + ":" + url.port;
}

//
export const WebDavSync = async (address: string, options: any = {}) => {
    console.log("[Settings] WebDavSync", address, options); if (!address) return null;
    const createClient = await getWebDavCreateClient();
    if (!createClient) return null;
    const client = createClient(getHostOnly(address), options);
    const status = currentWebDav?.sync?.getDAVCompliance?.()?.catch?.(console.warn.bind(console)) ?? null;
    return {
        status,
        client,
        upload(withPrune = false) { if (this.status != null) { return uploadOPFSToWebDav(client, null, "/", { pruneRemote: withPrune })?.catch?.((e) => { console.warn(e); return []; }) } },
        download(withPrune = false) { if (this.status != null) { return downloadContentsToOPFS(client, "/", { pruneLocal: withPrune })?.catch?.((e) => { console.warn(e); return []; }) } },
    }
}

//
export const currentWebDav: { sync: any } = { sync: null };

// Only initialize WebDAV in extension contexts (not content scripts)
if (!isContentScriptContext()) {
    (async () => {
        try {
            const settings = await loadSettings();
            if (settings?.core?.mode === "endpoint" && settings?.core?.preferBackendSync) {
                return;
            }
            if (!settings?.webdav?.url) return;
            const client = await WebDavSync(settings.webdav.url, {
                //authType: AuthType.Digest,
                withCredentials: true,
                username: settings.webdav.username,
                password: settings.webdav.password,
                token: settings.webdav.token
            });
            currentWebDav.sync = client ?? currentWebDav.sync;
            await currentWebDav?.sync?.upload?.(true);
            await currentWebDav?.sync?.download?.(true);
        } catch (e) {
            // Silently fail - storage may not be available in all contexts
        }
    })();
}

//
export const updateWebDavSettings = async (settings: any) => {
    settings ||= await loadSettings();
    if (settings?.core?.mode === "endpoint" && settings?.core?.preferBackendSync) {
        currentWebDav.sync = null;
        return;
    }
    if (!settings?.webdav?.url) return;
    currentWebDav.sync = await WebDavSync(settings.webdav.url, {
        //authType: AuthType.Digest,
        withCredentials: true,
        username: settings.webdav.username,
        password: settings.webdav.password,
        token: settings.webdav.token
    }) ?? currentWebDav.sync;
    await currentWebDav?.sync?.upload?.();
    await currentWebDav?.sync?.download?.(true);
}

// WebDAV sync on page lifecycle events (only in extension context, not content scripts)
if (!isContentScriptContext()) {
    try {
        if (typeof window !== "undefined" && typeof addEventListener === "function") {
            addEventListener("pagehide", () => {
                currentWebDav?.sync?.upload?.()?.catch?.(() => {});
            });
            addEventListener("beforeunload", () => {
                currentWebDav?.sync?.upload?.()?.catch?.(() => {});
            });
        }
    } catch {
        // Ignore - may not be in appropriate context
    }

    // Periodic WebDAV sync (only when sync is configured)
    (async () => {
        try {
            while (true) {
                await currentWebDav?.sync?.upload?.()?.catch?.(() => {});
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        } catch {
            // Silently fail
        }
    })();
}

//
export default WebDavSync;
