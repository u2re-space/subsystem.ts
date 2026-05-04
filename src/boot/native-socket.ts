export class NativeSocket {
    public connected = false;
    public id = "";
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<(...args: any[]) => void>>();
    private connectTimeout: any;

    constructor(private url: string, private options: any) {
        this.connect();
    }

    private connect() {
        try {
            // Build query string from options
            const urlObj = new URL(this.url);
            if (this.options.query) {
                for (const [key, value] of Object.entries(this.options.query)) {
                    urlObj.searchParams.set(key, String(value));
                }
            }
            if (this.options.auth) {
                for (const [key, value] of Object.entries(this.options.auth)) {
                    urlObj.searchParams.set(key, String(value));
                }
            }

            // Change http/https to ws/wss
            if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
            if (urlObj.protocol === "https:") urlObj.protocol = "wss:";

            // Ensure path is /ws
            if (!urlObj.pathname || urlObj.pathname === "/") {
                urlObj.pathname = "/ws";
            }

            this.ws = new WebSocket(urlObj.toString());

            this.ws.onopen = () => {
                this.connected = true;
                this.emitLocal("connect");
            };

            this.ws.onclose = (event) => {
                this.connected = false;
                this.emitLocal("disconnect", event.reason || "closed");
                this.emitLocal("close", event.code, event.reason);
            };

            this.ws.onerror = (error) => {
                this.emitLocal("connect_error", new Error("WebSocket error"));
                this.emitLocal("error", error);
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event && data.payload) {
                        this.emitLocal(data.event, data.payload);
                    } else {
                        this.emitLocal("data", data);
                    }
                } catch (err) {
                    this.emitLocal("data", event.data);
                }
            };

            if (this.options.timeout) {
                this.connectTimeout = setTimeout(() => {
                    if (!this.connected) {
                        this.ws?.close();
                        this.emitLocal("connect_error", new Error("timeout"));
                    }
                }, this.options.timeout);
            }
        } catch (err) {
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

    emit(event: string, ...args: any[]) {
        if (event === "data" || event === "message") {
            if (this.connected && this.ws) {
                this.ws.send(typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]));
            }
        } else {
            if (this.connected && this.ws) {
                this.ws.send(JSON.stringify({ event, payload: args[0] }));
            }
        }
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
    }

    disconnect() {
        this.close();
    }
}

export { NativeSocket as Socket };

export function io(url: string, options: any): NativeSocket {
    return new NativeSocket(url, options);
}
