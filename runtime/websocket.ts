type Unsubscribe = () => void;
type Handler<T extends unknown[] = unknown[]> = (...args: T) => void;

let connected = false;
const connectionHandlers = new Set<Handler<[boolean]>>();
const clipboardHandlers = new Set<Handler<[string, { source?: string }?]>>();
const voiceHandlers = new Set<Handler<[unknown]>>();

export function initWebSocket(): void {}

export function connectWS(): void {
    connected = true;
    connectionHandlers.forEach((handler) => handler(true));
}

export function disconnectWS(): void {
    connected = false;
    connectionHandlers.forEach((handler) => handler(false));
}

export function isWSConnected(): boolean {
    return connected;
}

export function onWSConnectionChange(handler: Handler<[boolean]>): Unsubscribe {
    connectionHandlers.add(handler);
    return () => connectionHandlers.delete(handler);
}

export function onServerClipboardUpdate(handler: Handler<[string, { source?: string }?]>): Unsubscribe {
    clipboardHandlers.add(handler);
    return () => clipboardHandlers.delete(handler);
}

export function onVoiceResult(handler: Handler<[unknown]>): Unsubscribe {
    voiceHandlers.add(handler);
    return () => voiceHandlers.delete(handler);
}

export function sendCoordinatorAct(what: string, payload?: unknown, nodes?: string[]): boolean {
    globalThis.dispatchEvent?.(new CustomEvent("cwsp:act", { detail: { what, payload, nodes } }));
    return true;
}

export async function sendCoordinatorAsk(what: string, payload?: unknown, nodes?: string[]): Promise<unknown> {
    globalThis.dispatchEvent?.(new CustomEvent("cwsp:ask", { detail: { what, payload, nodes } }));
    return null;
}

export async function sendCoordinatorRequest(what: string, payload?: unknown, nodes?: string[]): Promise<unknown> {
    return sendCoordinatorAsk(what, payload, nodes);
}
