export type UnifiedMessage = {
    type?: string;
    data?: unknown;
    [key: string]: unknown;
};

export async function sendMessage(message: UnifiedMessage): Promise<boolean> {
    globalThis.dispatchEvent?.(new CustomEvent("view:message", { detail: message }));
    return true;
}

export const unifiedMessaging = {
    sendMessage
};

export function registerComponent(): void {}

export function initializeComponent(): UnifiedMessage[] {
    return [];
}
