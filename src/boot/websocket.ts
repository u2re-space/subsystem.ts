/**
 * AirPad/remote transport hub for the frontend.
 *
 * This module owns the client-side WebSocket connection, secure-envelope
 * wrapping, coordinator ask/act flows, clipboard bridging, and the candidate
 * probing logic used to discover a reachable CWSP endpoint from web, PWA, or
 * extension contexts.
 *
 * AI-READ: this file is a compatibility layer, not only a raw websocket
 * wrapper. It preserves behavior for several runtimes whose network
 * restrictions differ, especially Chromium extension pages versus normal tabs.
 */

import { createWsSocket, NativeSocket, Socket } from './native-socket';
import { log, getWsStatusEl } from "views/airpad/utils/utils";
import {
    getRemoteHost,
    getAirPadEndpointUrl,
    getAirPadDirectTargetUrl,
    getRemoteProtocol,
    getRemoteRouteTarget,
    getAccessToken,
    getAssociatedClientToken,
    getAirPadTransportMode,
    getAirPadTransportSecret,
    getAirPadSigningSecret,
    getAirPadClientId,
    getAirPadPeerInstanceId,
    getClientAccessToken,
    isShellRemoteClipboardBridgeEnabled,
    isApplyRemoteClipboardToDeviceEnabled,
    isPushLocalClipboardToLanEnabled,
    getClipboardPushIntervalMs,
    getClipboardBroadcastWireTargets,
    isClipboardSenderAllowedForInbound,
    isNeutralinoNodeClipboardHubOwned,
    getAirPadHandshakeArchetype,
    getAirPadHandshakeConnectionType,
} from "views/airpad/config/config";
import { nativeShellOwnsExclusiveHubWebsocket } from "./hub-socket-boot";
import {
    isCapacitorNativeShell,
    readClipboardTextFromDevice,
    writeClipboardTextToDevice,
    writeClipboardImageToDevice,
} from "shared/native/clipboard-device";
import {
    CWSP_DEFAULT_HTTPS_PORTS,
    CWSP_DEFAULT_HTTP_PORTS,
    splitConnectHostList,
} from "cwsp-shared/cwsp-endpoint-resolve";
import { CWSP_WIRE_ENVELOPE_V2 } from "cwsp-shared/cws-client-wire-defaults";
import {
    annotateCoordinatorPayload,
    shouldAnnotateCoordinatorPayload
} from "cwsp-shared/input-command-timing";
import {
    annotatePacketWireHash,
    inferWireDedupeCategory,
    packetWireDedupeGuard
} from "cwsp-shared/packet-wire-hash";
import {
    DEFAULT_DESK_WIRE_NODE_ID,
    FLEET_GATEWAY_WIRE_NODE_ID,
    isAssociableFleetWireNodeId,
    isFleetDeskWireNodeId,
    isFleetGatewayWireNodeId,
    isGatewayHttpsOrigin,
    isGuestPrivateLanIpv4,
    isHomeFleetLanHost,
    isOffHomeFleetNetwork,
    normalizeWireNodeIdForWire,
    sanitizeFleetRouteTarget,
    sanitizeFleetSelfWireNodeId,
    isOnHomeFleetLanPageHost,
    shouldConnectViaFleetGateway,
    shouldFleetDeskGatewayProbeFallbacks,
    shouldPreferWanGatewayForAirpad,
} from "cwsp-shared/airpad-cwsp-client-parity";
import { annotatePacketWireTime64 } from "cwsp-shared/wire-time64";
import { setAirpadCredentialInvalidator } from "views/airpad/credential-cache-bridge";
import {
    isNativeCoordinatorConnected,
    refreshNativeCoordinatorStatus,
    sendNativeCoordinatorDispatch,
    sendNativeCoordinatorEnvelope,
    sendNativeCoordinatorBinary,
    shouldUseNativeCoordinatorTransport
} from "./native-coordinator-bridge";

let socket: Socket | null = null;
let wsConnected = false;
let isConnecting = false;

/**
 * Mirror live socket for page debuggers.
 * WHY: never touch bare `window` — in MV3 service workers that identifier throws
 * `ReferenceError: window is not defined` (even inside `typeof` guards after some bundlers).
 */
const mirrorSocketOnGlobal = (value: Socket | null): void => {
    try {
        const g = globalThis as typeof globalThis & {
            __socket?: Socket | null;
            window?: { __socket?: Socket | null };
        };
        g.__socket = value;
        const w = g.window;
        if (w) w.__socket = value;
    } catch {
        /* ignore */
    }
};
let btnEl: HTMLElement | null = null;
let wsConnectButton: HTMLElement | null = null;
let connectAttemptId = 0;
/** Parallel candidate probes — close all on success or disconnect. */
const activeProbeSockets = new Set<Socket>();
let manualDisconnectRequested = false;
let autoReconnectAttempts = 0;
let autoReconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
type WSConnectCandidate = {
    url: string;
    protocol: 'http' | 'https';
    host: string;
    source: 'remote' | 'page';
    port: string;
    privateLanHint: boolean;
};
let lastWsCandidates: WSConnectCandidate[] = [];
let nextWsCandidateOffset = 0;
const localNetworkPermissionProbeDone = new Set<string>();
// Keep retrying across NAT/Wi-Fi transitions; 0 means unlimited retries.
const AUTO_RECONNECT_MAX_ATTEMPTS = 0;
const AUTO_RECONNECT_BASE_DELAY_MS = 800;
/** WebSocket handshake timeout per candidate (dead hosts fail faster). */
const AIRPAD_PROBE_IO_TIMEOUT_MS = 4800;
/** Wall-clock cap per probe if connect_error is slow to fire. */
const AIRPAD_PROBE_HARD_CAP_MS = AIRPAD_PROBE_IO_TIMEOUT_MS + 800;
/** Try this many candidates in parallel; first success wins. */
const AIRPAD_CANDIDATE_PARALLEL = 3;
const AIRPAD_VERBOSE_QUERY_KEY = "CWS_AIRPAD_VERBOSE_QUERY";
/** Coordinator ask/act wait — was 12s, tighter for snappier UI. */
const AIRPAD_COORDINATOR_TIMEOUT_MS = 8000;

const clearAutoReconnectTimer = (): void => {
    if (!autoReconnectTimer) return;
    globalThis.clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
};

type ProbeSocketWithTimer = Socket & { __cwspProbeTimer?: ReturnType<typeof globalThis.setTimeout> };

const clearProbeTimer = (socketWithTimer: Socket): void => {
    const probe = socketWithTimer as ProbeSocketWithTimer;
    if (probe.__cwspProbeTimer) {
        globalThis.clearTimeout(probe.__cwspProbeTimer);
        delete probe.__cwspProbeTimer;
    }
};

/** CWSP v2 transport / route hint query keys (canonical `cwsp_*`; see network stack spec). */
const CWSP_ROUTE_QUERY = {
    via: "cwsp_via",
    localEndpoint: "cwsp_local_endpoint",
    route: "cwsp_route",
    routeTarget: "cwsp_route_target",
    hop: "cwsp_hop",
    host: "cwsp_host",
    target: "cwsp_target",
    targetPort: "cwsp_target_port",
    viaPort: "cwsp_via_port",
    protocol: "cwsp_protocol"
} as const;

const shouldUseVerboseAirpadQuery = (): boolean => {
    try {
        const local = String(globalThis?.localStorage?.getItem?.(AIRPAD_VERBOSE_QUERY_KEY) || "")
            .trim()
            .toLowerCase();
        if (["1", "true", "yes", "on"].includes(local)) return true;
    } catch {
        // Ignore localStorage access issues in restricted contexts.
    }
    const runtimeFlag = String((globalThis as any)?.[AIRPAD_VERBOSE_QUERY_KEY] || "")
        .trim()
        .toLowerCase();
    return ["1", "true", "yes", "on"].includes(runtimeFlag);
};

type WSConnectionHandler = (connected: boolean) => void;
const wsConnectionHandlers = new Set<WSConnectionHandler>();

// Clipboard state + listeners (PC clipboard as seen by backend)
let lastServerClipboardText = '';
type ClipboardUpdateHandler = (text: string, meta?: { source?: string }) => void;
const clipboardHandlers = new Set<ClipboardUpdateHandler>();
type VoiceResultHandler = (message: { text: string; type: "voice_result" | "voice_error"; actions?: unknown[]; error?: string }) => void;
const voiceResultHandlers = new Set<VoiceResultHandler>();

type AirPadTransportMode = "plaintext" | "secure";
type SignedEnvelope = { cipher: string; sig: string; from?: string };

type NetworkFetchRequest = {
    requestId?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
};
type NetworkFetchResponse = {
    ok: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
    error?: string;
    requestId?: string;
};

type CoordinatorPacket = {
    op?: "ask" | "act" | "resolve" | "result" | "error" | "signal" | "request" | "response" | "redirect" | "notify";
    what?: string;
    type?: string;
    purpose?: string;
    protocol?: string;
    transport?: string;
    payload?: any;
    nodes?: string[];
    destinations?: string[];
    uuid?: string;
    result?: any;
    results?: any;
    error?: any;
    byId?: string;
    from?: string;
    sender?: string;
    ids?: Record<string, unknown> | string[];
    urls?: string[];
    tokens?: string[];
    toRoles?: string[];
    flags?: Record<string, unknown>;
    status?: number;
    redirect?: boolean;
    token?: string;
    userKey?: string;
    /** Access / control token (unified wire name). */
    accessToken?: string;
    /** @deprecated Incoming only — use {@link accessToken}. */
    airpadToken?: string;
    timestamp?: number;
    [key: string]: unknown;
};

const FRAME_PROTOCOL_WS = "ws";
const WS_TRANSPORT = "ws";

const normalizeCoordinatorProtocol = (value: unknown): string => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return FRAME_PROTOCOL_WS;
    // COMPAT: old settings may still say socket.io; the active web rail is native /ws.
    if (raw === "ws" || raw === "wss" || raw === "socket" || raw === "socket.io" || raw === "socketio") return FRAME_PROTOCOL_WS;
    return raw;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let aesKeyCache = new Map<string, CryptoKey>();
let hmacKeyCache = new Map<string, CryptoKey>();

setAirpadCredentialInvalidator(() => {
    aesKeyCache.clear();
    hmacKeyCache.clear();
});
const coordinatorPending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeoutId: ReturnType<typeof globalThis.setTimeout>;
}>();
const queuedCoordinatorActs: CoordinatorPacket[] = [];
const MAX_QUEUED_COORDINATOR_ACTS = 128;

const flushQueuedCoordinatorActs = (): void => {
    if (!socket?.connected) return;
    while (queuedCoordinatorActs.length > 0) {
        const packet = queuedCoordinatorActs.shift();
        if (!packet) continue;
        emitCoordinatorPacket(packet);
    }
};

const isRealtimeInputAct = (what: string): boolean => {
    const normalized = String(what || "").trim().toLowerCase();
    return normalized === "mouse:move" || normalized === "mouse:scroll";
};

const ensureCoordinatorSocketConnected = async (timeoutMs = 7000): Promise<boolean> => {
    if (shouldUseNativeCoordinatorTransport()) {
        const connected = isNativeCoordinatorConnected() || (await refreshNativeCoordinatorStatus());
        return connected;
    }
    if (socket?.connected) return true;
    connectWS();
    return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (value: boolean) => {
            if (done) return;
            done = true;
            try {
                off?.();
            } catch {
                // ignore
            }
            globalThis.clearTimeout(timeoutId);
            resolve(value);
        };
        const off = onWSConnectionChange((connected) => {
            if (connected) finish(true);
        });
        const timeoutId = globalThis.setTimeout(() => finish(Boolean(socket?.connected)), timeoutMs);
    });
};

