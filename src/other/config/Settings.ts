/*
 * Filename: Settings.ts
 * FullPath: modules/projects/subsystem/src/other/config/Settings.ts
 * Change date and time: 14.55.00_19.07.2026
 * Reason for changes: Static cws-bridge/airpad imports — MV3 SW forbids import().
 */
import { JSOX } from "jsox";

//
import type { AppSettings } from "com/config/SettingsTypes";
import { DEFAULT_SETTINGS, normalizeEcosystemToken } from "com/config/SettingsTypes";
import { writeFileSmart } from "fest/lure";
import { migrateLegacyCwspPublicPort } from "cwsp-shared/cwsp-endpoint-resolve";
import {
    isAssociableFleetWireNodeId,
    normalizeWireNodeIdForWire,
    sanitizeFleetSelfWireNodeId
} from "cwsp-shared/airpad-cwsp-client-parity";
import {
    getNativeUnifiedSettings,
    initCwsNativeBridge,
    isCwsNativeIpcAvailable,
    patchNativeUnifiedSettingsDetailed
} from "../../routing/native/cws-bridge";
import {
    applyAirpadRuntimeFromAppSettings,
    syncAirpadRemoteConfigFromAppSettings
} from "views/airpad/config/config";

//
export const SETTINGS_KEY = "rs-settings";
/** localStorage mirror for Capacitor WebView when IndexedDB is flaky or empty. */
export const SETTINGS_LS_MIRROR_KEY = "rs-settings.v1";

export type LoadSettingsOptions = {
    /** When false, skip merging native ApplicationSettings overlay (use before save merge). */
    nativeOverlay?: boolean;
};

export type SettingsSaveReport = {
    /** null when not a native shell (no bridge expected). */
    nativeSynced: boolean | null;
    nativeError?: string;
    /** Neutralino/WebNative Node `/service/config` (+ clipboard-hub) sync. */
    webnativeSynced?: boolean | null;
    webnativeError?: string;
};

let lastSettingsSaveReport: SettingsSaveReport = { nativeSynced: null };

export const getLastSettingsSaveReport = (): SettingsSaveReport => ({ ...lastSettingsSaveReport });

const trimSetting = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Factory defaults — not treated as user-configured Client-ID on Capacitor. */
const CAPACITOR_FACTORY_SELF_IDS = new Set(["L-196", "L-208", "L-210"]);

const isCapacitorFactorySelfId = (id: string): boolean => {
    if (!id) return true;
    const shortId = sanitizeFleetSelfWireNodeId(id) || id;
    return CAPACITOR_FACTORY_SELF_IDS.has(shortId);
};

/** Home fleet Client-ID — accepts short {@code L-196} via normalize → {@code L-192.168.0.196}. */
const isHomeFleetClientId = (id: string): boolean =>
    Boolean(id) && isAssociableFleetWireNodeId(normalizeWireNodeIdForWire(id));

/** Persist short home-fleet Client-ID ({@code L-196}); never expand to full LAN form. */
const normalizePersistedClientId = (raw: unknown): string =>
    sanitizeFleetSelfWireNodeId(raw) || String(raw ?? "").trim();

const isCapacitorNativeShell = (): boolean => {
    try {
        const c = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

/** Desk Neutralino / endpoint peer — must be in Android clipboard destinations for Win images. */
const CAPACITOR_DESK_PEER_ID = "L-110";

const isDeskPeerId = (id: string): boolean => {
    const shortId = sanitizeFleetSelfWireNodeId(id) || id.trim();
    return shortId === CAPACITOR_DESK_PEER_ID;
};

const splitClipboardDestIds = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[,;\s\n\r]+/)) {
        const id = part.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
};

const joinClipboardDestIds = (ids: string[]): string => ids.filter(Boolean).join(";");

/**
 * Prepend L-110 when missing. Leaves `*` alone (wildcard already covers desk).
 * WHY: legacy Capacitor prefs were phone-only (L-196;L-210;L-208) → Android↔Android only.
 */
const ensureDeskPeerInDestCsv = (raw: string): { value: string; changed: boolean } => {
    const t = String(raw || "").trim();
    if (!t || t === "*") return { value: t || "*", changed: false };
    const ids = splitClipboardDestIds(t);
    if (ids.some(isDeskPeerId)) return { value: joinClipboardDestIds(ids), changed: false };
    return { value: joinClipboardDestIds([CAPACITOR_DESK_PEER_ID, ...ids]), changed: true };
};

/** Patch Capacitor settings so routeTarget + share destinations include desk L-110. */
const ensureCapacitorDeskClipboardTargets = (settings: AppSettings): AppSettings | null => {
    if (!isCapacitorNativeShell()) return null;
    const route = trimSetting(settings.core?.socket?.routeTarget);
    const share = trimSetting(settings.shell?.clipboardShareDestinationIds);
    const fallback = "L-196;L-210";
    const r = ensureDeskPeerInDestCsv(route || fallback);
    const s = ensureDeskPeerInDestCsv(share || route || fallback);
    if (!r.changed && !s.changed) return null;
    return {
        ...settings,
        core: {
            ...settings.core,
            socket: {
                ...(settings.core?.socket || {}),
                routeTarget: r.value
            }
        },
        shell: {
            ...settings.shell,
            clipboardShareDestinationIds: s.value
        }
    } as AppSettings;
};

