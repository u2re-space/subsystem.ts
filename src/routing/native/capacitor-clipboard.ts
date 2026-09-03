/**
 * Capacitor clipboard read/write with supernotes fork first, then official plugin.
 * @see https://capacitorjs.com/docs/apis/clipboard
 * @see https://www.npmjs.com/package/@supernotes/capacitor-clipboard
 */

const CLIPBOARD_PKGS = ["@supernotes/capacitor-clipboard", "@capacitor/clipboard"] as const;

type ClipboardModule = {
    Clipboard?: {
        read: () => Promise<{ value?: string; type?: string }>;
        write: (opts: { string: string; label?: string }) => Promise<void>;
    };
};

const clipboardFromCapacitorPlugins = (): ClipboardModule["Clipboard"] | null => {
    try {
        const plugins = (globalThis as {
            Capacitor?: { Plugins?: { Clipboard?: ClipboardModule["Clipboard"] } };
        }).Capacitor?.Plugins;
        return plugins?.Clipboard?.write ? plugins.Clipboard : null;
    } catch {
        return null;
    }
};

const loadClipboardModule = async (): Promise<ClipboardModule | null> => {
    // WHY: MV3 ServiceWorkerGlobalScope forbids import(); Capacitor clipboard is WebView-only.
    try {
        if (typeof (globalThis as { document?: unknown }).document === "undefined") {
            return null;
        }
    } catch {
        return null;
    }
    const registered = clipboardFromCapacitorPlugins();
    if (registered) return { Clipboard: registered };
    for (const pkg of CLIPBOARD_PKGS) {
        try {
            return (await import(/* @vite-ignore */ pkg)) as ClipboardModule;
        } catch {
            // package not installed in this shell
        }
    }
    return null;
};

export async function readCapacitorClipboardText(): Promise<string> {
    const mod = await loadClipboardModule();
    if (!mod?.Clipboard?.read) return "";
    try {
        const res = await mod.Clipboard.read();
        const value = res?.value;
        if (typeof value === "string" && value.trim()) return value;
    } catch {
        // permission denied / empty clipboard
    }
    return "";
}

export async function writeCapacitorClipboardText(text: string): Promise<boolean> {
    const mod = await loadClipboardModule();
    if (!mod?.Clipboard?.write) return false;
    try {
        await mod.Clipboard.write({ string: String(text ?? ""), label: "cwsp" });
        return true;
    } catch {
        return false;
    }
}
