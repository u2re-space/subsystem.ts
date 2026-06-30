/**
 * Shared interop helpers for CrossWord transport envelopes.
 *
 * WHY: the main thread, service worker, CRX runtime, and native/worker bridges
 * all need the same destination, protocol, and envelope normalization without
 * each importing the full `fest/uniform` runtime graph.
 */
import { getDestinationAliases, normalizeDestination } from "com/config/Names";

export type InteropPurpose = "invoke" | "mail" | "attach" | "deliver" | "defer";

export interface InteropUnifiedMessage<T = unknown> {
    id: string;
    type: string;
    source: string;
    destination?: string;
    contentType?: string;
    data: T;
    metadata: Record<string, unknown>;
}

export interface InteropEnvelope<T = unknown> extends InteropUnifiedMessage<T> {
    uuid: string;
    sender: string;
    purpose: InteropPurpose[];
    protocol: string;
    transport?: string;
    redirect: boolean;
    flags: Record<string, unknown>;
    op: string;
    timestamp: number;
    srcChannel: string;
    dstChannel?: string | string[];
    payload: T;
    destinations: string[];
    ids: Record<string, unknown>;
    urls: string[];
    tokens: string[];
    toRoles: string[];
    tabId?: number;
    frameId?: number;
    status?: number;
    result?: unknown;
    results?: unknown;
    error?: unknown;
    target?: string;
}

export interface InteropMessageInput<T = unknown> {
    id?: string;
    uuid?: string;
    type?: string;
    source?: string;
    sender?: string;
    destination?: string;
    target?: string;
    contentType?: string;
    data?: T;
    payload?: T;
    metadata?: Record<string, unknown>;
    purpose?: InteropPurpose | InteropPurpose[];
    protocol?: string;
    transport?: string;
    redirect?: boolean;
    flags?: Record<string, unknown>;
    op?: string;
    timestamp?: number;
    srcChannel?: string;
    dstChannel?: string | string[];
    destinations?: string[];
    ids?: Record<string, unknown>;
    urls?: string[];
    tokens?: string[];
    toRoles?: string[];
    tabId?: number;
    frameId?: number;
    status?: number;
    result?: unknown;
    results?: unknown;
    error?: unknown;
}

const PROTOCOL_ALIASES: Record<string, string> = {
    "chrome-runtime": "chrome",
    "chrome-tabs": "chrome",
    "chrome-port": "chrome",
    "chrome-external": "chrome",
    "service-worker": "worker",
    "service-worker:http": "worker",
    "service": "worker",
    "sw": "worker",
    "broadcast-channel": "broadcast",
    "broadcastchannel": "broadcast",
    "websocket": "socket",
    "ws": "socket",
    "socket-io": "socket",
    "socketio": "socket",
};

const TRANSPORT_ALIASES: Record<string, string> = {
    "service": "service-worker",
    "service-worker:http": "service-worker",
    "sw": "service-worker",
    "ws": "websocket",
    "socket": "websocket",
    "socketio": "socket-io",
    "chrome": "chrome-runtime",
};

const PURPOSES = new Set<InteropPurpose>(["invoke", "mail", "attach", "deliver", "defer"]);

const randomId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `interop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const normalizePurpose = (value?: InteropPurpose | InteropPurpose[]): InteropPurpose[] => {
    const raw: InteropPurpose[] = Array.isArray(value) ? value : value ? [value] : ["mail"];
    const deduped: InteropPurpose[] = [];
    for (const entry of raw) {
        if (PURPOSES.has(entry) && !deduped.includes(entry)) deduped.push(entry);
    }
    return deduped.length > 0 ? deduped : ["mail"];
};

/**
 * Normalize the protocol family advertised in envelopes and bridge packets.
 */
export const normalizeInteropProtocolName = (value: string | null | undefined): string => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "unknown";
    return PROTOCOL_ALIASES[raw] || raw;
};

/**
 * Normalize transport hints to one transport taxonomy for diagnostics and docs.
 */
export const normalizeInteropTransportName = (value: string | null | undefined): string | undefined => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return undefined;
    return TRANSPORT_ALIASES[raw] || raw;
};

/**
 * Create one shared envelope shape that can be used by main-thread, SW, and CRX
 * adapters before converting to `fest/uniform` runtime objects.
 */
export const createInteropEnvelope = <T = unknown>(input: InteropMessageInput<T>): InteropEnvelope<T> => {
    const id = String(input.id || input.uuid || "").trim() || randomId();
    const source = String(input.source || input.sender || input.srcChannel || "interop").trim() || "interop";
    const destination = normalizeDestination(input.destination || input.target);
    const destinations = Array.isArray(input.destinations) && input.destinations.length > 0
        ? [...new Set(input.destinations.map((entry) => normalizeDestination(entry)).filter(Boolean))]
        : destination
            ? getDestinationAliases(destination)
            : [];
    const payload = (input.payload ?? input.data) as T;
    const timestamp = Number(input.timestamp ?? Date.now()) || Date.now();

    return {
        id,
        uuid: id,
        type: String(input.type || "request"),
        source,
        sender: String(input.sender || source),
        destination: destination || undefined,
        target: destination || undefined,
        contentType: input.contentType ? String(input.contentType) : undefined,
        data: payload,
        payload,
        metadata: {
            timestamp,
            ...(input.metadata || {})
        },
        purpose: normalizePurpose(input.purpose),
        protocol: normalizeInteropProtocolName(input.protocol),
        transport: normalizeInteropTransportName(input.transport),
        redirect: Boolean(input.redirect),
        flags: { ...(input.flags || {}) },
        op: String(input.op || (String(input.type || "").startsWith("response:") ? "response" : "deliver")),
        timestamp,
        srcChannel: String(input.srcChannel || source),
        dstChannel: input.dstChannel ?? (destination || undefined),
        destinations,
        ids: {
            byId: source,
            from: source,
            sender: source,
            destinations,
            ...(input.ids || {})
        },
        urls: Array.isArray(input.urls) ? [...input.urls] : [],
        tokens: Array.isArray(input.tokens) ? [...input.tokens] : [],
        toRoles: Array.isArray(input.toRoles) ? [...input.toRoles] : [],
        tabId: input.tabId,
        frameId: input.frameId,
        status: typeof input.status === "number" ? input.status : undefined,
        result: input.result,
        results: input.results,
        error: input.error
    };
};

/**
 * Map an envelope-like payload into the app's unified-message shape.
 */
export const toUnifiedInteropMessage = <T = unknown>(input: InteropMessageInput<T>): InteropUnifiedMessage<T> => {
    const envelope = createInteropEnvelope(input);
    return {
        id: envelope.id,
        type: envelope.type,
        source: envelope.source,
        destination: envelope.destination,
        contentType: envelope.contentType,
        data: envelope.data,
        metadata: {
            ...envelope.metadata,
            protocol: envelope.protocol,
            transport: envelope.transport,
            sender: envelope.sender,
            srcChannel: envelope.srcChannel,
            dstChannel: envelope.dstChannel,
            destinations: envelope.destinations,
            ids: envelope.ids,
            flags: envelope.flags,
            status: envelope.status,
            error: envelope.error
        }
    };
};
