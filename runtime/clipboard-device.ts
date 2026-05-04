export async function readClipboardText(): Promise<string> {
    return globalThis.navigator?.clipboard?.readText?.() ?? "";
}

export async function writeClipboardText(text: string): Promise<void> {
    await globalThis.navigator?.clipboard?.writeText?.(text);
}
