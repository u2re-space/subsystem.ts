export type ClipboardWriteResult = {
    ok: boolean;
    text?: string;
    error?: unknown;
};

export async function writeText(text: string): Promise<ClipboardWriteResult> {
    try {
        await globalThis.navigator?.clipboard?.writeText?.(text);
        return { ok: true, text };
    } catch (error) {
        return { ok: false, text, error };
    }
}

export async function readText(): Promise<ClipboardWriteResult> {
    try {
        const text = await globalThis.navigator?.clipboard?.readText?.();
        return { ok: true, text: text ?? "" };
    } catch (error) {
        return { ok: false, error };
    }
}