/** Return the current live WebSocket instance, if any. */
export function getWS(): Socket | null {
    return socket;
}

/** Report whether the primary transport socket is currently connected. */
export function isWSConnected(): boolean {
    if (shouldUseNativeCoordinatorTransport()) {
        return isNativeCoordinatorConnected();
    }
    return wsConnected;
}

/**
 * Subscribe to transport connectivity updates.
 *
 * WHY: several AirPad UI widgets and retry flows need a shared source of truth
 * without directly depending on the socket object.
 */
export function onWSConnectionChange(handler: WSConnectionHandler): () => void {
    wsConnectionHandlers.add(handler);
    try {
        handler(isWSConnected());
    } catch {
        // ignore subscriber errors
    }
    return () => wsConnectionHandlers.delete(handler);
}

/** Refresh UI + subscribers from live WebView socket or native {@code CwspRuntime} status. */
export async function refreshTransportConnectionStatus(): Promise<boolean> {
    if (shouldUseNativeCoordinatorTransport()) {
        const connected = await refreshNativeCoordinatorStatus();
        setWsStatus(connected);
        return connected;
    }
    const connected = Boolean(wsConnected || socket?.connected);
    setWsStatus(connected);
    return connected;
}

/** Force UI/subscribers to disconnected when native bridge reload failed before a status refresh is trustworthy. */
export function markTransportDisconnected(): void {
    setWsStatus(false);
}

export function getLastServerClipboard(): string {
    return lastServerClipboardText;
}

export function onServerClipboardUpdate(handler: ClipboardUpdateHandler): () => void {
    clipboardHandlers.add(handler);
    return () => clipboardHandlers.delete(handler);
}

export function onVoiceResult(handler: VoiceResultHandler): () => void {
    voiceResultHandlers.add(handler);
    return () => voiceResultHandlers.delete(handler);
}

function notifyClipboardHandlers(text: string, meta?: { source?: string }) {
    for (const h of clipboardHandlers) {
        try {
            h(text, meta);
        } catch {
            // ignore UI handler errors
        }
    }
}

/** Suppress echo when applying remote text to the device clipboard vs. push polling. */
const CLIPBOARD_ECHO_SUPPRESS_MS = 3500;
let lastClipboardPushSent = "";
let lastClipboardPushSentAt = 0;
let lastClipboardWrittenFromRemote = "";
let clipboardEchoSuppressUntil = 0;
let lastInboundClipboardNormalized = "";
let lastInboundClipboardAt = 0;

let clipboardPushIntervalId: ReturnType<typeof setInterval> | null = null;

const stopClipboardPushLoop = (): void => {
    if (clipboardPushIntervalId) {
        globalThis.clearInterval(clipboardPushIntervalId);
        clipboardPushIntervalId = null;
    }
};

const startClipboardPushLoop = (): void => {
    stopClipboardPushLoop();
    if (!isPushLocalClipboardToLanEnabled() || !isShellRemoteClipboardBridgeEnabled()) return;
    const ms = getClipboardPushIntervalMs();
    clipboardPushIntervalId = globalThis.setInterval(() => {
        void tickLocalClipboardPush();
    }, ms);
};

async function tickLocalClipboardPush(): Promise<void> {
    if (!socket?.connected) return;
    if (!isShellRemoteClipboardBridgeEnabled() || !isPushLocalClipboardToLanEnabled()) return;
    const entries = getClipboardBroadcastWireTargets();
    if (!entries.length) return;
    try {
        const text = await readClipboardTextFromDevice();
        const t = String(text ?? "").trim();
        if (!t) return;
        const now = Date.now();
        if (now < clipboardEchoSuppressUntil && t === lastClipboardWrittenFromRemote) return;
        if (t === lastClipboardPushSent && now - lastClipboardPushSentAt < CLIPBOARD_ECHO_SUPPRESS_MS) return;
        lastClipboardPushSent = t;
        lastClipboardPushSentAt = now;
        const groups = groupWireTargetsByAccessToken(entries, getWireAccessToken());
        for (const g of groups) {
            sendCoordinatorAct("clipboard:update", { text: t }, g.nodeIds, {
                accessToken: g.accessToken
            });
        }
    } catch {
        // Permission or transient read failure
    }
}

async function applyIncomingClipboardText(text: string, meta?: { source?: string }): Promise<void> {
    if (!isShellRemoteClipboardBridgeEnabled()) return;
    const t = typeof text === "string" ? text : "";
    const normalized = t.trim();
    if (normalized.toLowerCase().startsWith("data:image/")) {
        await applyIncomingClipboardImage({ mimeType: "image/png", data: normalized }, meta);
        return;
    }
    const now = Date.now();
    if (
        normalized &&
        normalized === lastInboundClipboardNormalized &&
        now - lastInboundClipboardAt < CLIPBOARD_ECHO_SUPPRESS_MS
    ) {
        return;
    }
    lastInboundClipboardNormalized = normalized;
    lastInboundClipboardAt = now;
    lastServerClipboardText = t;
    notifyClipboardHandlers(t, meta);
    if (!isApplyRemoteClipboardToDeviceEnabled() || !normalized) return;
    if (normalized === lastClipboardWrittenFromRemote && now < clipboardEchoSuppressUntil) return;
    try {
        await writeClipboardTextToDevice(normalized);
        lastClipboardWrittenFromRemote = normalized;
        lastClipboardPushSent = normalized;
        lastClipboardPushSentAt = now;
        clipboardEchoSuppressUntil = now + CLIPBOARD_ECHO_SUPPRESS_MS;
    } catch (error) {
        console.warn("[cwsp:clipboard] device write failed", {
            length: t.length,
            source: meta?.source,
            error: describeError(error)
        });
    }
}

async function applyIncomingClipboardImage(
    asset: ClipboardAssetWire,
    meta?: { source?: string }
): Promise<void> {
    if (!isShellRemoteClipboardBridgeEnabled()) return;
    const data = String(asset.data ?? "").trim();
    if (!data) return;
    const mimeType = String(asset.mimeType || "image/png").trim() || "image/png";
    const dedupeKey = asset.hash?.trim() || data.slice(0, 96);
    const now = Date.now();
    if (
        dedupeKey &&
        dedupeKey === lastInboundClipboardNormalized &&
        now - lastInboundClipboardAt < CLIPBOARD_ECHO_SUPPRESS_MS
    ) {
        return;
    }
    lastInboundClipboardNormalized = dedupeKey;
    lastInboundClipboardAt = now;
    notifyClipboardHandlers("", meta);
    if (!isApplyRemoteClipboardToDeviceEnabled()) return;
    if (dedupeKey === lastClipboardWrittenFromRemote && now < clipboardEchoSuppressUntil) return;
    try {
        await writeClipboardImageToDevice(data, mimeType, asset.hash);
        lastClipboardWrittenFromRemote = dedupeKey;
        lastClipboardPushSent = dedupeKey;
        lastClipboardPushSentAt = now;
        clipboardEchoSuppressUntil = now + CLIPBOARD_ECHO_SUPPRESS_MS;
    } catch (error) {
        console.warn("[cwsp:clipboard] device image write failed", {
            mimeType,
            hash: asset.hash,
            source: meta?.source,
            error: describeError(error)
        });
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

const extractClipboardText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "body"] as const) {
        const direct = record[key];
        if (typeof direct === "string") return direct;
    }
    if (typeof record.result === "string") return record.result;
    const nested = record.payload ?? record.data;
    if (nested && nested !== value) {
        const inner = extractClipboardText(nested);
        if (inner) return inner;
    }
    return "";
};

const isInboundClipboardWhat = (what: string): boolean => {
    const normalized = String(what || "").trim().toLowerCase();
    return (
        normalized === "clipboard:update" ||
        normalized === "clipboard:write" ||
        normalized.startsWith("airpad:clipboard:")
    );
};

const extractClipboardTextFromPacket = (packet: CoordinatorPacket): string => {
    const payload = packet.payload ?? packet.data ?? packet.result ?? packet.results;
    const fromPayload = extractClipboardText(payload);
    if (fromPayload) return fromPayload;
    return extractClipboardText(packet);
};

type ClipboardAssetWire = { hash?: string; mimeType: string; data: string };

const extractClipboardAssetFromPacket = (packet: CoordinatorPacket): ClipboardAssetWire | null => {
    const carriers = [packet.payload, packet.data, packet.result, packet.results, packet];
    for (const carrier of carriers) {
        if (!carrier || typeof carrier !== "object") continue;
        const rec = carrier as Record<string, unknown>;
        const asset = rec.asset ?? rec.dataAsset ?? rec.file ?? rec.image;
        if (!asset || typeof asset !== "object") continue;
        const row = asset as Record<string, unknown>;
        const data = typeof row.data === "string" ? row.data.trim() : "";
        if (!data) continue;
        const mimeType =
            (typeof row.mimeType === "string" && row.mimeType.trim()) ||
            (typeof row.type === "string" && row.type.trim()) ||
            "image/png";
        if (!mimeType.toLowerCase().startsWith("image/")) continue;
        const hash = typeof row.hash === "string" ? row.hash.trim() : "";
        return { hash, mimeType, data };
    }
    return null;
};

const getCoordinatorPacketSenderId = (packet: unknown): string => {
    const p = packet as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== "object") return "";
    return String(p.from || p.byId || p.sender || "").trim();
};

const inferPacketPurpose = (what: string): string => {
    const normalized = String(what || "").trim().toLowerCase();
    if (normalized.startsWith("clipboard:")) return "clipboard";
    if (normalized.startsWith("files:")) return "storage";
    if (normalized.startsWith("mouse:")) return "mouse";
    if (normalized.startsWith("keyboard:")) return "input";
    if (normalized.startsWith("airpad:")) return "airpad";
    if (normalized.startsWith("sms:")) return "sms";
    if (normalized.startsWith("contacts:")) return "contact";
    if (normalized.startsWith("notification:") || normalized.startsWith("notifications:")) return "general";
    return "general";
};

const describeError = (error: unknown): string => {
    if (!error) return String(error);
    if (typeof error === "string") return error;
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return safeJson(error);
};

function getTransportMode(): AirPadTransportMode {
    return getAirPadTransportMode() === "secure" ? "secure" : "plaintext";
}

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array | null => {
    try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
};

const isSignedEnvelope = (value: unknown): value is SignedEnvelope =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).cipher === "string" &&
    typeof (value as any).sig === "string";

const toSafeObject = (value: unknown): any => {
    if (!value || typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value);
        return parsed;
    } catch {
        return null;
    }
};

const shouldAutoReconnectAfterDisconnect = (reason?: string): boolean => {
    if (!reason) {
        return true;
    }
    if (reason === "io client disconnect" || reason === "forced close") {
        return false;
    }
    return true;
};

const shouldRotateCandidateOnDisconnect = (reason?: string): boolean => {
    if (!reason) return true;
    if (reason === "io server disconnect" || reason === "io client disconnect") return false;
    return true;
};

