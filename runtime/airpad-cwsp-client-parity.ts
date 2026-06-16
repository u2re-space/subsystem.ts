/**
 * **AirPad** web (`localStorage` key below) ↔ **CWSAndroid** (`ApplicationSettings`, `cwsp.*`) contracts.
 * Canonical for shell / view builds that must not import from `runtime/cwsp` sources.
 *
 * **Storage:** {@link AIRPAD_REMOTE_CONFIG_STORAGE_KEY} holds JSON {@link CwspRemoteConnectionV1}.
 * **Specs:** coordinator behaviour in `runtime/cwsp/endpoint/` (`SPECIFICATION-v2.md`, route query helpers).
 *
 * Import in Vite apps via `cwsp-shared/airpad-cwsp-client-parity` (see `tsconfig.vite-base.json`).
 */

/** AirPad popup / view persisted remote block (`airpad-view` / embedding shells). */
export const AIRPAD_REMOTE_CONFIG_STORAGE_KEY = "airpad.remote.connection.v1";

/**
 * Optional `BroadcastChannel` / worker pool name for sharing the same logical blob as localStorage
 * (tabs, service worker, embedding shell). Consumers may no-op when `BroadcastChannel` is missing.
 */
export const CWSP_REMOTE_CONFIG_SYNC_CHANNEL = "cwsp.remote.connection.v1";

/** `v` field inside {@link CwspRemoteConnectionV1} JSON (forward migrations). */
export const CWSP_REMOTE_CONNECTION_JSON_VERSION = 1 as const;

/** NativeScript CWSP settings use `cwsp.*` keys via `ApplicationSettings`. Single source — import from Android via this object. */
export const CWSP_ANDROID_APPLICATION_SETTINGS_KEYS = {
    endpointUrl: "cwsp.endpointUrl",
    relayHttpsUrl: "cwsp.relayHttpsUrl",
    directHttpsUrl: "cwsp.directHttpsUrl",
    connectMode: "cwsp.connectMode",
    quickConnectValue: "cwsp.quickConnectValue",
    peerInstanceId: "cwsp.peerInstanceId",
    clientId: "cwsp.clientId",
    token: "cwsp.token",
    destinationNodeIds: "cwsp.destinationNodeIds",
    allowReadFromIds: "cwsp.allowReadFromIds",
    allowWriteToIds: "cwsp.allowWriteToIds",
    legacyPeerId: "cwsp.peerId",
    legacyBroadcast: "cwsp.broadcastNodes",
    accessToken: "cwsp.accessToken",
    clientAccessToken: "cwsp.clientAccessToken",
    reverseServerMode: "cwsp.reverseServerMode",
    bridgeDaemonEnabled: "cwsp.bridgeDaemonEnabled",
    acceptInboundClipboard: "cwsp.acceptInboundClipboard",
    acceptContactsData: "cwsp.acceptContactsData",
    acceptSmsData: "cwsp.acceptSmsData",
    accessTokenBypassesIdPolicy: "cwsp.accessTokenBypassesIdPolicy",
    shareIntentDestinationIds: "cwsp.shareIntentDestinationIds",
    wireTransport: "cwsp.wireTransport"
} as const;

/** Legacy alias read by older builds; prefer {@link CWSP_ANDROID_APPLICATION_SETTINGS_KEYS.accessToken}. */
export const CWSP_ANDROID_LEGACY_AIRPAD_CONTROL_TOKEN_KEY = "cwsp.airpadControlToken";

/** Prefix for ApplicationSettings discrimination / logging. */
export const CWS_ANDROID_SETTINGS_KEY_PREFIX = "cwsp.";

/**
 * JSON shape persisted under {@link AIRPAD_REMOTE_CONFIG_STORAGE_KEY} and round-tripped from native
 * (clipboard QR, adb push, diagnostics). Prefer normalizing HTTPS fields to origins ending in `/`.
 */