// --- WebNative desktop control-RPC overlay -----------------------------------------------
//
// WHY: the WebNative desktop shell runs a local Node backend (`runtime/cwsp/webnative/app/backend`)
// that owns the REAL CWSP config (`portable.config.json` + `config/*.json`) and exposes it over a
// loopback control RPC at `/service/config` (GET = raw portable + DEFAULT_SETTINGS + resolved
// snapshot + user settings; POST = deep-merge patch into portable.config.json + reload + restart
// the endpoint child). The minimal-shell webview's Settings/Network views read `loadSettings()`
// which is otherwise IDB-only — so on desktop the UI would show IDB defaults (`https://localhost:8434`)
// instead of the actual configured endpoint (`https://192.168.0.200:8434`), and Save would only hit
// IDB, never `portable.config.json`, never trigger an endpoint reload.
//
// This overlay mirrors the Capacitor `cws-bridge` pattern: on the WebNative surface (detected via
// the `__WEBNATIVE_AUTH__` global the backend's `__webnative_auth__.js` injects), `loadSettings`
// merges config-snapshot-derived `core` fields over IDB (config wins for endpoint/identity/TLS so
// the UI reflects the real CWSP config), and `saveSettings` POSTs a `bridge` patch to `/service/config`
// so `portable.config.json`'s bridge section (read by `resolveBridgeConfig`) is updated and the
// endpoint reloads. No new cross-level imports — uses `globalThis.__WEBNATIVE_AUTH__` + fetch, same
// shape as the Capacitor overlay. On non-WebNative surfaces these helpers are no-ops (zero regression
// for Capacitor/PWA/CRX).

/**
 * Control RPC auth. `host` required for public /cwsp → Capacitor LAN :8434
 * (hardcoded 127.0.0.1 breaks HTTPS pages — mixed content / hub redirect on desk).
 */
interface WebnativeAuth {
    port: number;
    key: string;
    host?: string;
    scheme?: "http" | "https";
}

/** Neutralino / WebNative / /cwsp Control bridge shares `/service/config`. */
const isWebnativeSurface = (): boolean => {
    try {
        const g = globalThis as unknown as {
            __WEBNATIVE_AUTH__?: WebnativeAuth;
            __NEUTRALINO_AUTH__?: WebnativeAuth;
            __CWS_WEBNATIVE_BOOT__?: boolean;
            __CWS_NEUTRALINO_BOOT__?: boolean;
            __CWSP_CONTROL_BRIDGE_LIVE__?: boolean;
        };
        const auth = g.__WEBNATIVE_AUTH__ || g.__NEUTRALINO_AUTH__;
        return Boolean(
            g.__CWS_WEBNATIVE_BOOT__ ||
                g.__CWS_NEUTRALINO_BOOT__ ||
                g.__CWSP_CONTROL_BRIDGE_LIVE__ ||
                (auth && typeof auth.port === "number")
        );
    } catch {
        return false;
    }
};

const readDesktopControlAuth = (): WebnativeAuth | null => {
    try {
        const g = globalThis as unknown as {
            __WEBNATIVE_AUTH__?: WebnativeAuth;
            __NEUTRALINO_AUTH__?: WebnativeAuth;
            __CWSP_CONTROL_VIA__?: string;
            __CWSP_CONTROL_SOURCE__?: {
                host?: string;
                port?: number;
                apiKey?: string;
                userKey?: string;
                scheme?: string;
            };
        };
        const src = g.__CWSP_CONTROL_SOURCE__;
        const via = String(g.__CWSP_CONTROL_VIA__ || "");
        // WHY: Capacitor L-210 SoT must not fall back to stale Neutralino L-110 auth.
        if (via === "android" && src && typeof src.port === "number" && src.host) {
            return {
                port: src.port,
                key: String(src.apiKey || src.userKey || ""),
                host: String(src.host).trim(),
                scheme: src.scheme === "https" ? "https" : "http"
            };
        }
        // Desk Neutralino L-110 — prefer explicit Neutralino auth.
        if (via === "neutralino" || g.__NEUTRALINO_AUTH__) {
            const n = g.__NEUTRALINO_AUTH__ || g.__WEBNATIVE_AUTH__;
            if (n && typeof n.port === "number") {
                return {
                    port: n.port || 29110,
                    key: String(n.key || "cwsp-neutralino-local"),
                    host: String(n.host || "127.0.0.1"),
                    scheme: n.scheme === "https" ? "https" : "http"
                };
            }
        }
        const auth = g.__WEBNATIVE_AUTH__ || g.__NEUTRALINO_AUTH__;
        if (auth && typeof auth.port === "number") {
            return {
                port: auth.port,
                key: String(auth.key || src?.apiKey || src?.userKey || ""),
                host: String(auth.host || src?.host || "127.0.0.1").trim() || "127.0.0.1",
                scheme: auth.scheme === "https" || src?.scheme === "https" ? "https" : "http"
            };
        }
        if (src && typeof src.port === "number" && src.host) {
            return {
                port: src.port,
                key: String(src.apiKey || src.userKey || ""),
                host: String(src.host).trim() || "127.0.0.1",
                scheme: src.scheme === "https" ? "https" : "http"
            };
        }
        return null;
    } catch {
        return null;
    }
};