const getSecret = (): string => (getAirPadTransportSecret() || "").trim();
const getSigningSecret = (): string => (getAirPadSigningSecret() || "").trim();
const getClientId = (): string => {
    const sanitized = sanitizeFleetSelfWireNodeId((getAirPadClientId() || "").trim());
    return sanitized || "airpad-client";
};
const getClientToken = (): string => (getAssociatedClientToken() || "").trim();
const getWireAccessToken = (): string => (getAccessToken() || "").trim();
const getCoordinatorNodes = (): string[] => {
    return wireTargetNodeIds(parseWireTargetList(getRemoteRouteTarget().trim()));
};
const nextPacketId = (): string => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `airpad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isCoordinatorPacket = (value: unknown): value is CoordinatorPacket => {
    return !!value && typeof value === "object" && (
        "op" in (value as Record<string, unknown>) ||
        "what" in (value as Record<string, unknown>) ||
        "uuid" in (value as Record<string, unknown>) ||
        "result" in (value as Record<string, unknown>) ||
        "error" in (value as Record<string, unknown>)
    );
};

const mapFrameOpToRuntimeOp = (value: CoordinatorPacket["op"]): CoordinatorPacket["op"] => {
    if (value === "request") return "ask";
    if (value === "response") return "result";
    if (value === "signal" || value === "notify" || value === "redirect") return "act";
    return value;
};

const mapRuntimeOpToFrameOp = (value: CoordinatorPacket["op"]): CoordinatorPacket["op"] => {
    return value;
};

const toCanonicalCoordinatorPacket = (packet: CoordinatorPacket): CoordinatorPacket => {
    const clientId = getClientId();
    const clientToken = getClientToken();
    const fromPacket =
        typeof packet.accessToken === "string" && packet.accessToken.trim()
            ? packet.accessToken.trim()
            : typeof packet.airpadToken === "string" && packet.airpadToken.trim()
              ? packet.airpadToken.trim()
              : "";
    const wireAccessToken = fromPacket || getWireAccessToken();
    const sender = String(packet.sender || packet.byId || packet.from || clientId || "").trim() || undefined;
    const from = String(packet.from || sender || "").trim() || undefined;
    const byId = String(packet.byId || sender || "").trim() || undefined;
    const destinations = Array.isArray(packet.destinations) && packet.destinations.length
        ? packet.destinations
        : Array.isArray(packet.nodes)
          ? packet.nodes
          : getCoordinatorNodes();
    const uuid = typeof packet.uuid === "string" && packet.uuid.trim()
        ? packet.uuid.trim()
        : nextPacketId();
    const now = Date.now();
    return {
        ...packet,
        op: mapRuntimeOpToFrameOp(packet.op),
        type: String(packet.type || packet.what || "").trim() || packet.what,
        protocol: normalizeCoordinatorProtocol(packet.protocol),
        transport: String(packet.transport || WS_TRANSPORT).trim() || WS_TRANSPORT,
        purpose: String(packet.purpose || inferPacketPurpose(String(packet.what || packet.type || ""))).trim() || "general",
        sender,
        byId,
        from,
        nodes: destinations,
        destinations,
        ids: typeof packet.ids === "object" && packet.ids != null
            ? packet.ids
            : {
                byId,
                from,
                sender,
                destinations,
            },
        urls: Array.isArray(packet.urls) && packet.urls.length ? packet.urls : [getRemoteHost()],
        tokens: Array.isArray(packet.tokens) && packet.tokens.length ? packet.tokens : (clientToken ? [clientToken] : []),
        token: packet.token || clientToken || undefined,
        userKey: typeof packet.userKey === "string" && packet.userKey.trim()
            ? packet.userKey
            : clientToken || undefined,
        accessToken: wireAccessToken || undefined,
        flags: { ...(packet.flags as Record<string, unknown> | undefined), canonicalV2: true },
        uuid,
        timestamp: Number(packet.timestamp || 0) > 0 ? Number(packet.timestamp) : now,
    };
    return annotatePacketWireHash(base as Record<string, unknown>) as CoordinatorPacket;
};

const handleCoordinatorPacket = async (packet: CoordinatorPacket): Promise<void> => {
    const op = mapFrameOpToRuntimeOp(packet.op);
    const what = (packet.what || packet.type || "").trim();
    const uuid = typeof packet.uuid === "string" ? packet.uuid : "";
    if (uuid && coordinatorPending.has(uuid)) {
        const pending = coordinatorPending.get(uuid);
        if (pending) {
            clearTimeout(pending.timeoutId);
            coordinatorPending.delete(uuid);
            if (op === "error" || packet.error !== undefined) {
                pending.reject(packet.error ?? { ok: false, error: "Unknown coordinator error" });
            } else {
                pending.resolve(packet.result ?? packet.results);
            }
        }
        return;
    }

    if (op === "ask" && what === "clipboard:get") {
        try {
            const text = await readClipboardTextFromDevice();
            emitCoordinatorPacket({
                ...buildCoordinatorPacket("result", what, null, {
                    uuid,
                    nodes: packet.from ? [packet.from] : undefined
                }),
                result: typeof text === "string" ? text : String(text || "")
            });
        } catch (error: any) {
            emitCoordinatorPacket({
                ...buildCoordinatorPacket("error", what, null, {
                    uuid,
                    nodes: packet.from ? [packet.from] : undefined
                }),
                error: error?.message || String(error)
            });
        }
        return;
    }

    if (op === "act" && what) {
        const category = isInboundClipboardWhat(what)
            ? "clipboard"
            : inferWireDedupeCategory(what);
        if (packetWireDedupeGuard.shouldSuppress(packet as Record<string, unknown>, category)) {
            return;
        }
    }

    if (isInboundClipboardWhat(what)) {
        if (!isClipboardSenderAllowedForInbound(getCoordinatorPacketSenderId(packet))) {
            return;
        }
        const clipboardPayload = packet.payload ?? packet.data ?? packet.result ?? packet.results;
        const asset = extractClipboardAssetFromPacket(packet);
        if (asset) {
            void applyIncomingClipboardImage(asset, {
                source: typeof clipboardPayload === "object" && clipboardPayload
                    ? String((clipboardPayload as Record<string, unknown>).source || "")
                    : undefined
            });
            return;
        }
        const text = extractClipboardTextFromPacket(packet);
        void applyIncomingClipboardText(text, {
            source: typeof clipboardPayload === "object" && clipboardPayload
                ? String((clipboardPayload as Record<string, unknown>).source || "")
                : undefined
        });
        return;
    }

    // WHY: inbound files:offer (desk → phone) — route to the Capacitor files-hub
    // inbound listener (which forwards to the Java notification bridge) and emit
    // a web heads-up toast. The files-hub owns accept/decline; this is the minimal
    // W4 notification surface. Bare wildcard senders are not auto-accepted here.
    if (what === "files:offer" || what === "files:error") {
        const filesPayload = packet.payload ?? packet.data ?? packet.result ?? packet.results;
        try {
            globalThis.dispatchEvent(new CustomEvent("cws:filesIncomingOffer", {
                detail: {
                    what,
                    payload: filesPayload,
                    sender: getCoordinatorPacketSenderId(packet),
                    uuid,
                    from: packet.from
                }
            }));
        } catch {
            /* best-effort dispatch */
        }
        return;
    }
};

/** Emit one already-built coordinator packet if the live socket is ready. */
const emitCoordinatorPacket = (packet: CoordinatorPacket): boolean => {
    if (shouldUseNativeCoordinatorTransport()) {
        const what = String(packet.what || packet.type || "");
        const payload = packet.payload ?? packet.data ?? {};
        const nodes = Array.isArray(packet.nodes) ? packet.nodes.map(String) : undefined;
        const op = packet.op === "ask" || packet.op === "request" ? "ask" : "act";
        void sendNativeCoordinatorEnvelope({
            op,
            what,
            payload,
            nodes,
            uuid: typeof packet.uuid === "string" ? packet.uuid : undefined
        });
        return isNativeCoordinatorConnected();
    }
    if (!socket || !socket.connected) return false;
    socket.send(toCanonicalCoordinatorPacket(packet));
    return true;
};

/** Normalize the frontend's higher-level action/request inputs into the shared coordinator packet shape. */
const buildCoordinatorPacket = (
    op: NonNullable<CoordinatorPacket["op"]>,
    what: string,
    payload: any,
    options: { nodes?: string[]; uuid?: string; accessToken?: string } = {}
): CoordinatorPacket => {
    const clientId = getClientId();
    const clientToken = getClientToken();
    const accessTok =
        options.accessToken !== undefined
            ? String(options.accessToken).trim() || getWireAccessToken()
            : getWireAccessToken();
    return annotatePacketWireHash(
        annotatePacketWireTime64({
        op: mapRuntimeOpToFrameOp(op),
        what,
        type: what,
        purpose: inferPacketPurpose(what),
        protocol: FRAME_PROTOCOL_WS,
        transport: WS_TRANSPORT,
        payload,
        nodes: options.nodes ?? getCoordinatorNodes(),
        destinations: options.nodes ?? getCoordinatorNodes(),
        uuid: options.uuid,
        sender: clientId,
        byId: clientId,
        from: clientId,
        ids: {
            byId: clientId,
            from: clientId,
            sender: clientId,
            destinations: options.nodes ?? getCoordinatorNodes(),
        },
        urls: [getRemoteHost()],
        tokens: clientToken ? [clientToken] : [],
        flags: { canonicalV2: true },
        token: clientToken || undefined,
        userKey: clientToken || undefined,
        accessToken: accessTok || undefined,
        timestamp: Date.now()
        })
    ) as CoordinatorPacket;
};

const getAesKey = async (secret: string): Promise<CryptoKey | null> => {
    if (!secret || !globalThis.crypto?.subtle) return null;
    if (aesKeyCache.has(secret)) return aesKeyCache.get(secret) || null;
    const material = textEncoder.encode(secret);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", material);
    const key = await globalThis.crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
    aesKeyCache.set(secret, key);
    return key;
};

const getHmacKey = async (secret: string): Promise<CryptoKey | null> => {
    if (!secret || !globalThis.crypto?.subtle) return null;
    if (hmacKeyCache.has(secret)) return hmacKeyCache.get(secret) || null;
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign", "verify"]
    );
    hmacKeyCache.set(secret, key);
    return key;
};

const buildSignedEnvelope = async (payload: unknown): Promise<SignedEnvelope> => {
    const payloadJson = safeJson(payload);
    const payloadBytes = textEncoder.encode(payloadJson);
    const secret = getSecret();
    const signingSecret = getSigningSecret();

    let cipher = toBase64(payloadBytes);
    if (secret && globalThis.crypto?.subtle) {
        const key = await getAesKey(secret);
        if (key) {
            const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = new Uint8Array(
                await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payloadBytes)
            );
            const merged = new Uint8Array(iv.length + encrypted.length);
            merged.set(iv, 0);
            merged.set(encrypted, iv.length);
            cipher = toBase64(merged);
        }
    }

    const cipherBytesForSig = textEncoder.encode(cipher);
    let sig = toBase64(cipherBytesForSig);
    if (signingSecret && globalThis.crypto?.subtle) {
        const key = await getHmacKey(signingSecret);
        if (key) {
            const signature = new Uint8Array(
                await globalThis.crypto.subtle.sign(
                    {
                        name: "HMAC"
                    },
                    key,
                    cipherBytesForSig
                )
            );
            sig = toBase64(signature);
        }
    }

    return { cipher, sig, from: getClientId() };
};

const unwrapSignedPayload = async (envelope: SignedEnvelope): Promise<any> => {
    if (!isSignedEnvelope(envelope)) return envelope;
    const secret = getSecret();
    const cipherBytes = fromBase64(envelope.cipher);
    if (!cipherBytes) return envelope;
    if (!secret || !globalThis.crypto?.subtle) {
        const decodedText = textDecoder.decode(cipherBytes);
        return toSafeObject(decodedText) ?? envelope;
    }

    const key = await getAesKey(secret);
    if (!key) return envelope;
    if (cipherBytes.length < 28) {
        const decodedText = textDecoder.decode(cipherBytes);
        return toSafeObject(decodedText) ?? envelope;
    }

    const iv = cipherBytes.slice(0, 12);
    const encrypted = cipherBytes.slice(12);
    try {
        const decrypted = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
        const decodedText = textDecoder.decode(decrypted);
        return toSafeObject(decodedText) ?? envelope;
    } catch {
        return envelope;
    }
};

const wrapObjectForTransport = async (payload: any): Promise<any> => {
    if (getTransportMode() !== "secure" || typeof payload !== "object" || payload === null) {
        return payload;
    }

    const envelope = await buildSignedEnvelope(payload);
    return {
        ...payload,
        mode: "secure",
        payload: envelope
    };
};

const emitPayload = (value: any): void => {
    if (!socket || !socket.connected) return;
    socket.send(value);
};

const emitSignedObjectMessage = async (payload: any): Promise<void> => {
    const wrapped = await wrapObjectForTransport(payload);
    emitPayload(wrapped);
};

const unwrapIncomingPayload = async (payload: any): Promise<any> => {
    if (!isSignedEnvelope(payload)) return payload;
    if (getTransportMode() !== "secure") return payload;
    return unwrapSignedPayload(payload);
};

/** Strip `L-` node id prefix (e.g. `L-192.168.0.110` → `192.168.0.110`) for IP / LNA checks. */
function stripWireEndpointIdPrefix(host: string): string {
    const t = host.trim();
    return /^l-/i.test(t) ? t.slice(2).trim() : t;
}

/** Loopback labels that are invalid as CWSP route hints when dialing a LAN page origin. */
function isLoopbackHost(host: string): boolean {
    const b = stripWireEndpointIdPrefix(host.trim()).toLowerCase();
    return b === "localhost" || b === "127.0.0.1" || b === "::1";
}

function isPrivateOrLocalTarget(host: string): boolean {
    if (!host) return false;
    const bare = stripWireEndpointIdPrefix(host);
    if (bare === 'localhost' || host === 'localhost') return true;
    if (host.endsWith('.local')) return true;
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return false;
    return (
        bare.startsWith('10.') ||
        bare.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(bare) ||
        bare.startsWith('127.') ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(bare)
    );
}

const getCurrentOriginHostname = (): string => {
    try {
        return String(new URL(location.href).hostname).toLowerCase();
    } catch {
        return "";
    }
};

const isNetworkFetchAllowed = (rawUrl: string): boolean => {
    if (!rawUrl || typeof rawUrl !== "string") return false;
    let parsed: URL;
    try {
        parsed = new URL(rawUrl, location.href);
    } catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;
    const localPageHost = getCurrentOriginHostname();
    return isPrivateOrLocalTarget(host) || host === "localhost" || host === localPageHost;
};

const normalizeNetworkFetchHeaders = (headers?: Record<string, string>): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!headers) return next;
    for (const [key, value] of Object.entries(headers)) {
        if (typeof key !== "string" || !key.trim()) continue;
        if (typeof value !== "string") continue;
        next[key] = value;
    }
    return next;
};

const responseHeadersToObject = (value: Headers): Record<string, string> => {
    const result: Record<string, string> = {};
    value.forEach((headerValue, headerName) => {
        result[headerName] = headerValue;
    });
    return result;
};

const handleServerNetworkFetchRequest = async (request: NetworkFetchRequest): Promise<NetworkFetchResponse> => {
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    const method = typeof request?.method === "string" ? request.method.toUpperCase() : "GET";
    const url = typeof request?.url === "string" ? request.url : "";
    const timeoutMsRaw = request && typeof request.timeoutMs === "number" ? request.timeoutMs : 12000;
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.min(Math.max(Math.round(timeoutMsRaw), 1000), 60000) : 12000;
    if (!requestId) {
        return {
            ok: false,
            status: 400,
            statusText: "Bad Request",
            error: "Missing requestId",
        };
    }
    if (!isNetworkFetchAllowed(url)) {
        return {
            requestId,
            ok: false,
            status: 400,
            statusText: "Bad Request",
            error: "URL not allowed",
        };
    }

    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = normalizeNetworkFetchHeaders(request?.headers as Record<string, string>);
        const hasBody = !["GET", "HEAD"].includes(method);
        const payload = request?.body;
        const body = hasBody ? (typeof payload === "string" ? payload : safeJson(payload)) : undefined;
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
        });
        const responseBody = await response.text();
        return {
            requestId,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeadersToObject(response.headers),
            body: responseBody,
        };
    } catch (error: unknown) {
        return {
            requestId,
            ok: false,
            status: 0,
            statusText: "Network Error",
            error: describeError(error),
        };
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Best-effort Chrome Local Network Access warm-up for private-IP targets.
 *
 * WHY: probing `/lna-probe` early makes permission/PNA failures visible before
 * the heavier WebSocket candidate rotation starts reporting generic timeouts.
 */
async function tryRequestLocalNetworkPermission(origin: string, host: string): Promise<void> {
    if (!origin || !host) return;
    if (!isPrivateOrLocalTarget(host)) return;
    if (location.protocol !== 'https:') return;
    if (localNetworkPermissionProbeDone.has(origin)) return;

    localNetworkPermissionProbeDone.add(origin);
    try {
        // Best-effort warm-up for Chrome Local Network Access permission flow.
        // `targetAddressSpace` is currently experimental and may be ignored by some browsers.
        await fetch(`${origin}/lna-probe`, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            credentials: 'omit',
            // TS libs may not include this yet.
            ...( { targetAddressSpace: 'local' } as any ),
        } as RequestInit);
    } catch (error: any) {
        const msg = String(error?.message || error || '');
        log(`LNA probe: ${msg || 'request failed'}`);
    }
}

const coordinatorWirePayload = (what: string, payload: unknown): unknown => {
    if (!shouldAnnotateCoordinatorPayload(what)) return payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    return annotateCoordinatorPayload(payload as Record<string, unknown>);
};

/** Fire-and-forget coordinator action. */
export function sendCoordinatorAct(
    what: string,
    payload: any,
    nodes?: string[],
    opts?: { accessToken?: string }
): boolean {
    const wirePayload = coordinatorWirePayload(what, payload);
    const packet = buildCoordinatorPacket("act", what, wirePayload, { nodes, accessToken: opts?.accessToken });
    if (emitCoordinatorPacket(packet)) {
        return true;
    }
    if (isRealtimeInputAct(what)) {
        // PERF: relative AirPad deltas are only useful live. Queueing them while
        // WS reconnects causes burst replay, cursor twitching, and stale control.
        connectWS();
        return false;
    }
    if (queuedCoordinatorActs.length >= MAX_QUEUED_COORDINATOR_ACTS) {
        queuedCoordinatorActs.shift();
    }
    queuedCoordinatorActs.push(packet);
    connectWS();
    return true;
}

/** Send compact binary AirPad frame when JSON act would be heavier (Java/CWSP legacy path). */
export function sendWsBinary(data: ArrayBuffer | Uint8Array): boolean {
    if (shouldUseNativeCoordinatorTransport()) {
        void sendNativeCoordinatorBinary(data);
        return isNativeCoordinatorConnected();
    }
    if (!socket?.connected) return false;
    const sock = socket as NativeSocket & { sendBinary?: (d: ArrayBuffer | Uint8Array) => void };
    if (typeof sock.sendBinary === "function") {
        sock.sendBinary(data);
        return true;
    }
    return false;
}

/** Send a request/response-style coordinator ask and wait for one correlated reply. */
export function sendCoordinatorAsk(what: string, payload: any, nodes?: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        void (async () => {
            if (shouldUseNativeCoordinatorTransport()) {
                try {
                    const connected = await ensureCoordinatorSocketConnected();
                    if (!connected) {
                        reject({ ok: false, error: "Native WS not connected" });
                        return;
                    }
                    const result = await sendNativeCoordinatorDispatch({ op: "ask", what, payload: coordinatorWirePayload(what, payload), nodes });
                    resolve(result);
                } catch (error) {
                    reject({ ok: false, error: String((error as Error)?.message || error) });
                }
                return;
            }
            const connected = await ensureCoordinatorSocketConnected();
            if (!connected || !socket?.connected) {
                reject({ ok: false, error: "WS not connected" });
                return;
            }
            const uuid = nextPacketId();
            const timeoutId = globalThis.setTimeout(() => {
                coordinatorPending.delete(uuid);
                reject({ ok: false, error: `Timeout waiting for ${what}` });
            }, AIRPAD_COORDINATOR_TIMEOUT_MS);
            coordinatorPending.set(uuid, { resolve, reject, timeoutId });
            emitCoordinatorPacket(buildCoordinatorPacket("ask", what, coordinatorWirePayload(what, payload), { nodes, uuid }));
        })();
    });
}

/** Legacy request helper that currently routes through the same transport path as `act`. */
export function sendCoordinatorRequest(what: string, payload: any, nodes?: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        void (async () => {
            if (shouldUseNativeCoordinatorTransport()) {
                try {
                    const connected = await ensureCoordinatorSocketConnected();
                    if (!connected) {
                        reject({ ok: false, error: "Native WS not connected" });
                        return;
                    }
                    const result = await sendNativeCoordinatorDispatch({
                        op: "act",
                        what,
                        payload: coordinatorWirePayload(what, payload),
                        nodes
                    });
                    resolve(result);
                } catch (error) {
                    reject({ ok: false, error: String((error as Error)?.message || error) });
                }
                return;
            }
            const connected = await ensureCoordinatorSocketConnected();
            if (!connected || !socket?.connected) {
                reject({ ok: false, error: "WS not connected" });
                return;
            }
            const uuid = nextPacketId();
            const timeoutId = globalThis.setTimeout(() => {
                coordinatorPending.delete(uuid);
                reject({ ok: false, error: `Timeout waiting for ${what}` });
            }, AIRPAD_COORDINATOR_TIMEOUT_MS);
            coordinatorPending.set(uuid, { resolve, reject, timeoutId });
            emitCoordinatorPacket(
                buildCoordinatorPacket("act", what, coordinatorWirePayload(what, payload), { nodes, uuid })
            );
        })();
    });
}

function updateButtonLabel() {
    if (!btnEl) return;
    if (isConnecting || (socket && socket.connected === false)) {
        btnEl.textContent = 'WS…';
        return;
    }
    if (wsConnected || (socket && socket.connected)) {
        btnEl.textContent = 'WS ✓';
    } else {
        btnEl.textContent = 'WS ↔';
    }
}

function logWsState(event: string, payload: string) {
    const trimmedPayload = payload.trim();
    log(`[ws-state] event=${event}${trimmedPayload ? ` ${trimmedPayload}` : ""}`);
}

const WS_STATUS_TLS_HINT_CLASS = 'ws-status-tls-hint';

function setWsStatusTlsHint(originUrl: string) {
    const wsStatusEl = getWsStatusEl();
    if (!wsStatusEl) return;
    const native = isCapacitorNativeShell();
    wsStatusEl.textContent = native
        ? `TLS failed — install your CA in Android Settings → Security → Encryption & credentials (or use Remote host = name on the cert). Try HTTP :8080 if the server allows. ${originUrl}`
        : `Untrusted cert — open ${originUrl} in this browser, accept, then retry`;
    wsStatusEl.classList.add(WS_STATUS_TLS_HINT_CLASS);
    wsStatusEl.classList.remove('ws-status-ok');
    wsStatusEl.classList.add('ws-status-bad');
}

/** When the server cert is issued for a hostname, https://&lt;public-ip&gt; fails before the user can "trust" it. */
function setWsStatusTlsHostnameHint(hostname: string) {
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
        wsStatusEl.textContent =
            `TLS name mismatch for raw IP — set Remote host to ${hostname} (name on certificate), keep ports as needed`;
        wsStatusEl.classList.add(WS_STATUS_TLS_HINT_CLASS);
        wsStatusEl.classList.remove('ws-status-ok');
        wsStatusEl.classList.add('ws-status-bad');
    }
}

function setWsStatus(connected: boolean) {
    wsConnected = connected;
    if (connected) {
        flushQueuedCoordinatorActs();
    }
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
        wsStatusEl.classList.remove(WS_STATUS_TLS_HINT_CLASS);
        if (connected) {
            wsStatusEl.textContent = 'connected';
            wsStatusEl.classList.remove('ws-status-bad');
            wsStatusEl.classList.add('ws-status-ok');
        } else {
            wsStatusEl.textContent = 'disconnected';
            wsStatusEl.classList.remove('ws-status-ok');
            wsStatusEl.classList.add('ws-status-bad');
        }
    }
    updateButtonLabel();

    for (const handler of wsConnectionHandlers) {
        try {
            handler(connected);
        } catch {
            // ignore subscriber errors
        }
    }
}

function handleServerMessage(msg: any) {
    if (msg.type === 'voice_result' || msg.type === 'voice_error') {
        const text =
            msg.error ||
            msg.message ||
            ('Actions: ' + JSON.stringify(msg.actions || []));
        for (const handler of voiceResultHandlers) {
            try {
                handler({
                    text,
                    type: msg.type === "voice_error" ? "voice_error" : "voice_result",
                    actions: msg.actions,
                    error: msg.error
                });
            } catch {
                // ignore subscriber errors
            }
        }
        log('Voice result: ' + text);
    }
}

/**
 * Tear down the hub transport and immediately run a fresh {@link connectWS} probe.
 * Used when the PWA returns from background / bfcache: OS often kills WebSockets while
 * a soft resume reconnect restores endpoint clipboard/coordinator without requiring a manual WS tap.
 */
export function reconnectTransportAfterLifecycleResume(reason: string): void {
    // WHY: bare `typeof window` is fine at runtime in SW, but prefer globalThis.window
    // so lifecycle reconnect never runs outside a real browsing document.
    if (!(globalThis as { window?: unknown }).window) return;
    // WHY: Control SPA saves via paired Control RPC — never probe wss://cwsp.u2re.space/ws.
    try {
        const surface = String(document.documentElement?.dataset?.cwspSurface || "").toLowerCase();
        const host = String(location.hostname || "").toLowerCase();
        if (
            surface === "cwsp-control" ||
            host === "cwsp.u2re.space" ||
            host === "www.cwsp.u2re.space"
        ) {
            logWsState("lifecycle-reconnect-skip-control-spa", reason);
            return;
        }
    } catch {
        /* continue */
    }
    logWsState("lifecycle-reconnect", reason);
    stopClipboardPushLoop();
    clearAutoReconnectTimer();
    connectAttemptId += 1;
    manualDisconnectRequested = false;
    for (const [uuid, pending] of coordinatorPending.entries()) {
        clearTimeout(pending.timeoutId);
        pending.reject({ ok: false, error: `Disconnected before response for ${uuid}` });
        coordinatorPending.delete(uuid);
    }
    for (const probe of [...activeProbeSockets]) {
        clearProbeTimer(probe);
        probe.removeAllListeners();
        probe.close();
        activeProbeSockets.delete(probe);
    }
    isConnecting = false;
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch {
            /* */
        }
    }
    socket = null;
    mirrorSocketOnGlobal(null);
    setWsStatus(false);
    autoReconnectAttempts = 0;
    packetWireDedupeGuard.clear();
    connectWS();
}

/**
 * Probe candidate origins and establish the primary WebSocket transport.
 *
 * AI-READ: this function is intentionally large because it combines UI-state
 * updates, candidate generation, PNA/LNA warm-up, TLS hints, and reconnect
 * behavior for browser tabs, extensions, and native shells.
 */
export function connectWS() {
    // WHY: public Control SPA must never dial page-host /ws (not a CWSP hub).
    try {
        const surface = String(document.documentElement?.dataset?.cwspSurface || "").toLowerCase();
        const host = String(location.hostname || "").toLowerCase();
        if (
            surface === "cwsp-control" ||
            host === "cwsp.u2re.space" ||
            host === "www.cwsp.u2re.space"
        ) {
            log("WS skip: Control SPA — use paired Control RPC, not browser hub /ws");
            return;
        }
    } catch {
        /* continue */
    }
    // WHY: Neutralino/WebNative Node clipboard-hub already holds `/ws` as L-110.
    // A second browser WebSocket with the same clientId kicks the hub → clipboard dies.
    if (isNeutralinoNodeClipboardHubOwned()) {
        log("WS skip: Node clipboard-hub owns fleet /ws (WebView must not connect)");
        return;
    }
    // WHY: Capacitor Java CwspBridgeService owns `/ws` — AirPad uses CwsBridge coordinator:*.
    if (nativeShellOwnsExclusiveHubWebsocket()) {
        log("WS skip: Java CwspBridgeService owns fleet /ws (WebView must not connect)");
        return;
    }
    if (isConnecting) return;
    if (socket && (socket.connected || (socket as any).connecting)) return;
    if (activeProbeSockets.size > 0) return;
    clearAutoReconnectTimer();
    connectAttemptId += 1;
    const attemptId = connectAttemptId;
    manualDisconnectRequested = false;

    const remoteHost = getRemoteHost().trim();
    const endpointUrlForConnect = getAirPadEndpointUrl().trim();
    const resolvedRemoteHost = remoteHost || endpointUrlForConnect || "";
    const remoteProtocol = getRemoteProtocol();
    const isIpv4Literal = (host: string): boolean =>
        !!host && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

    const isPrivateIp = (host: string): boolean => {
        if (!host) return false;
        if (!isIpv4Literal(host)) return false;
        return (
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
            /** CGNAT / Tailscale-style 100.64.0.0/10 */
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
        );
    };

    /**
     * HTTPS probe order: LAN / private IPs first (where CWSP admin usually listens), then DNS names
     * from **remote** settings, then **page** origin (PWA shell). Putting `u2re.space` last avoids
     * timeouts and PNA noise when the real gateway is 192.168.x.x only.
     */
    const isHomeFleetPrivateIpv4 = (host: string): boolean =>
        isIpv4Literal(host) && host.startsWith("192.168.0.");

    const isFleetLanGatewayHost = (host: string): boolean => {
        const bare = stripWireEndpointIdPrefix(host).trim().toLowerCase();
        return bare === "192.168.0.200";
    };
    const isFleetWanGatewayHost = (host: string): boolean => {
        const bare = stripWireEndpointIdPrefix(host).trim().toLowerCase();
        return bare.includes("45.147.");
    };
    const isFleetIngressGatewayHost = (host: string): boolean =>
        isFleetLanGatewayHost(host) || isFleetWanGatewayHost(host);

    const pageHostEarly = location.hostname || "";
    const pageBareEarly = stripWireEndpointIdPrefix(pageHostEarly) || pageHostEarly;
    const offHomeFleet = isOffHomeFleetNetwork(pageBareEarly);
    const configuredRouteTargetRaw = getRemoteRouteTarget().trim();
    const configuredRouteTarget =
        sanitizeFleetRouteTarget(configuredRouteTargetRaw, endpointUrlForConnect || remoteHost) ||
        configuredRouteTargetRaw;
    const routedViaFleetGateway = shouldConnectViaFleetGateway(
        endpointUrlForConnect || remoteHost,
        configuredRouteTarget
    );
    const fleetDeskGatewayProbe = shouldFleetDeskGatewayProbeFallbacks(
        configuredRouteTarget,
        endpointUrlForConnect || remoteHost,
        getAirPadDirectTargetUrl()
    );
    const onHomeFleetPage = isOnHomeFleetLanPageHost(pageBareEarly);
    const preferWanGatewayProbeFirst =
        offHomeFleet ||
        isGuestPrivateLanIpv4(pageBareEarly) ||
        shouldPreferWanGatewayForAirpad(endpointUrlForConnect, pageBareEarly) ||
        (routedViaFleetGateway && !onHomeFleetPage) ||
        (isGatewayHttpsOrigin(endpointUrlForConnect) && offHomeFleet);

    const reorderHostEntriesForHttps = (
        entries: Array<{ host: string; source: WSConnectCandidate['source']; preferPort?: string }>
    ) => {
        const dnsRemote: typeof entries = [];
        const dnsPage: typeof entries = [];
        const homeFleetIpv4: typeof entries = [];
        const lanGatewayIpv4: typeof entries = [];
        const wanGatewayIpv4: typeof entries = [];
        const publicIpv4: typeof entries = [];
        const guestPrivateIpv4: typeof entries = [];
        for (const e of entries) {
            if (!isIpv4Literal(e.host)) {
                if (e.source === 'page') dnsPage.push(e);
                else dnsRemote.push(e);
            } else if (isFleetLanGatewayHost(e.host)) {
                lanGatewayIpv4.push(e);
            } else if (isFleetWanGatewayHost(e.host)) {
                wanGatewayIpv4.push(e);
            } else if (isHomeFleetPrivateIpv4(e.host) || e.host === '127.0.0.1') {
                homeFleetIpv4.push(e);
            } else if (isPrivateIp(e.host)) {
                guestPrivateIpv4.push(e);
            } else {
                publicIpv4.push(e);
            }
        }
        if (preferWanGatewayProbeFirst) {
            return [
                ...wanGatewayIpv4,
                ...lanGatewayIpv4,
                ...dnsRemote,
                ...publicIpv4,
                ...homeFleetIpv4,
                ...dnsPage,
                ...guestPrivateIpv4
            ];
        }
        if (onHomeFleetPage) {
            return [
                ...homeFleetIpv4,
                ...lanGatewayIpv4,
                ...wanGatewayIpv4,
                ...dnsRemote,
                ...dnsPage,
                ...publicIpv4,
                ...guestPrivateIpv4
            ];
        }
        return [
            ...wanGatewayIpv4,
            ...lanGatewayIpv4,
            ...homeFleetIpv4,
            ...dnsRemote,
            ...dnsPage,
            ...publicIpv4,
            ...guestPrivateIpv4
        ];
    };

    const isLikelyPort = (value: string): boolean => /^\d{1,5}$/.test(value);
    const stripProtocol = (value: string): string => {
        const trimmed = value.trim();
        return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
    };
    const parseHostAndPort = (value: string): { host: string; port?: string } | null => {
        const hostSpec = stripProtocol(value).trim();
        if (!hostSpec) return null;
        const at = hostSpec.lastIndexOf(":");
        if (at <= 0) {
            return { host: hostSpec };
        }
        const host = hostSpec.slice(0, at);
        const port = hostSpec.slice(at + 1);
        if (!host || !isLikelyPort(port)) return { host: hostSpec };
        return { host, port };
    };
    let remoteHostSpecs = splitConnectHostList(remoteHost)
        .map((entry) => parseHostAndPort(entry))
        .filter((entry): entry is { host: string; port?: string } => !!entry && !!entry.host);
    if (offHomeFleet && isGatewayHttpsOrigin(endpointUrlForConnect) && !routedViaFleetGateway) {
        const filtered = remoteHostSpecs.filter((spec) => {
            const bare = stripWireEndpointIdPrefix(spec.host).trim();
            if (!bare) return false;
            if (isFleetIngressGatewayHost(bare)) return true;
            if (isIpv4Literal(bare) && isHomeFleetPrivateIpv4(bare)) return false;
            return true;
        });
        if (filtered.length) remoteHostSpecs = filtered;
    }
    if (!remoteHostSpecs.length && endpointUrlForConnect) {
        const endpointSpec = parseHostAndPort(endpointUrlForConnect);
        if (endpointSpec?.host) {
            remoteHostSpecs = [endpointSpec];
        }
    }
    const firstExplicitPort = (remoteHostSpecs[0]?.port || '').trim();
    const remotePort = firstExplicitPort;
    const parsedConfiguredRouteTarget = configuredRouteTarget ? parseHostAndPort(configuredRouteTarget) : undefined;
    const pageHost = pageHostEarly;
    const isLocalPageHost = /^(localhost|127\.0\.0\.1)$/.test(pageHost) || (
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(pageHost) &&
        (
            pageHost.startsWith('10.') ||
            pageHost.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(pageHost)
        )
    );
    if (location.protocol === 'https:' && remoteProtocol === 'http' && !isCapacitorNativeShell()) {
        log('WebSocket error: browser blocks ws/http from https page (mixed content). Open Airpad via http:// or use valid HTTPS cert on endpoint.');
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
        return;
    }

    const remoteHostSpec = remoteHostSpecs[0];
    const parsedRemoteHost = remoteHostSpec?.host || resolvedRemoteHost;
    const parsedRemotePort = remoteHostSpec?.port;
    const routeTargetForQuery = (() => {
        if (isFleetGatewayWireNodeId(configuredRouteTarget)) {
            return normalizeWireNodeIdForWire(configuredRouteTarget);
        }
        if (isFleetGatewayWireNodeId(configuredRouteTargetRaw)) {
            return normalizeWireNodeIdForWire(configuredRouteTargetRaw);
        }
        if (isFleetDeskWireNodeId(configuredRouteTarget)) {
            return normalizeWireNodeIdForWire(configuredRouteTarget);
        }
        if (isAssociableFleetWireNodeId(configuredRouteTarget)) {
            return normalizeWireNodeIdForWire(configuredRouteTarget);
        }
        if (routedViaFleetGateway && isFleetDeskWireNodeId(configuredRouteTargetRaw)) {
            return normalizeWireNodeIdForWire(configuredRouteTargetRaw);
        }
        if (
            fleetDeskGatewayProbe ||
            isGatewayHttpsOrigin(endpointUrlForConnect) ||
            isGatewayHttpsOrigin(remoteHost)
        ) {
            return DEFAULT_DESK_WIRE_NODE_ID;
        }
        const parsedHost = parsedConfiguredRouteTarget?.host || "";
        if (parsedHost && isHomeFleetLanHost(parsedHost)) {
            return normalizeWireNodeIdForWire(parsedHost);
        }
        if (parsedHost) return parsedHost;
        if (configuredRouteTarget) return configuredRouteTarget;
        return "";
    })();
    const routeTargetPortForQuery = (parsedConfiguredRouteTarget?.port || "").trim();

    const rawProbeHostEarly = (parsedRemoteHost || resolvedRemoteHost || "").trim();
    const firstHostBare =
        rawProbeHostEarly.length > 0
            ? stripWireEndpointIdPrefix(rawProbeHostEarly) || rawProbeHostEarly
            : "";
    const firstHostIpv4 = (() => {
        const b = firstHostBare.trim();
        if (!b) return "";
        const at = b.lastIndexOf(":");
        if (at > 0 && isLikelyPort(b.slice(at + 1))) return b.slice(0, at);
        return b;
    })();

    const inferProtocol = (): 'http' | 'https' => {
        if (remoteProtocol === 'http' || remoteProtocol === 'https') return remoteProtocol;
        if (remotePort === '443' || remotePort === '8434' || remotePort === '8444') return 'https';
        if (remotePort === '80' || remotePort === '8080' || remotePort === '8081') return 'http';
        // Capacitor WebView on https://localhost blocks ws:// (mixed content) even when cleartext HTTP is allowed.
        if (
            isCapacitorNativeShell() &&
            location.protocol === 'https:' &&
            firstHostIpv4 &&
            isIpv4Literal(firstHostIpv4) &&
            isPrivateIp(firstHostIpv4)
        ) {
            return 'https';
        }
        if (
            isCapacitorNativeShell() &&
            location.protocol !== 'https:' &&
            firstHostIpv4 &&
            isIpv4Literal(firstHostIpv4) &&
            isPrivateIp(firstHostIpv4)
        ) {
            return 'http';
        }
        return location.protocol === 'https:' ? 'https' : 'http';
    };

    const primaryProtocol = inferProtocol();
    const rawProbeHost = rawProbeHostEarly;
    const probeHost = stripWireEndpointIdPrefix(rawProbeHost) || rawProbeHost;
    const probePort = remotePort || (primaryProtocol === 'https' ? '8434' : '8080');
    const probeOrigin = `${primaryProtocol}://${probeHost}:${probePort}`;
    void tryRequestLocalNetworkPermission(probeOrigin, probeHost);
    // WHY: Connect URL often defaults to localhost while the tab is https://192.168.x.x — probe the real page host for PNA/LNA too.
    if (pageHost && isLoopbackHost(probeHost) && !isLoopbackHost(pageHost) && isPrivateOrLocalTarget(pageHost)) {
        const pageProbeHost = stripWireEndpointIdPrefix(pageHost) || pageHost;
        const pageProbeOrigin = `${primaryProtocol}://${pageProbeHost}:${probePort}`;
        void tryRequestLocalNetworkPermission(pageProbeOrigin, pageProbeHost);
    }
    const fallbackProtocol = primaryProtocol === 'https' ? 'http' : 'https';
    const defaultPortsByProtocol = {
        http: [...CWSP_DEFAULT_HTTP_PORTS],
        https: [...CWSP_DEFAULT_HTTPS_PORTS],
    } as const;
    const locationPort = location.port?.trim?.() || '';
    /** Default 443/80 when `location.port` is empty — used to prefer same-origin WS on unified HTTPS entrypoints. */
    const pageEffectivePort =
        locationPort ||
        (location.protocol === "https:" ? "443" : location.protocol === "http:" ? "80" : "");

    const protocolOrder = remoteProtocol === 'http'
        ? (['http'] as const)
        : remoteProtocol === 'https'
            ? (['https'] as const)
            : ([primaryProtocol, fallbackProtocol] as const);

    const isLikelyHttpsPort = (port: string): boolean =>
        (CWSP_DEFAULT_HTTPS_PORTS as readonly string[]).includes(port);
    const isLikelyHttpPort = (port: string): boolean =>
        (CWSP_DEFAULT_HTTP_PORTS as readonly string[]).includes(port);

    const getPortsForProtocol = (protocol: 'http' | 'https', preferredPort?: string) => {
        const ports: string[] = [];
        const explicitPort =
            (preferredPort && isLikelyPort(preferredPort) ? preferredPort : "") ||
            (remotePort && isLikelyPort(remotePort) ? remotePort : "");

        // WHY: Connect URL already names a port (e.g. https://127.0.0.1:8434). Fan-out across
        // CWSP_DEFAULT_HTTPS_PORTS made CRX probe :9443/:8445/:7443 → ERR_CONNECTION_REFUSED noise
        // while the real hub is only on :8434 (same as Neutralino).
        if (explicitPort) {
            if (protocol === "https") {
                if (
                    isLikelyHttpsPort(explicitPort) ||
                    remoteProtocol === "https" ||
                    remoteProtocol === "auto"
                ) {
                    ports.push(explicitPort);
                }
            } else if (
                isLikelyHttpPort(explicitPort) ||
                remoteProtocol === "http" ||
                remoteProtocol === "auto"
            ) {
                ports.push(explicitPort);
            }
            if (!ports.length && remoteProtocol === protocol) {
                ports.push(explicitPort);
            }
            if (ports.length) {
                return ports.filter((port, idx) => ports.indexOf(port) === idx);
            }
        }

        // No explicit port on the Connect URL — discover via standard CWSP port lists.
        for (const defaultPort of defaultPortsByProtocol[protocol]) {
            ports.push(defaultPort);
        }
        if (locationPort) ports.push(locationPort);
        return ports.filter((port, idx) => ports.indexOf(port) === idx);
    };

    const connectHostFromRemote = (h: string): string => {
        const t = stripWireEndpointIdPrefix(h.trim());
        return t || h.trim();
    };

    const hostEntries: Array<{ host: string; source: WSConnectCandidate['source']; preferPort?: string }> = [];
    for (const remoteHostSpecEntry of remoteHostSpecs) {
        const ch = connectHostFromRemote(remoteHostSpecEntry.host);
        if (!ch) continue;
        hostEntries.push({
            host: ch,
            source: "remote",
            preferPort: remoteHostSpecEntry.port
        });
    }
    if (remoteHostSpecs.length === 0 && remoteHost) {
        const ch = connectHostFromRemote(remoteHost);
        if (ch) {
            hostEntries.push({
                host: ch,
                source: "remote"
            });
        }
    }

    /** Hostnames the user configured for the transport (Connect URL), lowercased. */
    const normalizedRemoteHosts = new Set<string>();
    for (const spec of remoteHostSpecs) {
        if (spec.host) normalizedRemoteHosts.add(spec.host.toLowerCase());
    }
    if (remoteHostSpecs.length === 0 && remoteHost.trim()) {
        for (const part of splitConnectHostList(remoteHost.trim())) {
            const parsed = parseHostAndPort(part);
            if (parsed?.host) normalizedRemoteHosts.add(parsed.host.toLowerCase());
        }
    }

    /**
     * If the user configured **any** LAN / local transport host, skip adding `location.hostname`
     * unless it is already listed as a remote host. (Connect URL may list both 192.168.x.x and a
     * public name — we still drop the redundant **page** copy of u2re.space when remotes already
     * include a private gateway.)
     */
    const hasPrivateOrLocalTransportHost = (): boolean => {
        for (const h of normalizedRemoteHosts) {
            const bare = stripWireEndpointIdPrefix(h).toLowerCase();
            if (bare === "localhost" || bare === "127.0.0.1") return true;
            if (isIpv4Literal(bare) && isPrivateIp(bare)) return true;
        }
        return false;
    };
    const pageHostnameLower = pageHost.toLowerCase();
    const pageBareForGuest = stripWireEndpointIdPrefix(pageHost) || pageHost;
    const pageProtocol = String(location.protocol || "").toLowerCase();
    // WHY: chrome-extension://<id>/ hostname is the extension id — not dialable (ERR_NAME_NOT_RESOLVED).
    const skipExtensionPageOrigin =
        pageProtocol === "chrome-extension:" ||
        pageProtocol === "moz-extension:" ||
        pageProtocol === "safari-web-extension:" ||
        /^[a-p]{32}$/.test(pageHostnameLower);
    const skipGuestPageOrigin =
        Boolean(pageHostnameLower) &&
        isGuestPrivateLanIpv4(pageBareForGuest) &&
        !normalizedRemoteHosts.has(pageHostnameLower);
    const skipPageOriginForDirectLan =
        Boolean(pageHost) &&
        normalizedRemoteHosts.size > 0 &&
        hasPrivateOrLocalTransportHost() &&
        !isLocalPageHost &&
        !normalizedRemoteHosts.has(pageHostnameLower);
    const skipOffFleetLoopbackPage =
        offHomeFleet &&
        Boolean(pageHost) &&
        isLoopbackHost(pageHost);

    if (
        location.hostname &&
        !skipExtensionPageOrigin &&
        !skipPageOriginForDirectLan &&
        !skipGuestPageOrigin &&
        !skipOffFleetLoopbackPage
    ) {
        hostEntries.push({
            host: location.hostname,
            source: "page",
            ...(pageEffectivePort ? { preferPort: pageEffectivePort } : {})
        });
    }
    const uniqueHostEntries = new Map<string, { host: string; source: WSConnectCandidate['source']; preferPort?: string }>();
    for (const entry of hostEntries) {
        if (entry.host && !uniqueHostEntries.has(entry.host)) {
            uniqueHostEntries.set(entry.host, entry);
        }
    }
    const candidateHostEntries = Array.from(uniqueHostEntries.values());
    const httpsOrderedHostEntries = reorderHostEntriesForHttps(candidateHostEntries);

    const candidates: WSConnectCandidate[] = [];
    /** WebView mixed-content blocks `ws:` from `https:` origins — use native Java /ws or `wss:` only. */
    const allowHttpSocketFromHttpsShell = false;
    for (const protocol of protocolOrder) {
        if (location.protocol === 'https:' && protocol === 'http' && !allowHttpSocketFromHttpsShell) continue;
        const hostList = protocol === 'https' ? httpsOrderedHostEntries : candidateHostEntries;
        for (const hostEntry of hostList) {
            const { host, source, preferPort } = hostEntry;
            /* Same hostname as the tab: prefer the tab port only when Connect URL did not name a
             * different port. WHY: public Fastify :443 (/cwsp) ≠ CWSP :8434 on the same IP —
             * rewriting 8434→443 made wss://host/ws hit the wrong server. */
            const hostPortOverride =
                pageHost &&
                host === pageHost &&
                pageEffectivePort &&
                (!preferPort || preferPort === pageEffectivePort)
                    ? pageEffectivePort
                    : preferPort;
            for (const port of getPortsForProtocol(protocol, hostPortOverride)) {
                const hostBare = stripWireEndpointIdPrefix(host).trim() || host.trim();
                const hostLooksPrivate = isIpv4Literal(hostBare) && isPrivateIp(hostBare);
                const crossOriginHttpsToPrivateLan =
                    location.protocol === "https:" && !isLocalPageHost && hostLooksPrivate;
                const nativeShell = isCapacitorNativeShell();
                const privateLanHint =
                    (nativeShell && hostLooksPrivate) ||
                    (location.protocol === "https:" && isLocalPageHost && hostLooksPrivate) ||
                    (crossOriginHttpsToPrivateLan && hostLooksPrivate);
                candidates.push({
                    url: `${protocol}://${host}:${port}`,
                    protocol,
                    host,
                    source,
                    port,
                    privateLanHint
                });
            }
        }
    }
    const deduplicatedCandidates = candidates.filter((item, idx) => candidates.findIndex((x) => x.url === item.url) === idx);
    if (deduplicatedCandidates.length === 0) {
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
        return;
    }

    const normalizedOffset = deduplicatedCandidates.length > 0 ? nextWsCandidateOffset % deduplicatedCandidates.length : 0;
    const uniqueCandidates = deduplicatedCandidates
        .slice(normalizedOffset)
        .concat(deduplicatedCandidates.slice(0, normalizedOffset));
    nextWsCandidateOffset = normalizedOffset;
    lastWsCandidates = uniqueCandidates;
    if (lastWsCandidates.length <= 1) {
        nextWsCandidateOffset = 0;
    }

    const rotateCandidate = () => {
        if (lastWsCandidates.length > 1) {
            nextWsCandidateOffset = (nextWsCandidateOffset + 1) % lastWsCandidates.length;
        }
    };

    isConnecting = true;
    updateButtonLabel();

    const maxRounds = 3;
    const retryDelayMs = 450;
    const targetHost = connectHostFromRemote(parsedRemoteHost || remoteHost || "");
    const targetPort =
        routeTargetPortForQuery ||
        parsedRemotePort ||
        remotePort ||
        (primaryProtocol === "https" ? "8434" : "8080");
    const routeTarget = routeTargetForQuery;
    const resolvedRouteTarget = routeTarget || targetHost || "";

    const isSameAsTargetHost = (): boolean => {
        if (!targetHost) return true;
        const normalizedRoute = normalizeWireNodeIdForWire(routeTarget);
        if (!normalizedRoute) {
            return !isFleetIngressGatewayHost(targetHost);
        }
        const normalizedTargetHost = targetHost.trim().toLowerCase();
        const routeBare = stripWireEndpointIdPrefix(normalizedRoute).toLowerCase();
        if (!routeBare || !normalizedTargetHost) return true;
        if (routeBare === normalizedTargetHost) return true;
        if (normalizedRoute.toLowerCase() === `l-${normalizedTargetHost}`) return true;
        if (isAssociableFleetWireNodeId(normalizedRoute) && routeBare !== normalizedTargetHost) {
            return false;
        }
        return false;
    };

    const buildHandshakeForCandidate = (candidate: WSConnectCandidate) => {
        const url = candidate.url;
        const clientToken = getClientToken();
        const accessToken = getWireAccessToken();
        const clientAccessToken = getClientAccessToken();
        const clientId = getClientId();
        const peerInstanceId = getAirPadPeerInstanceId().trim();
        const handshakeAuth: Record<string, string> = {};
        if (clientToken) {
            handshakeAuth.token = clientToken;
            handshakeAuth.userKey = clientToken;
        }
        if (accessToken) {
            handshakeAuth.accessToken = accessToken;
        }
        if (clientAccessToken) {
            handshakeAuth.clientAccessToken = clientAccessToken;
        }
        if (clientId) {
            handshakeAuth.clientId = clientId;
        }
        if (peerInstanceId) {
            handshakeAuth.peerInstanceId = peerInstanceId;
            handshakeAuth.deviceInstanceId = peerInstanceId;
        }

        const queryParams: Record<string, string> = {};
        if (peerInstanceId) {
            queryParams.peerInstanceId = peerInstanceId;
            queryParams.deviceInstanceId = peerInstanceId;
        }
        queryParams.connectionType = getAirPadHandshakeConnectionType();
        queryParams.archetype = getAirPadHandshakeArchetype();
        queryParams.cwspEnvelope = CWSP_WIRE_ENVELOPE_V2;
        if (clientId) {
            queryParams.clientId = clientId;
            queryParams.userId = clientId;
        }
        if (clientToken) {
            queryParams.token = clientToken;
            queryParams.userKey = clientToken;
        }
        queryParams[CWSP_ROUTE_QUERY.via] = !isSameAsTargetHost() ? "tunnel" : candidate.source || "unknown";
        queryParams[CWSP_ROUTE_QUERY.localEndpoint] = isSameAsTargetHost() ? "1" : "0";
        const inferredDeskRoute =
            routeTarget ||
            (isFleetGatewayWireNodeId(configuredRouteTargetRaw)
                ? FLEET_GATEWAY_WIRE_NODE_ID
                : "") ||
            // WHY: do NOT invent desk L-110 when connecting to the gateway — desk may be offline;
            // phone↔phone routes use configured destinations / routeTarget only.
            "";
        let effectiveRoute = inferredDeskRoute || resolvedRouteTarget;
        let effectiveRouteTarget = inferredDeskRoute || routeTarget || targetHost || resolvedRouteTarget;
        const candBare = stripWireEndpointIdPrefix(candidate.host || "").trim();
        const pageBare = stripWireEndpointIdPrefix(pageHost || "").trim();
        if (
            candidate.source === "page" &&
            candBare &&
            pageBare &&
            candBare.toLowerCase() === pageBare.toLowerCase() &&
            isLoopbackHost(effectiveRoute)
        ) {
            effectiveRoute = candBare;
            effectiveRouteTarget = candBare;
        }
        if (effectiveRoute) {
            queryParams[CWSP_ROUTE_QUERY.route] = effectiveRoute;
            queryParams[CWSP_ROUTE_QUERY.routeTarget] = effectiveRouteTarget;
        }
        if (shouldUseVerboseAirpadQuery()) {
            queryParams[CWSP_ROUTE_QUERY.hop] = candidate.host || remoteHost || "unknown";
            queryParams[CWSP_ROUTE_QUERY.host] = candidate.host || remoteHost || "";
            queryParams[CWSP_ROUTE_QUERY.target] = targetHost || "";
            queryParams[CWSP_ROUTE_QUERY.targetPort] = targetPort;
            queryParams[CWSP_ROUTE_QUERY.viaPort] = candidate.port || "";
            queryParams[CWSP_ROUTE_QUERY.protocol] = candidate.protocol || "https";
        }
        if (clientAccessToken) {
            queryParams.clientAccessToken = clientAccessToken;
        }
        if (accessToken) {
            queryParams.accessToken = accessToken;
        }

        return { url, clientToken, accessToken, clientId, peerInstanceId, handshakeAuth, queryParams };
    };

    const finalizeConnectedSocket = (
        probeSocket: Socket,
        candidate: WSConnectCandidate,
        index: number,
        url: string,
    ) => {
        socket = probeSocket;
        logWsState(
            "connected",
            `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} transport=${candidate.protocol} parallel=${AIRPAD_CANDIDATE_PARALLEL}`
        );
        isConnecting = false;
        autoReconnectAttempts = 0;
        clearAutoReconnectTimer();
        setWsStatus(true);
        startClipboardPushLoop();

        socket.on("disconnect", (reason?: string) => {
            stopClipboardPushLoop();
            logWsState(
                "disconnected",
                `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${reason || "unknown"}`
            );
            isConnecting = false;
            setWsStatus(false);
            updateButtonLabel();

            const manual = manualDisconnectRequested;
            manualDisconnectRequested = false;
            for (const [uuid, pending] of coordinatorPending.entries()) {
                clearTimeout(pending.timeoutId);
                pending.reject({ ok: false, error: `Disconnected before response for ${uuid}` });
                coordinatorPending.delete(uuid);
            }
            socket = null;
            if (manual) {
                autoReconnectAttempts = 0;
                return;
            }

            if (shouldRotateCandidateOnDisconnect(reason)) {
                rotateCandidate();
                if (lastWsCandidates.length > 1) {
                    log(`WebSocket disconnect reason "${reason || "unknown"}", trying next candidate on reconnect`);
                }
            }

            const attempt = autoReconnectAttempts + 1;
            const hasMaxAttemptLimit = AUTO_RECONNECT_MAX_ATTEMPTS > 0;
            if (!shouldAutoReconnectAfterDisconnect(reason) || (hasMaxAttemptLimit && attempt > AUTO_RECONNECT_MAX_ATTEMPTS)) {
                return;
            }

            autoReconnectAttempts = attempt;
            const delay = Math.min(AUTO_RECONNECT_BASE_DELAY_MS * attempt, 5000);
            clearAutoReconnectTimer();
            autoReconnectTimer = globalThis.setTimeout(() => {
                autoReconnectTimer = null;
                if (isConnecting || wsConnected || (socket && socket.connected) || (socket as any)?.connecting) {
                    return;
                }
                const attemptLabel = hasMaxAttemptLimit
                    ? `${attempt}/${AUTO_RECONNECT_MAX_ATTEMPTS}`
                    : `${attempt}/unlimited`;
                logWsState("auto-reconnect", `attempt=${attemptLabel} reason=${reason || "unknown reason"}`);
                connectWS();
            }, delay);
        });

        socket.on("connect_error", (error) => {
            logWsState(
                "socket-connect-error",
                `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${error?.message || "unknown"}`
            );
            isConnecting = false;
            updateButtonLabel();
        });

        socket.on("voice_result", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            handleServerMessage(decoded);
        });
        socket.on("voice_error", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            handleServerMessage(decoded);
        });

        socket.on("clipboard:update", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            const sender = getCoordinatorPacketSenderId(decoded);
            if (!isClipboardSenderAllowedForInbound(sender)) {
                return;
            }
            const asset = extractClipboardAssetFromPacket(decoded as CoordinatorPacket);
            if (asset) {
                void applyIncomingClipboardImage(asset, { source: decoded?.source });
                return;
            }
            const text = extractClipboardTextFromPacket(decoded as CoordinatorPacket);
            void applyIncomingClipboardText(text, { source: decoded?.source });
        });
        socket.on("data", async (packet: any) => {
            const decoded = await unwrapIncomingPayload(packet);
            if (!isCoordinatorPacket(decoded)) return;
            handleCoordinatorPacket(decoded);
        });
        socket.on("message", async (packet: any) => {
            const decoded = await unwrapIncomingPayload(packet);
            if (!isCoordinatorPacket(decoded)) return;
            handleCoordinatorPacket(decoded);
        });
        socket.on("network.fetch", async (request: NetworkFetchRequest, ack?: (value: NetworkFetchResponse | Error) => void) => {
            const response = await handleServerNetworkFetchRequest(request);
            if (typeof ack === "function") {
                ack(response);
            }
        });

        mirrorSocketOnGlobal(socket);
    };

    const probeBatch = (startIndex: number, round: number): Promise<boolean> =>
        new Promise((resolve) => {
            if (attemptId !== connectAttemptId) {
                resolve(false);
                return;
            }
            const batch = uniqueCandidates.slice(startIndex, startIndex + AIRPAD_CANDIDATE_PARALLEL);
            if (!batch.length) {
                resolve(false);
                return;
            }

            if (startIndex === 0 && round === 0) {
                const el = getWsStatusEl();
                if (el) {
                    el.classList.remove(WS_STATUS_TLS_HINT_CLASS);
                    el.textContent = "connecting…";
                }
            }

            let won = false;
            let settled = false;
            let deadCount = 0;
            const batchSize = batch.length;
            let batchTlsCertUrl: string | null = null;
            let batchTlsHostname: string | null = null;

            const finishWin = (
                winner: Socket,
                candidate: WSConnectCandidate,
                index: number,
                url: string,
                hs: ReturnType<typeof buildHandshakeForCandidate>,
            ) => {
                if (settled) return;
                settled = true;
                won = true;
                for (const s of [...activeProbeSockets]) {
                    if (s !== winner) {
                        clearProbeTimer(s);
                        s.removeAllListeners();
                        s.close();
                        activeProbeSockets.delete(s);
                    }
                }
                clearProbeTimer(winner);
                activeProbeSockets.delete(winner);
                finalizeConnectedSocket(winner, candidate, index, url);
                resolve(true);
            };

            const finishAllDead = () => {
                if (settled || won) return;
                deadCount++;
                if (deadCount < batchSize) return;
                settled = true;
                if (batchTlsCertUrl) {
                    setWsStatusTlsHint(batchTlsCertUrl);
                } else if (batchTlsHostname) {
                    setWsStatusTlsHostnameHint(batchTlsHostname);
                }
                resolve(false);
            };

            for (let localIdx = 0; localIdx < batch.length; localIdx++) {
                const candidate = batch[localIdx];
                const index = startIndex + localIdx;
                const hs = buildHandshakeForCandidate(candidate);
                const { url, handshakeAuth, queryParams } = hs;
                logWsState(
                    "connecting",
                    `batch=${startIndex}-${startIndex + batchSize - 1} candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} ` +
                        `transport=${candidate.protocol} source=${candidate.source} host=${candidate.host}:${candidate.port} target=${targetHost}:${targetPort}`
                );

                const probeSocket = createWsSocket(url, {
                    auth: handshakeAuth,
                    query: queryParams,
                    timeout: AIRPAD_PROBE_IO_TIMEOUT_MS
                });
                activeProbeSockets.add(probeSocket);

                const hardTimer = globalThis.setTimeout(() => {
                    if (attemptId !== connectAttemptId) {
                        clearProbeTimer(probeSocket);
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        activeProbeSockets.delete(probeSocket);
                        return;
                    }
                    if (won || settled || probeSocket.connected) return;
                    clearProbeTimer(probeSocket);
                    probeSocket.removeAllListeners();
                    probeSocket.close();
                    activeProbeSockets.delete(probeSocket);
                    logWsState("connect-failed", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=probe-hard-timeout`);
                    finishAllDead();
                }, AIRPAD_PROBE_HARD_CAP_MS);
                (probeSocket as unknown as { __cwspProbeTimer?: ReturnType<typeof globalThis.setTimeout> }).__cwspProbeTimer =
                    hardTimer;

                probeSocket.on("connect", () => {
                    clearProbeTimer(probeSocket);
                    if (attemptId !== connectAttemptId) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        activeProbeSockets.delete(probeSocket);
                        return;
                    }
                    if (won || settled) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        activeProbeSockets.delete(probeSocket);
                        return;
                    }
                    finishWin(probeSocket, candidate, index, url, hs);
                });

                probeSocket.on("connect_error", (error) => {
                    clearProbeTimer(probeSocket);
                    activeProbeSockets.delete(probeSocket);
                    if (won || settled) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        return;
                    }
                    probeSocket.removeAllListeners();
                    probeSocket.close();
                    const details = (error as any)?.description || (error as any)?.context || "";
                    const errorMessage = String((error as any)?.message || error || "");
                    const combinedProbeErr = `${errorMessage} ${String(details)}`;
                    const weakWsTlsSuspect =
                        candidate.protocol === "https" &&
                        isPrivateIp(candidate.host) &&
                        /xhr poll error|websocket error/i.test(errorMessage);
                    /** Capacitor/WebView often reports generic xhr/WS errors; do not label "Untrusted cert" without TLS signals. */
                    const tlsKeywordsInErr = /certificate|cert\.|ssl|tls|trust|ERR_CERT|ERR_SSL|handshake|authority|SELF_SIGNED|unknown.*cert|invalid.*cert|unable to verify|pkix|hostname|name mismatch/i.test(
                        combinedProbeErr
                    );
                    const plainTransportFailure = /refused|ECONNREFUSED|ENOTFOUND|timed out|timeout|unreachable|ERR_CONNECTION|ADDRESS_UNREACHABLE|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|network.*lost/i.test(
                        combinedProbeErr
                    );
                    const nativeAir = isCapacitorNativeShell();
                    if (
                        weakWsTlsSuspect &&
                        !batchTlsCertUrl &&
                        (tlsKeywordsInErr || (!nativeAir && !plainTransportFailure))
                    ) {
                        batchTlsCertUrl = url;
                    }
                    const publicIpv4Https =
                        candidate.protocol === "https" &&
                        isIpv4Literal(candidate.host) &&
                        !isPrivateIp(candidate.host) &&
                        candidate.host !== "127.0.0.1";
                    const combinedErr = `${errorMessage} ${String(details)}`;
                    const publicIpTlsLikely =
                        publicIpv4Https &&
                        /xhr poll error|websocket error|certificate|CERT|common name|ssl|tls|failed to fetch|name invalid/i.test(combinedErr);
                    if (publicIpTlsLikely && !batchTlsHostname) {
                        const suggested =
                            pageHost && !isIpv4Literal(pageHost) && pageHost !== "localhost" ? pageHost : "";
                        if (suggested) {
                            batchTlsHostname = suggested;
                        }
                    }
                    if (
                        candidate.privateLanHint &&
                        /cors|private network|address space|failed fetch/i.test(errorMessage)
                    ) {
                        logWsState(
                            "connect-failed",
                            `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} hint=private-network-cors`
                        );
                    }
                    logWsState(
                        "connect-failed",
                        `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} details=${details ? safeJson(details) : "none"}`
                    );
                    finishAllDead();
                });
            }
        });

    void (async () => {
        for (let round = 0; round < maxRounds; round++) {
            for (let start = 0; start < uniqueCandidates.length; start += AIRPAD_CANDIDATE_PARALLEL) {
                if (attemptId !== connectAttemptId) {
                    return;
                }
                const ok = await probeBatch(start, round);
                if (ok) {
                    return;
                }
            }
            if (round + 1 < maxRounds) {
                logWsState("retry", `round=${round + 2}/${maxRounds} next=0`);
                await new Promise((r) => globalThis.setTimeout(r, retryDelayMs));
            }
        }
        if (attemptId !== connectAttemptId) {
            return;
        }
        logWsState("failed", `round=${maxRounds}/${maxRounds} all-candidates`);
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
    })();
}

/** Stop probe sockets, tear down the primary transport, and mark the disconnect as user-requested. */
export function disconnectWS() {
    stopClipboardPushLoop();
    clearAutoReconnectTimer();
    connectAttemptId += 1;
    manualDisconnectRequested = true;
    for (const probe of [...activeProbeSockets]) {
        clearProbeTimer(probe);
        probe.removeAllListeners();
        probe.close();
        activeProbeSockets.delete(probe);
    }
    isConnecting = false;
    if (!socket) {
        setWsStatus(false);
        updateButtonLabel();
        return;
    }
    log('Disconnecting WebSocket...');
    socket.disconnect();
    socket = null;
    mirrorSocketOnGlobal(null);
    setWsStatus(false);
}

/** Bind the optional connect button UI to the shared transport lifecycle. */
export function initWebSocket(btnConnect: HTMLElement | null) {
    btnEl = btnConnect;
    updateButtonLabel();
    if (!btnConnect) return;

    if (wsConnectButton === btnConnect) return;
    if (wsConnectButton) {
        wsConnectButton.removeEventListener('click', handleWsConnectButtonClick);
    }
    wsConnectButton = btnConnect;
    wsConnectButton.addEventListener('click', handleWsConnectButtonClick);
}

function handleWsConnectButtonClick() {
    if (isConnecting || wsConnected || (socket && socket.connected) || (socket as any)?.connecting) {
        disconnectWS();
    } else {
        connectWS();
    }
}

export {
    refreshNativeCoordinatorStatus,
    reconnectNativeCoordinatorTransport,
    startNativeAirMouse,
    stopNativeAirMouse,
    shouldUseNativeCoordinatorTransport
} from "./native-coordinator-bridge";