export type CwspRemoteConnectionV1 = {
    v?: typeof CWSP_REMOTE_CONNECTION_JSON_VERSION;
    quickConnectValue?: string;
    /** Relay / routed coordinator HTTPS origin (= native `relayHttpsUrl`). */
    endpointUrl?: string;
    /** Direct peer HTTPS (= native `directHttpsUrl`). */
    directUrl?: string;
    /** Route / destination (= native `destinationNodeIds` comma list). */
    destinationId?: string;
    /** Control / hub access (= native `accessToken`). */
    accessToken?: string;
    /** Node id (= native `associatedClientId` / ApplicationSettings `cwsp.clientId`). */
    clientId?: string;
    peerInstanceId?: string;
    /** Identification / handshake token (= native `identificationToken` / `cwsp.token`). */
    identificationToken?: string;
    /** Inbound ACL / reverse listener hint (= native `clientAccessToken`). */
    clientAccessToken?: string;
    /** Native `/ws` transport. Deprecated `socket.io` is accepted only as a migration alias. */
    wireTransport?: "ws" | "socket.io";
    /** Legacy PWA-only fields — ignored by native converters unless mapped elsewhere. */
    host?: string;
    authToken?: string;
    routeTarget?: string;
};

/**
 * Logical field mapping — PWA “remoteConfig” rows vs native `CwspClientSettings`.
 * Values are human-oriented; both apps normalize origins to `https://host:port/` where applicable.
 */
export const AIRPAD_TO_CWS_ANDROID_FIELDS = [
    { airpadField: "endpointUrl", nativeField: "relayHttpsUrl", note: "Relay / routed coordinator HTTPS origin" },
    { airpadField: "directUrl", nativeField: "directHttpsUrl", note: "Direct peer HTTPS (bypass relay)" },
    { airpadField: "quickConnectValue", nativeField: "quickConnectValue", note: "Paste host, host:port, or https URL" },
    { airpadField: "destinationId", nativeField: "destinationNodeIds", note: "Android uses list (* or L-…;…) and route hints" },
    { airpadField: "clientId", nativeField: "associatedClientId", note: "CWSP node id (e.g. L-192.168.0.196)" },
    { airpadField: "peerInstanceId", nativeField: "peerInstanceId", note: "`deviceInstanceId` / install id on wire" },
    { airpadField: "accessToken", nativeField: "accessToken", note: "Unified control / route token (query + acts)" },
    { airpadField: "identificationToken", nativeField: "identificationToken", note: "Native `cwsp.token` wire identification" },
    { airpadField: "clientAccessToken", nativeField: "clientAccessToken", note: "Optional inbound / reverse ACL token" },
    { airpadField: "wireTransport", nativeField: "wireTransport", note: "`ws`; legacy `socket.io` migrates to `ws`" },
    { airpadField: "routeTarget", nativeField: "destinationNodeIds (+ cwsp_route_*)", note: "Probe target; native encodes in connect prep" }
] as const;

/** Envelope profile on `/ws` query `cwspEnvelope` (forward-compatible v2). */
export const CWSP_WIRE_ENVELOPE_V2 = "v2";

/**
 * Android advertises `nativescript-cwsp` so endpoint logs can distinguish the shell; PWA AirPad often uses `airpad`.
 * Both are valid peers for the same CWSP coordinator actions (`mouse:*`, `keyboard:*`, `clipboard:*`).
 */
export const CWSP_NATIVE_SHELL_ARCHETYPE = "nativescript-cwsp";

export const CWSP_AIRPAD_PWA_ARCHETYPE = "airpad";

/** Narrow native settings shape used for import/export helpers (avoid platform deps in this module). */
export type CwspClientSettingsWireMirror = {
    wireTransport: "ws";
    relayHttpsUrl: string;
    directHttpsUrl: string;
    quickConnectValue: string;
    associatedClientId: string;
    peerInstanceId: string;
    identificationToken: string;
    destinationNodeIds: string;
    accessToken: string;
    clientAccessToken: string;
};