const webnativeControl = async <T = unknown>(path: string, init?: RequestInit): Promise<T | null> => {
    try {
        const auth = readDesktopControlAuth();
        if (!auth || typeof auth.port !== "number") return null;
        const host = String(auth.host || "127.0.0.1").trim() || "127.0.0.1";
        const scheme = auth.scheme === "https" ? "https" : "http";
        // WHY: public https://VDS/cwsp must not call desk hub http://127.0.0.1:8434 (redirect breaks CORS).
        const pageHost = String(location.hostname || "").toLowerCase();
        const pageIsPublicHttps =
            location.protocol === "https:" &&
            pageHost !== "127.0.0.1" &&
            pageHost !== "localhost" &&
            pageHost !== "::1";
        if (
            pageIsPublicHttps &&
            (host === "127.0.0.1" || host === "localhost" || host === "::1") &&
            auth.port === 8434
        ) {
            return null;
        }
        const headers = new Headers(init?.headers);
        headers.set("Content-Type", "application/json");
        if (auth.key) headers.set("X-API-Key", auth.key);
        const timeoutMs = 2500;
        const signal =
            init?.signal ??
            (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(timeoutMs)
                : undefined);
        const hostPart = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
        const url = `${scheme}://${hostPart}:${auth.port}${path.startsWith("/") ? path : `/${path}`}`;
        const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
        const isPrivate =
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
        const fetchInit: RequestInit & { targetAddressSpace?: string } = {
            ...init,
            headers,
            cache: "no-store",
            signal,
            mode: "cors",
            credentials: "omit"
        };
        if (isLoopback) fetchInit.targetAddressSpace = "loopback";
        else if (isPrivate) fetchInit.targetAddressSpace = "local";
        const res = await fetch(url, fetchInit as RequestInit);
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
};

/**
 * Map a resolved CWSP config snapshot (`readServerV2ConfigSnapshot` shape from the backend's
 * GET /service/config) onto the AppSettings.core fields the Settings/Network views render. The
 * snapshot's `bridge` section carries the canonical endpoint URL + identity + TLS decision.
 */
const mapWebnativeSnapshotToCore = (snap: any): Partial<AppSettings["core"]> | null => {
    if (!snap || typeof snap !== "object") return null;
    const bridge = snap.bridge || {};
    const shell = snap.shell || {};
    const coreIn = snap.core && typeof snap.core === "object" ? snap.core : {};
    const listenPort = Number(snap.listenPort) || Number(snap.publicHttpPort) || 8434;
    // WHY: bridge.endpointUrl is often empty in real CWSP configs (the topology lives in bridge.endpoints).
    // Prefer the explicit endpointUrl, then the first bridge.endpoints entry (typically the WAN entry
    // like https://45.147.121.152:8434/), then loopback as a last resort so the UI never shows the stale
    // IDB default (https://localhost:8434).
    const endpointUrlRaw = String(
        coreIn.endpointUrl || bridge.endpointUrl || shell.remoteHost || ""
    ).trim();
    const endpointsList = Array.isArray(bridge.endpoints) ? bridge.endpoints.map((e: unknown) => String(e || "").trim()).filter(Boolean) : [];
    const endpointUrl = endpointUrlRaw || endpointsList[0] || "";
    const userId = String(coreIn.userId || bridge.userId || bridge.deviceId || "").trim();
    const userKey = String(
        coreIn.ecosystemToken ||
            coreIn.userKey ||
            bridge.userKey ||
            shell.accessToken ||
            shell.clientToken ||
            ""
    ).trim();
    const allowInsecureTls =
        bridge.allowInsecureTls !== undefined
            ? Boolean(bridge.allowInsecureTls)
            : coreIn.allowInsecureTls !== undefined
              ? Boolean(coreIn.allowInsecureTls)
              : undefined;
    if (!endpointUrl && !userId && !userKey) return null;
    const overlay: Partial<AppSettings["core"]> = {};
    if (endpointUrl) overlay.endpointUrl = endpointUrl;
    else if (!endpointUrl && !userId) overlay.endpointUrl = `https://127.0.0.1:${listenPort}`;
    if (userId) overlay.userId = userId;
    // INVARIANT: never overlay empty token over a good IDB ecosystemToken.
    if (userKey) {
        overlay.userKey = userKey;
        overlay.ecosystemToken = userKey;
        overlay.socket = { accessToken: userKey };
    }
    if (allowInsecureTls !== undefined) overlay.allowInsecureTls = allowInsecureTls;
    overlay.preferBackendSync = (coreIn.preferBackendSync ?? true) !== false;
    return overlay;
};

/** Shell keys owned by Node portable.config — backend wins when present. */
const mapWebnativeBundleToShell = (bundle: any): Partial<AppSettings["shell"]> | null => {
    const shell = bundle?.settings?.shell || bundle?.portable?.shell || bundle?.snapshot?.shell;
    if (!shell || typeof shell !== "object") return null;
    return { ...shell } as Partial<AppSettings["shell"]>;
};

/**
 * Overlay config-derived core fields onto the IDB-loaded settings so the WebNative desktop UI shows
 * the REAL CWSP endpoint/identity/TLS instead of IDB defaults. Config wins for these fields because
 * `portable.config.json` is the source of truth on desktop; IDB-only fields (ai, appearance, …) are
 * untouched. Returns `base` unchanged on non-WebNative surfaces.
 */
let webnativeSnapshotCache: any = null;
let webnativeBundleCache: any = null;
let webnativeSnapshotFetchedAt = 0;
const loadWebnativeControlBundle = async (): Promise<any> => {
    if (Date.now() - webnativeSnapshotFetchedAt < 2000 && webnativeBundleCache) {
        return webnativeBundleCache;
    }
    const bundle = await webnativeControl<{
        snapshot?: any;
        settings?: any;
        portable?: any;
    } | null>("/service/config");
    webnativeBundleCache = bundle || null;
    webnativeSnapshotCache =
        bundle?.snapshot || bundle?.settings || bundle?.portable || null;
    webnativeSnapshotFetchedAt = Date.now();
    return webnativeBundleCache;
};

const loadWebnativeSnapshot = async (): Promise<any> => {
    const bundle = await loadWebnativeControlBundle();
    return bundle?.snapshot || bundle?.settings || bundle?.portable || webnativeSnapshotCache;
};

/** Best-effort push of a settings save into `portable.config.json` via the backend control RPC. */
const pushWebnativeSettingsPatch = async (settings: AppSettings): Promise<boolean> => {
    if (!isWebnativeSurface()) return false;
    const core = settings.core;
    if (!core) return false;
    const token = String(core.ecosystemToken || core.userKey || core.socket?.accessToken || "").trim();
    const remoteHost = String(core.endpointUrl || "").trim();
    const clientId = String(core.userId || "").trim();
    const shell = settings.shell || {};
    // WHY: map AppSettings.core → portable.config.json `bridge` + `shell` (clipboard-hub reads these).
    // INVARIANT: clipboard prompt modes MUST reach Node — hub gates Accept vs Undo on
    // `shell.clipboardInboundMode` / `shell.clipboardOutboundMode`. Omitting them left the
    // hub stuck on "auto" while the Settings UI (IDB) showed "ask" → Undo toast on inbound.
    const patch: Record<string, unknown> = {
        bridge: {
            endpointUrl: remoteHost,
            userId: clientId,
            userKey: token,
            allowInsecureTls: Boolean(core.allowInsecureTls)
        },
        shell: {
            remoteHost,
            accessToken: token,
            clientToken: token,
            // WHY: Node clipboard-hub reads this for Win→Android destinations (not `*`).
            clipboardBroadcastTargets: String(
                (shell as { clipboardBroadcastTargets?: string }).clipboardBroadcastTargets ||
                    core.socket?.routeTarget ||
                    "L-196;L-210"
            ).trim(),
            clipboardOutboundMode:
                String((shell as { clipboardOutboundMode?: string }).clipboardOutboundMode || "auto")
                    .trim()
                    .toLowerCase() === "ask"
                    ? "ask"
                    : "auto",
            clipboardInboundMode:
                String((shell as { clipboardInboundMode?: string }).clipboardInboundMode || "auto")
                    .trim()
                    .toLowerCase() === "ask"
                    ? "ask"
                    : "auto",
            clipboardOutboundShowErase:
                (shell as { clipboardOutboundShowErase?: boolean }).clipboardOutboundShowErase !== false,
            clipboardInboundShowUndo:
                (shell as { clipboardInboundShowUndo?: boolean }).clipboardInboundShowUndo !== false,
            clipboardPromptDismissMs: (() => {
                const n = Number((shell as { clipboardPromptDismissMs?: number }).clipboardPromptDismissMs);
                return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 10000;
            })()
        },
        launcherEnv: {
            CWS_ASSOCIATED_ID: clientId,
            CWS_ASSOCIATED_TOKEN: token
        }
    };
    if (core.ops?.directUrl) {
        (patch.bridge as Record<string, unknown>).endpoints = [String(core.ops.directUrl).trim()];
    }
    // WHY: Neutralino L-110 expects bridge/shell portable patch; Capacitor also accepts full AppSettings.
    const authForPatch = readDesktopControlAuth();
    const isCapacitorControl =
        Number(authForPatch?.port) === 8434 &&
        String(authForPatch?.host || "") !== "127.0.0.1" &&
        String(authForPatch?.host || "") !== "localhost";
    const body = isCapacitorControl
        ? {
              ...patch,
              core: settings.core,
              shell: { ...(patch.shell as object), ...(settings.shell || {}) },
              cwsp: (settings as { cwsp?: unknown }).cwsp
          }
        : patch;
    const r = await webnativeControl<{ ok?: boolean; settings?: unknown; portable?: unknown } | null>(
        "/service/config",
        {
            method: "POST",
            body: JSON.stringify(body)
        }
    );
    // WHY: Node clipboard-hub only — Capacitor Control API has no this route (404/CORS noise).
    try {
        const auth = readDesktopControlAuth();
        const hubPort = Number(auth?.port) || 0;
        const hubHost = String(auth?.host || "127.0.0.1");
        const isNeutralinoHub =
            hubPort === 29110 &&
            (hubHost === "127.0.0.1" || hubHost === "localhost" || hubHost === "::1");
        if (isNeutralinoHub) {
            const hubBody: Record<string, string> = {};
            if (remoteHost) hubBody.remoteHost = remoteHost;
            if (token) {
                hubBody.accessToken = token;
                hubBody.clientToken = token;
            }
            if (clientId) hubBody.clientId = clientId;
            if (Object.keys(hubBody).length) {
                await webnativeControl("/service/clipboard-hub", {
                    method: "POST",
                    body: JSON.stringify(hubBody)
                });
            }
        }
    } catch {
        /* clipboard-hub optional on older backends */
    }
    // WHY: bust the snapshot cache so the next load reflects the just-written config.
    webnativeSnapshotFetchedAt = 0;
    webnativeSnapshotCache = null;
    webnativeBundleCache = null;
    // Neutralino returns `{ ok: true }`; Capacitor may return settings blob with ok.
    return Boolean(r?.ok === true || (isCapacitorControl && r && (r.settings || r.portable)));
};

/** First-boot CWSP defaults for CWSAndroid when IDB still has dev/empty endpoint fields. */
const CAPACITOR_CWSP_BOOTSTRAP: Partial<AppSettings> = {
    core: {
        endpointUrl: "https://192.168.0.200:8434",
        ecosystemToken: "n3v3rm1nd",
        userKey: "n3v3rm1nd",
        allowInsecureTls: true,
        useCoreIdentityForAirPad: true,
        ops: {
            directUrl: "https://192.168.0.110:8434"
        },
        socket: {
            routeTarget: "L-110;L-196;L-210",
            accessToken: "n3v3rm1nd",
            allowAccessTokenWithoutUserKey: true,
            protocol: "auto"
        },
        interop: {
            preferNativeWebsocket: true
        }
    },
    shell: {
        bridgeDaemonEnabled: true,
        allowControlApi: false,
        autoStartOnBoot: true,
        enableRemoteClipboardBridge: true,
        acceptInboundClipboardData: true,
        applyRemoteClipboardToDevice: true,
        maintainHubSocketConnection: false,
        // WHY: must include desk L-110 — phone-only lists made Android↔Android work but blocked Win images.
        clipboardShareDestinationIds: "L-110;L-196;L-210"
    }
};

const needsCapacitorCwspBootstrap = (settings: AppSettings): boolean => {
    if (!isCapacitorNativeShell()) return false;
    const ep = trimSetting(settings.core?.endpointUrl);
    const uid = trimSetting(settings.core?.userId);
    const access =
        trimSetting(settings.core?.ecosystemToken) ||
        trimSetting(settings.core?.socket?.accessToken) ||
        trimSetting(settings.core?.userKey);
    const defaultEp = trimSetting(DEFAULT_SETTINGS.core?.endpointUrl);
    if (!uid || !access) return true;
    if (!ep || ep === defaultEp || /localhost|127\.0\.0\.1|:8434/i.test(ep)) return true;
    return false;
};

/** Seed mobile CWSP settings + sync to Java prefs on first Capacitor boot. */
let capacitorCwspSeedDone = false;
export const ensureCapacitorCwspSettingsSeeded = async (): Promise<AppSettings | null> => {
    if (!isCapacitorNativeShell()) return null;
    if (capacitorCwspSeedDone) return null;

    let nativeUserId = "";
    try {
        if (isCwsNativeIpcAvailable()) {
            nativeUserId = trimSetting((await getNativeUnifiedSettings())?.core?.userId);
        }
    } catch {
        /* bridge optional during early boot */
    }

    const current = await loadSettings({ nativeOverlay: false });
    const currentUserId = trimSetting(current.core?.userId);
    const needsBootstrap = needsCapacitorCwspBootstrap(current);
    const identityDrift =
        Boolean(nativeUserId) &&
        Boolean(currentUserId) &&
        nativeUserId !== currentUserId &&
        isCapacitorFactorySelfId(currentUserId) &&
        isHomeFleetClientId(nativeUserId);

    const idbUserConfigured =
        Boolean(currentUserId) && isHomeFleetClientId(currentUserId);
    const nativeDriftsFromIdb =
        Boolean(nativeUserId) &&
        Boolean(currentUserId) &&
        nativeUserId !== currentUserId;
    const nativeIsGuestLanId =
        Boolean(nativeUserId) && !isHomeFleetClientId(nativeUserId);

  // WHY: WebView IDB is source of truth after user saves — push to native when runtime LAN-bind drifted.
    if (!needsBootstrap && nativeDriftsFromIdb && (idbUserConfigured || nativeIsGuestLanId)) {
        capacitorCwspSeedDone = true;
        console.log("[Settings] pushing WebView client id to native prefs");
        const migrated = ensureCapacitorDeskClipboardTargets(current) || current;
        return saveSettings(migrated);
    }

    if (!needsBootstrap && !identityDrift) {
        capacitorCwspSeedDone = true;
        const migrated = ensureCapacitorDeskClipboardTargets(current);
        if (migrated) {
            console.log("[Settings] injecting L-110 into clipboard destinations");
            return saveSettings(migrated);
        }
        return null;
    }

    // WHY: identityDrift only realigns client id with native prefs when IDB still has factory default.
    if (identityDrift && !needsBootstrap) {
        capacitorCwspSeedDone = true;
        const aligned = {
            ...current,
            core: {
                ...current.core,
                userId: nativeUserId,
                socket: {
                    ...(current.core?.socket || {}),
                    selfId: nativeUserId
                }
            }
        } as AppSettings;
        console.log("[Settings] aligning Capacitor client id with native prefs");
        return saveSettings(ensureCapacitorDeskClipboardTargets(aligned) || aligned);
    }

    const merged = {
        ...current,
        core: {
            ...CAPACITOR_CWSP_BOOTSTRAP.core,
            ...current.core,
            userId:
                (isHomeFleetClientId(nativeUserId) ? nativeUserId : "") ||
                (isHomeFleetClientId(currentUserId) ? currentUserId : "") ||
                trimSetting(CAPACITOR_CWSP_BOOTSTRAP.core?.userId) ||
                "",
            ops: {
                ...(CAPACITOR_CWSP_BOOTSTRAP.core?.ops || {}),
                ...(current.core?.ops || {})
            },
            socket: {
                ...(CAPACITOR_CWSP_BOOTSTRAP.core?.socket || {}),
                ...(current.core?.socket || {}),
                selfId:
                    (isHomeFleetClientId(nativeUserId) ? nativeUserId : "") ||
                    (isHomeFleetClientId(trimSetting(current.core?.socket?.selfId)) ? trimSetting(current.core?.socket?.selfId) : "") ||
                    ""
            },
            interop: {
                ...(CAPACITOR_CWSP_BOOTSTRAP.core?.interop || {}),
                ...(current.core?.interop || {})
            }
        },
        shell: {
            ...(CAPACITOR_CWSP_BOOTSTRAP.shell || {}),
            ...(current.shell || {})
        }
    } as AppSettings;
    console.log("[Settings] seeding Capacitor CWSP defaults");
    capacitorCwspSeedDone = true;
    return saveSettings(ensureCapacitorDeskClipboardTargets(merged) || merged);
};

/**
 * Chrome extension CWSP defaults: same local hub as Neutralino (`127.0.0.1:8434`),
 * wire identity {@code L-110-crx} (distinct from desk Neutralino {@code L-110}).
 *
 * WHY: sharing L-110 with Neutralino steals the desk socket — inbound ask-holds
 * never reach the extension. Neutralino mirrors paste-hold → L-110-crx; CRX
 * holds for "Paste by CWSP" and control-take dismisses Accept.
 */
const CRX_CWSP_CLIENT_ID = "L-110-crx";
/** WHY: hub `verify()` requires a non-empty userKey; L-110-crx policy accepts associated tokens. */
const CRX_CWSP_BOOTSTRAP_TOKEN = "n3v3rm1nd";
const CRX_CWSP_BOOTSTRAP: Partial<AppSettings> = {
    core: {
        endpointUrl: "https://127.0.0.1:8434",
        allowInsecureTls: true,
        useCoreIdentityForAirPad: true,
        userId: CRX_CWSP_CLIENT_ID,
        ecosystemToken: CRX_CWSP_BOOTSTRAP_TOKEN,
        userKey: CRX_CWSP_BOOTSTRAP_TOKEN,
        ops: {
            directUrl: "https://127.0.0.1:8434"
        },
        socket: {
            selfId: CRX_CWSP_CLIENT_ID,
            // WHY: share to phones/gateway — never self (L-110-crx) or desk L-110 as paste ask target.
            routeTarget: "L-196;L-210;L-200",
            // WHY: chrome-extension:// SW has location.protocol !== https — force wss candidates.
            protocol: "https",
            accessToken: CRX_CWSP_BOOTSTRAP_TOKEN,
            allowAccessTokenWithoutUserKey: true
        }
    },
    shell: {
        maintainHubSocketConnection: true,
        enableRemoteClipboardBridge: true,
        acceptInboundClipboardData: true,
        applyRemoteClipboardToDevice: false,
        pushLocalClipboardToLan: false,
        clipboardShareDestinationIds: "L-196;L-210;L-200",
        clipboardInboundMode: "ask",
        clipboardOutboundMode: "auto"
    }
};

const isCrxExtensionRuntime = (): boolean => {
    try {
        const id = (globalThis as unknown as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
        return typeof id === "string" && id.length > 0;
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
    if (userId && isHomeFleetClientId(userId)) {
        const baseUserId = trimSetting(base.core?.userId);
        if (isCapacitorFactorySelfId(baseUserId) || !isHomeFleetClientId(baseUserId)) {
            corePatch.userId = userId;
            touched = true;
        }
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
    const nativeSelfId = trimSetting(native.core?.socket?.selfId);
    if (nativeSelfId && isHomeFleetClientId(nativeSelfId)) {
        const baseSelfId = trimSetting(base.core?.socket?.selfId) || trimSetting(base.core?.userId);
        if (isCapacitorFactorySelfId(baseSelfId) || !isHomeFleetClientId(baseSelfId)) {
            socketPatch.selfId = nativeSelfId;
            socketTouched = true;
        }
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
        // WHY: On Capacitor prefer IDB (authoritative after Save); localStorage mirror is fallback only.
        if (isCapacitorNativeShell() && typeof indexedDB !== "undefined") {
            try {
                const db = await idbOpen();
                const idbValue = await new Promise<any>((res, rej) => {
                    const tx = db.transaction(STORE, "readonly");
                    const req = tx.objectStore(STORE).get(key);
                    req.onsuccess = () => {
                        res(req.result?.value);
                        db.close();
                    };
                    req.onerror = () => {
                        rej(req.error);
                        db.close();
                    };
                });
                if (idbValue != null) return idbValue;
            } catch (e) {
                console.warn("[Settings] Capacitor IndexedDB read failed, trying mirror:", e);
            }
            const mirror = readLocalStorageSettingsMirror();
            if (mirror != null) return mirror;
        }

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

/** Rewrite legacy `:8443` URLs and listenPort in persisted settings after fleet port migration. */
const applyLegacyCwspPortMigration = (settings: AppSettings): AppSettings => {
    const core = settings.core;
    if (!core) return settings;
    const migrateList = (items: string[] | undefined): string[] | undefined =>
        items?.map((entry) => migrateLegacyCwspPublicPort(entry));
    const listenPortHttps =
        core.network?.listenPortHttps === 8443 || core.network?.listenPortHttps === 8343
            ? 8434
            : core.network?.listenPortHttps;
    return {
        ...settings,
        core: {
            ...core,
            endpointUrl: migrateLegacyCwspPublicPort(core.endpointUrl ?? ""),
            ops: core.ops
                ? {
                      ...core.ops,
                      directUrl: migrateLegacyCwspPublicPort(core.ops.directUrl ?? ""),
                      httpTargets: migrateList(core.ops.httpTargets),
                      wsTargets: migrateList(core.ops.wsTargets),
                      syncTargets: migrateList(core.ops.syncTargets)
                  }
                : core.ops,
            admin: core.admin
                ? {
                      ...core.admin,
                      httpsOrigin: migrateLegacyCwspPublicPort(core.admin.httpsOrigin ?? "")
                  }
                : core.admin,
            network: core.network
                ? {
                      ...core.network,
                      listenPortHttps,
                      destinations: migrateList(core.network.destinations)
                  }
                : core.network
        }
    };
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

/** Seed CRX hub + {@code L-110-crx} identity (migrates colliding {@code L-110}). */
let crxCwspSeedDone = false;
export const ensureCrxCwspSettingsSeeded = async (): Promise<AppSettings | null> => {
    if (!isCrxExtensionRuntime()) return null;
    if (crxCwspSeedDone) return null;

    const current = await loadSettings({ nativeOverlay: false });
    const currentUserId = trimSetting(current.core?.userId);
    const hubPersisted = await didPersistShellMaintainHubSocket();
    const existingToken =
        trimSetting((current.core as { ecosystemToken?: string })?.ecosystemToken) ||
        trimSetting(current.core?.userKey) ||
        trimSetting(current.core?.socket?.accessToken);
    const needsHttpsProtocol = current.core?.socket?.protocol !== "https";
    // WHY: L-110 collides with Neutralino desk hub socket — force L-110-crx.
    const needsCrxIdNormalize = /^L-110$/i.test(currentUserId);
    // WHY: merged defaults always include maintain=false — seed when IDB never set hub,
    // client id empty, auth token missing (WS closes 4001), protocol still "auto",
    // or colliding L-110 must become L-110-crx.
    const needsBootstrap =
        !currentUserId ||
        !hubPersisted ||
        !existingToken ||
        needsHttpsProtocol ||
        needsCrxIdNormalize ||
        !/^L-110-crx$/i.test(currentUserId);
    if (!needsBootstrap) {
        crxCwspSeedDone = true;
        return null;
    }

    const keepUserId = CRX_CWSP_CLIENT_ID;
    const savedEp = trimSetting(current.core?.endpointUrl);
    const defaultEp = trimSetting(DEFAULT_SETTINGS.core?.endpointUrl);
    const useSavedEp = Boolean(savedEp) && savedEp !== defaultEp;
    const seedToken = existingToken || CRX_CWSP_BOOTSTRAP_TOKEN;
    const merged = {
        ...current,
        core: {
            ...current.core,
            allowInsecureTls: current.core?.allowInsecureTls ?? true,
            useCoreIdentityForAirPad: current.core?.useCoreIdentityForAirPad ?? true,
            userId: keepUserId,
            ecosystemToken: seedToken,
            userKey: seedToken,
            endpointUrl: useSavedEp ? savedEp : (CRX_CWSP_BOOTSTRAP.core?.endpointUrl || savedEp),
            ops: {
                ...(current.core?.ops || {}),
                directUrl:
                    trimSetting(current.core?.ops?.directUrl) ||
                    CRX_CWSP_BOOTSTRAP.core?.ops?.directUrl ||
                    ""
            },
            socket: {
                ...(current.core?.socket || {}),
                // INVARIANT: CRX wire id is always L-110-crx (never desk L-110).
                selfId: keepUserId,
                routeTarget:
                    trimSetting(current.core?.socket?.routeTarget) ||
                    CRX_CWSP_BOOTSTRAP.core?.socket?.routeTarget ||
                    "",
                protocol: "https",
                accessToken: trimSetting(current.core?.socket?.accessToken) || seedToken,
                allowAccessTokenWithoutUserKey: true
            }
        },
        shell: {
            ...current.shell,
            maintainHubSocketConnection: hubPersisted
                ? Boolean(current.shell?.maintainHubSocketConnection)
                : true,
            enableRemoteClipboardBridge: current.shell?.enableRemoteClipboardBridge !== false,
            acceptInboundClipboardData: current.shell?.acceptInboundClipboardData !== false,
            // Prefer hold-for-paste on first seed; keep explicit user choice after.
            applyRemoteClipboardToDevice: hubPersisted
                ? Boolean(current.shell?.applyRemoteClipboardToDevice)
                : false,
            clipboardShareDestinationIds:
                trimSetting(current.shell?.clipboardShareDestinationIds) ||
                CRX_CWSP_BOOTSTRAP.shell?.clipboardShareDestinationIds ||
                "",
            clipboardInboundMode:
                current.shell?.clipboardInboundMode ||
                CRX_CWSP_BOOTSTRAP.shell?.clipboardInboundMode ||
                "ask"
        }
    } as AppSettings;

    console.log("[Settings] seeding CRX CWSP defaults", {
        clientId: keepUserId,
        endpoint: merged.core?.endpointUrl
    });
    crxCwspSeedDone = true;
    return saveSettings(merged);
};

/**
 * MV3 Chrome extension: skip hub WebSocket bootstrap only when hub-maintain is off and
 * the endpoint is still the unused bundled default. When CRX seeds {@code maintainHubSocketConnection}
 * (localhost Neutralino hub or WAN), connect immediately.
 */
export const shouldDeferCrxHubSocketBootstrap = async (settings: AppSettings): Promise<boolean> => {
    if (!isCrxExtensionRuntime()) return false;
    if (settings.shell?.maintainHubSocketConnection === true) return false;
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

            // Neutralino/WebNative desktop: overlay REAL portable.config (backend SoT) over IDB
            // so Settings fields show Node values when the control host is up. Best-effort:
            // a fetch failure leaves IDB intact. Respect preferBackendSync=false to keep IDB-only.
            try {
                if (isWebnativeSurface()) {
                    const preferBackend = (result.core?.preferBackendSync ?? true) !== false;
                    if (preferBackend) {
                        const bundle = await loadWebnativeControlBundle();
                        const snap =
                            bundle?.snapshot ||
                            bundle?.settings ||
                            bundle?.portable ||
                            null;
                        const coreOverlay = mapWebnativeSnapshotToCore({
                            ...(snap || {}),
                            ...(bundle?.settings || {}),
                            ...(bundle?.portable || {})
                        });
                        const shellOverlay = mapWebnativeBundleToShell(bundle);
                        if (coreOverlay || shellOverlay) {
                            result = {
                                ...result,
                                core: coreOverlay
                                    ? {
                                          ...result.core,
                                          ...coreOverlay,
                                          socket: {
                                              ...(result.core?.socket || {}),
                                              ...((coreOverlay as any).socket || {})
                                          },
                                          ops: { ...(result.core?.ops || {}) },
                                          admin: { ...(result.core?.admin || {}) },
                                          network: { ...(result.core?.network || {}) },
                                          interop: { ...(result.core?.interop || {}) }
                                      }
                                    : result.core,
                                shell: shellOverlay
                                    ? {
                                          ...(result.shell || {}),
                                          ...shellOverlay
                                      }
                                    : result.shell
                            } as AppSettings;
                        }
                    }
                }
            } catch {
                /* webnative/neutralino control RPC optional — ignore */
            }

            console.log("[Settings] loadSettings result:", {
                hasApiKey: !!result.ai?.apiKey,
                instructionCount: result.ai?.customInstructions?.length || 0,
                activeInstructionId: result.ai?.activeInstructionId || "(none)"
            });

            return applyLegacyCwspPortMigration(result as AppSettings);
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
    // WHY: Settings UI uses short Client-IDs (L-196). Persist short form; do not expand to full LAN id.
    if (merged.core) {
        const canonicalUserId = normalizePersistedClientId(merged.core.userId);
        if (canonicalUserId) merged.core.userId = canonicalUserId;
        normalizeEcosystemToken(merged);
        if (merged.core.socket) {
            // Keep socket.selfId empty or aligned with userId — never a stale competing identity.
            const selfRaw = String(merged.core.socket.selfId || "").trim();
            if (selfRaw) {
                const canonicalSelf = normalizePersistedClientId(selfRaw);
                merged.core.socket.selfId =
                    canonicalSelf && canonicalSelf === (merged.core.userId || "")
                        ? canonicalSelf
                        : "";
            } else {
                merged.core.socket.selfId = "";
            }
        }
    }
    await idbPutSettings(merged);
    lastSettingsSaveReport = { nativeSynced: null };
    try {
        // WHY: static cws-bridge — CRX SW seed/save cannot use import().
        if (isCwsNativeIpcAvailable()) {
            await initCwsNativeBridge().catch(() => null);
            const patch = await patchNativeUnifiedSettingsDetailed(merged as unknown as Record<string, unknown>);
            lastSettingsSaveReport = {
                nativeSynced: patch.ok,
                nativeError: patch.error
            };
            if (!patch.ok) {
                console.warn("[Settings] native settings patch did not confirm ok:", patch.error);
            }
        }
    } catch (e) {
        lastSettingsSaveReport = {
            nativeSynced: false,
            nativeError: String(e instanceof Error ? e.message : e)
        };
        console.warn("[Settings] native settings patch failed:", e);
    }
    // WebNative desktop: push the core endpoint/identity/TLS patch into portable.config.json via
    // the backend control RPC so the REAL CWSP config stays in sync + the endpoint reloads. Best-
    // effort: a failure does NOT fail the save (IDB already persisted). Mirrors the Capacitor patch.
    if (isWebnativeSurface()) {
        try {
            const ok = await pushWebnativeSettingsPatch(merged);
            lastSettingsSaveReport = {
                ...lastSettingsSaveReport,
                webnativeSynced: ok,
                webnativeError: ok ? undefined : "control RPC unavailable"
            };
            if (!ok) console.warn("[Settings] webnative config patch not confirmed (control RPC unavailable?)");
        } catch (e) {
            lastSettingsSaveReport = {
                ...lastSettingsSaveReport,
                webnativeSynced: false,
                webnativeError: String(e instanceof Error ? e.message : e)
            };
            console.warn("[Settings] webnative config patch failed:", e);
        }
    }
    try {
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
const isServiceWorkerScope = (): boolean => {
    try {
        // MV3 extension / classic SW: dynamic import() is disallowed.
        return typeof (globalThis as { ServiceWorkerGlobalScope?: unknown }).ServiceWorkerGlobalScope !== "undefined"
            && typeof (globalThis as { clients?: unknown }).clients !== "undefined"
            && typeof (globalThis as { document?: unknown }).document === "undefined";
    } catch {
        return false;
    }
};
const loadLureFs = () => {
    if (isServiceWorkerScope()) {
        return Promise.reject(new Error("fest/lure FS unavailable in ServiceWorkerGlobalScope"));
    }
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
