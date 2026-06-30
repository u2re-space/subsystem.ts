export async function sendViewProtocolMessage(input: {
    destination?: string;
    type?: string;
    action?: string;
    data?: unknown;
    payload?: unknown;
    [key: string]: unknown;
}): Promise<boolean> {
    globalThis.dispatchEvent?.(new CustomEvent("view:protocol-message", { detail: input }));
    return true;
}