export function cwspClientSettingsToRemoteConnectionV1(settings: CwspClientSettingsWireMirror): CwspRemoteConnectionV1 {
    return {
        v: CWSP_REMOTE_CONNECTION_JSON_VERSION,
        endpointUrl: trimOrUndef(settings.relayHttpsUrl),
        directUrl: trimOrUndef(settings.directHttpsUrl),
        quickConnectValue: trimOrUndef(settings.quickConnectValue),
        destinationId: trimOrUndef(settings.destinationNodeIds),
        accessToken: trimOrUndef(settings.accessToken),
        clientId: trimOrUndef(settings.associatedClientId),
        peerInstanceId: trimOrUndef(settings.peerInstanceId),
        identificationToken: trimOrUndef(settings.identificationToken),
        clientAccessToken: trimOrUndef(settings.clientAccessToken),
        wireTransport: "ws"
    };
}

/**
 * Values to merge into native `CwspClientSettings` / ApplicationSettings. Only keys present in `blob` are set.
 */
export function remoteConnectionV1ToNativeSettingsPatch(blob: CwspRemoteConnectionV1): Partial<CwspClientSettingsWireMirror> {
    const out: Partial<CwspClientSettingsWireMirror> = {};
    const set = <K extends keyof CwspClientSettingsWireMirror>(
        key: K,
        val: CwspClientSettingsWireMirror[K] | undefined
    ): void => {
        if (val === undefined) return;
        out[key] = val;
    };
    if (blob.endpointUrl !== undefined) set("relayHttpsUrl", String(blob.endpointUrl || "").trim());
    if (blob.directUrl !== undefined) set("directHttpsUrl", String(blob.directUrl || "").trim());
    if (blob.quickConnectValue !== undefined) set("quickConnectValue", String(blob.quickConnectValue || "").trim());
    if (blob.destinationId !== undefined) set("destinationNodeIds", String(blob.destinationId || "").trim());
    if (blob.identificationToken !== undefined) set("identificationToken", String(blob.identificationToken || "").trim());
    if (blob.clientAccessToken !== undefined) set("clientAccessToken", String(blob.clientAccessToken || "").trim());
    if (blob.clientId !== undefined) set("associatedClientId", String(blob.clientId || "").trim());
    if (blob.peerInstanceId !== undefined) set("peerInstanceId", String(blob.peerInstanceId || "").trim());
    if (blob.wireTransport === "ws" || blob.wireTransport === "socket.io") set("wireTransport", "ws");

    const destProvided = blob.destinationId !== undefined;
    const rt = blob.routeTarget;
    if ((!destProvided || !String(blob.destinationId || "").trim()) && rt !== undefined) {
        set("destinationNodeIds", String(rt || "").trim());
    }

    if (blob.accessToken !== undefined) set("accessToken", String(blob.accessToken || "").trim());
    else if (blob.authToken !== undefined) set("accessToken", String(blob.authToken || "").trim());
    return out;
}

export function stringifyCwspRemoteConnectionV1(conn: CwspRemoteConnectionV1): string {
    return JSON.stringify({ ...conn, v: conn.v ?? CWSP_REMOTE_CONNECTION_JSON_VERSION });
}

export function parseCwspRemoteConnectionV1Json(raw: string): CwspRemoteConnectionV1 | null {
    try {
        const o = JSON.parse(raw) as unknown;
        if (!o || typeof o !== "object" || Array.isArray(o)) return null;
        return o as CwspRemoteConnectionV1;
    } catch {
        return null;
    }
}

function trimOrUndef(s: string): string | undefined {
    const t = String(s || "").trim();
    return t || undefined;
}

/** Full AirPad JSON blob mirrored in native `ApplicationSettings` for WebView ↔ NS sync. */
export const CWSP_AIRPAD_CONNECTION_JSON_KEY = "cwsp.airpadConnectionJson";

