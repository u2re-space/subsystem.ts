export type NativeWsSocketOptions = {
    query?: Record<string, unknown>;
    auth?: Record<string, unknown>;
    timeout?: number;
};

const appendParams = (target: URL, params: unknown): void => {
    if (!params || typeof params !== "object") return;
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (!key || value === undefined || value === null || value === "") continue;
        target.searchParams.set(key, String(value));
    }
};

/**
 * Normalize user-entered endpoint origins and old `/socket.io` URLs to the native
 * CWSP websocket endpoint while preserving route/auth query metadata.
 */
export function normalizeWsEndpointUrl(
    rawUrl: string,
    query?: Record<string, unknown>,
    auth?: Record<string, unknown>
): string {
    const urlObj = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
    if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
    else if (urlObj.protocol === "https:") urlObj.protocol = "wss:";
    else if (urlObj.protocol !== "ws:" && urlObj.protocol !== "wss:") {
        urlObj.protocol = "wss:";
    }
    if (!urlObj.pathname || urlObj.pathname === "/" || /^\/socket\.io\/?$/i.test(urlObj.pathname)) {
        urlObj.pathname = "/ws";
    }
    for (const staleKey of ["EIO", "transport", "sid"]) {
        urlObj.searchParams.delete(staleKey);
    }
    appendParams(urlObj, query);
    appendParams(urlObj, auth);
    return urlObj.toString();
}

export class NativeSocket {
    public connected = false;
    public connecting = false;
    public id = "";
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<(...args: any[]) => void>>();
    private connectTimeout: ReturnType<typeof setTimeout> | undefined;

    constructor(private url: string, private options: NativeWsSocketOptions = {}) {
        this.connect();
    }

    private connect() {
        try {
            const endpointUrl = normalizeWsEndpointUrl(this.url, this.options.query, this.options.auth);
            this.connecting = true;
            this.ws = new WebSocket(endpointUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this.connecting = false;
                if (this.connectTimeout) clearTimeout(this.connectTimeout);
                this.emitLocal("connect");
            };

            this.ws.onclose = (event) => {
                this.connected = false;
                this.connecting = false;
                if (this.connectTimeout) clearTimeout(this.connectTimeout);
                this.emitLocal("disconnect", event.reason || "closed");
                this.emitLocal("close", event.code, event.reason);
            };

            this.ws.onerror = (error) => {
                this.connecting = false;
                this.emitLocal("connect_error", new Error("WebSocket error"));
                this.emitLocal("error", error);
            };

            this.ws.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    this.emitLocal("binary", event.data);
                    return;
                }
                if (typeof Blob !== "undefined" && event.data instanceof Blob) {
                    void event.data.arrayBuffer().then((buf) => this.emitLocal("binary", buf));
                    return;
                }
                try {
                    const data = JSON.parse(String(event.data));
                    if (data.event && data.payload) {
                        // COMPAT: old generated files may still wrap inbound frames as {event,payload}.
                        this.emitLocal(data.event, data.payload);
                    } else {
                        this.emitLocal("data", data);
                    }
                } catch {
                    this.emitLocal("data", event.data);
                }
            };

            if (this.options.timeout) {
                this.connectTimeout = setTimeout(() => {
                    if (!this.connected) {
                        this.connecting = false;
                        this.ws?.close();
                        this.emitLocal("connect_error", new Error("timeout"));
                    }
                }, this.options.timeout);
            }
        } catch (err) {
            this.connecting = false;
            setTimeout(() => this.emitLocal("connect_error", err), 0);
        }
    }

    on(event: string, listener: (...args: any[]) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);
    }

    off(event: string, listener: (...args: any[]) => void) {
        this.listeners.get(event)?.delete(listener);
    }

    send(packet: unknown): void {
        if (this.connected && this.ws) {
            this.ws.send(typeof packet === "string" ? packet : JSON.stringify(packet));
        }
    }

    /** Send legacy 8-byte AirPad binary frame (endpoint + Java {@code CwspBinaryAirpad} parity). */
    sendBinary(data: ArrayBuffer | Uint8Array): void {
        if (!this.connected || !this.ws) return;
        this.ws.send(data);
    }

    /** @deprecated Prefer send(packet); kept so old callers still compile. */
    emit(_event: string, ...args: any[]) {
        this.send(args[0]);
    }

    private emitLocal(event: string, ...args: any[]) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                handler(...args);
            }
        }
    }

    removeAllListeners() {
        this.listeners.clear();
    }

    close() {
        if (this.connectTimeout) clearTimeout(this.connectTimeout);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.connecting = false;
    }

    disconnect() {
        this.close();
    }
}

export { NativeSocket as Socket };

export function createWsSocket(url: string, options?: NativeWsSocketOptions): NativeSocket {
    return new NativeSocket(url, options);
}

/** @deprecated Use createWsSocket. */
export const io = createWsSocket;