/** Monotonic revision written by {@code CwsBridgePlugin} after each settings patch. */
export const CWSP_SETTINGS_REVISION_MS_KEY = "cwsp.settingsRevisionMs";

function readNestedString(root: unknown, path: string[]): string | undefined {
    let cur: unknown = root;
    for (const key of path) {
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return trimOrUndef(String(cur ?? ""));
}

/**
 * Map CrossWord {@link AppSettings} (Settings UI / IDB) → {@link CwspRemoteConnectionV1} for native parity.
 */
export function appSettingsToRemoteConnectionV1(appSettings: Record<string, unknown>): CwspRemoteConnectionV1 {
    const core = (appSettings.core && typeof appSettings.core === "object" && !Array.isArray(appSettings.core))
        ? (appSettings.core as Record<string, unknown>)
        : {};
    const socket = (core.socket && typeof core.socket === "object" && !Array.isArray(core.socket))
        ? (core.socket as Record<string, unknown>)
        : {};

    const endpointUrl =
        readNestedString(appSettings, ["core", "endpointUrl"]) ||
        readNestedString(appSettings, ["core", "admin", "httpsOrigin"]);

    const accessToken =
        trimOrUndef(String(socket.accessToken ?? socket.airpadAuthToken ?? "")) ||
        undefined;

    const identificationToken =
        readNestedString(appSettings, ["core", "userKey"]) ||
        readNestedString(appSettings, ["core", "socket", "clientAccessToken"]) ||
        readNestedString(appSettings, ["core", "socket", "accessToken"]);

    return {
        v: CWSP_REMOTE_CONNECTION_JSON_VERSION,
        endpointUrl,
        directUrl: readNestedString(appSettings, ["core", "ops", "directUrl"]),
        quickConnectValue: readNestedString(appSettings, ["core", "network", "quickConnect"]),
        destinationId: readNestedString(appSettings, ["core", "socket", "routeTarget"]),
        routeTarget: readNestedString(appSettings, ["core", "socket", "routeTarget"]),
        accessToken,
        authToken: accessToken,
        clientId:
            readNestedString(appSettings, ["core", "socket", "selfId"]) ||
            readNestedString(appSettings, ["core", "userId"]) ||
            readNestedString(appSettings, ["core", "appClientId"]),
        peerInstanceId: readNestedString(appSettings, ["core", "appClientId"]),
        identificationToken,
        clientAccessToken: readNestedString(appSettings, ["core", "socket", "clientAccessToken"]),
        wireTransport: "ws"
    };
}

/** Shell toggles that have no field on {@link CwspRemoteConnectionV1} but map to native `CwspClientSettings`. */
export function appSettingsShellToNativeExtras(appSettings: Record<string, unknown>): Record<string, unknown> {
    const shell = (appSettings.shell && typeof appSettings.shell === "object" && !Array.isArray(appSettings.shell))
        ? (appSettings.shell as Record<string, unknown>)
        : {};
    const out: Record<string, unknown> = {};
    const shareDest = trimOrUndef(String(shell.clipboardShareDestinationIds ?? ""));
    if (shareDest !== undefined) out.shareIntentDestinationIds = shareDest;
    const inboundAllow = trimOrUndef(String(shell.clipboardInboundAllowIds ?? ""));
    if (inboundAllow !== undefined) out.allowClipboardReadFromIds = inboundAllow;
    if (shell.acceptInboundClipboardData !== undefined) {
        out.acceptInboundClipboard = (shell.acceptInboundClipboardData ?? true) !== false;
    }
    if (shell.accessTokenBypassesClipboardAllowlist !== undefined) {
        out.accessTokenBypassesIdPolicy = shell.accessTokenBypassesClipboardAllowlist === true;
    }
    if (shell.acceptContactsBridgeData !== undefined) {
        out.acceptContactsData = shell.acceptContactsBridgeData === true;
    }
    if (shell.acceptSmsBridgeData !== undefined) {
        out.acceptSmsData = shell.acceptSmsBridgeData === true;
    }
    return out;
}
