/*
 * Filename: process-ingress.ts
 * FullPath: modules/projects/subsystem/src/other/config/process-ingress.ts
 * FIND:process-ingress
 * TAG:process-ingress,share-target,workcenter
 *
 * Per-kind Share Target / Launch Queue / Capacitor Open-with policy.
 * INVARIANT: attach only stages files in chat. process runs AI once in the
 * background and writes the result to the device clipboard — never also attach,
 * never also click Execute, never also dump the result into chat.
 * INVARIANT: `ai.autoProcessShared`, `ai.shareTargetMode`, and `processIngress.autoProcess`
 * are unread leftovers. Only `processIngress.kinds.*.mode` chooses attach vs process.
 * INVARIANT: `mode === "process"` implies clipboard-write + Capacitor daemon hold.
 */

import { classifyOpenKindFromPayload, OPEN_KINDS, type OpenKind } from "./open-policy";
import type { AppSettings, ProcessIngressKindPolicy, ProcessIngressMode, ProcessIngressPolicy } from "./SettingsTypes";

export type ProcessIngressKind = OpenKind;
export type { ProcessIngressKindPolicy, ProcessIngressMode, ProcessIngressPolicy };

const kindDefault = (mode: ProcessIngressMode, copy: boolean): ProcessIngressKindPolicy => ({
    mode,
    instructionId: "",
    copyToClipboard: copy
});

export const DEFAULT_PROCESS_INGRESS: ProcessIngressPolicy = {
    autoProcess: true,
    backgroundClipboard: true,
    kinds: {
        markdown: kindDefault("process", true),
        text: kindDefault("process", true),
        document: kindDefault("process", true),
        image: kindDefault("process", true),
        url: kindDefault("process", true),
        other: kindDefault("attach", false)
    }
};

export const PROCESS_INGRESS_KIND_LABELS: Record<ProcessIngressKind, string> = {
    markdown: "Markdown",
    text: "Text",
    document: "Documents",
    image: "Images",
    url: "Links",
    other: "Other files"
};

export const mergeProcessIngress = (
    ...layers: Array<Partial<ProcessIngressPolicy> | null | undefined>
): ProcessIngressPolicy => {
    const out: ProcessIngressPolicy = {
        autoProcess: DEFAULT_PROCESS_INGRESS.autoProcess,
        backgroundClipboard: DEFAULT_PROCESS_INGRESS.backgroundClipboard,
        kinds: { ...DEFAULT_PROCESS_INGRESS.kinds }
    };
    for (const layer of layers) {
        if (!layer) continue;
        if (typeof layer.autoProcess === "boolean") out.autoProcess = layer.autoProcess;
        if (typeof layer.backgroundClipboard === "boolean") out.backgroundClipboard = layer.backgroundClipboard;
        if (layer.kinds && typeof layer.kinds === "object") {
            for (const key of OPEN_KINDS) {
                const src = layer.kinds[key];
                if (!src || typeof src !== "object") continue;
                const prev = out.kinds[key];
                const mode: ProcessIngressMode =
                    src.mode === "attach" || src.mode === "process" ? src.mode : prev.mode;
                out.kinds[key] = {
                    mode,
                    instructionId: typeof src.instructionId === "string" ? src.instructionId : prev.instructionId,
                    /* WHY: leftover `copyToClipboard: false` must not disable process → clipboard. */
                    copyToClipboard: mode === "process"
                };
            }
        }
    }
    return out;
};

export const resolveProcessIngressPolicy = (settings?: AppSettings | null): ProcessIngressPolicy =>
    mergeProcessIngress(DEFAULT_PROCESS_INGRESS, settings?.ai?.processIngress);

export type ResolvedProcessIngressKind = ProcessIngressKindPolicy & {
    kind: ProcessIngressKind;
    autoProcess: boolean;
    backgroundClipboard: boolean;
};

export const resolveProcessIngressKind = (
    settings: AppSettings | null | undefined,
    kind: string
): ResolvedProcessIngressKind => {
    const policy = resolveProcessIngressPolicy(settings);
    const key = (OPEN_KINDS as readonly string[]).includes(kind) ? (kind as ProcessIngressKind) : "other";
    const row = policy.kinds[key] || DEFAULT_PROCESS_INGRESS.kinds[key];
    const mode: ProcessIngressMode = row.mode === "attach" ? "attach" : "process";
    return {
        kind: key,
        mode,
        instructionId: row.instructionId || "",
        copyToClipboard: mode === "process",
        autoProcess: mode === "process",
        backgroundClipboard: mode === "process"
    };
};

/** Attach-mode kinds stage chat chips. Process-mode kinds must not. */
export const shouldAttachProcessIngress = (
    settings: AppSettings | null | undefined,
    payload: Parameters<typeof classifyOpenKindFromPayload>[0]
): boolean => resolveProcessIngressKind(settings, classifyOpenKindFromPayload(payload)).mode !== "process";

export const instructionTextForIngress = (
    settings: AppSettings | null | undefined,
    instructionId?: string
): string => {
    const list = settings?.ai?.customInstructions || [];
    const id = String(instructionId || settings?.ai?.activeInstructionId || "").trim();
    const byId = id ? list.find((item) => item.id === id) : null;
    const byLabel = id
        ? list.find((item) => String(item.label || "").trim().toLowerCase() === id.toLowerCase())
        : null;
    const active = list.find((item) => item.id === settings?.ai?.activeInstructionId);
    const enabled = list.find((item) => item.enabled !== false && String(item.instruction || "").trim());
    /* WHY: empty per-kind id means "Active instruction"; label match covers seeded Markdown & KaTeX. */
    return String(byId?.instruction || byLabel?.instruction || active?.instruction || enabled?.instruction || "").trim();
};

export const formatProcessIngressResult = (data: unknown): string => {
    if (typeof data === "string") return data;
    if (data == null) return "";
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
};

let settingsPeek: AppSettings | null = null;

export const rememberProcessIngressSettings = (settings?: AppSettings | null): void => {
    if (settings) settingsPeek = settings;
    void persistProcessIngressNativeSnapshot(settingsPeek);
};

/** Capacitor Process FGS reads this snapshot — share must not wait for WebView IDB. */
export const persistProcessIngressNativeSnapshot = async (
    settings?: AppSettings | null
): Promise<void> => {
    try {
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        if (typeof g.Capacitor?.isNativePlatform !== "function" || !g.Capacitor.isNativePlatform()) {
            return;
        }
    } catch {
        return;
    }
    const policy = resolveProcessIngressPolicy(settings);
    const kinds: Record<string, ProcessIngressMode> = {
        markdown: policy.kinds.markdown.mode,
        text: policy.kinds.text.mode,
        document: policy.kinds.document.mode,
        image: policy.kinds.image.mode,
        url: policy.kinds.url.mode,
        other: policy.kinds.other.mode
    };
    const instruction = instructionTextForIngress(settings);
    try {
        const { invokeCwsNative } = await import("../../routing/native/cws-bridge");
        await invokeCwsNative("settings:snapshot", {
            apiKey: String(settings?.ai?.apiKey || "").trim(),
            baseUrl: String(settings?.ai?.baseUrl || "").trim(),
            model: String(settings?.ai?.model || "").trim(),
            instruction,
            instructionId: String(settings?.ai?.activeInstructionId || "").trim(),
            kinds,
            /* WHY: Capacitor JSObject nesting can drop `kinds`; Java also reads this string. */
            kindsJson: JSON.stringify(kinds)
        });
    } catch {
        /* native snapshot optional until Process APK is rebuilt */
    }
};

export const peekProcessIngressSettings = (): AppSettings | null => settingsPeek;

/** True when a settings blob has been loaded (defaults still apply on Capacitor). */
export const processIngressSettingsFound = (settings?: AppSettings | null): boolean =>
    Boolean(settings?.ai);

const isCapacitorNativeSync = (): boolean => {
    try {
        const g = globalThis as {
            Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
            __CWS_NATIVE__?: boolean;
        };
        return Boolean(
            g.Capacitor?.isNativePlatform?.() ||
                g.Capacitor?.getPlatform?.() === "android" ||
                g.Capacitor?.getPlatform?.() === "ios" ||
                g.__CWS_NATIVE__ === true
        );
    } catch {
        return false;
    }
};

/**
 * INVARIANT: Process PWA/Web is a Share Target (manifest `share_target`) and Launch Queue.
 * Capacitor/Android still uses OS Share + Open-with.
 */
export const allowProcessWebShareLaunch = (settings?: AppSettings | null): boolean => {
    void settings;
    return true;
};

/**
 * INVARIANT: Process PWA/Web consumes Launch Queue like document/explorer (`file_handlers`).
 */
export const allowProcessWebLaunchQueue = (settings?: AppSettings | null): boolean => {
    void settings;
    return true;
};

export const writeProcessIngressClipboard = async (text: string): Promise<boolean> => {
    const value = String(text || "");
    if (!value.trim()) return false;
    try {
        const { writeClipboardTextToDevice } = await import("../../routing/native/clipboard-device");
        await writeClipboardTextToDevice(value);
        return true;
    } catch {
        return false;
    }
};

/** Capacitor: keep the foreground bridge so AI + clipboard-write can finish after Share. */
export const holdCapacitorIngressJob = async (settings?: AppSettings | null): Promise<() => void> => {
    try {
        const { isCapacitorNative } = await import("../../boot/capacitor-permissions");
        if (!isCapacitorNative()) return () => {};
    } catch {
        return () => {};
    }
    try {
        const { ensureCapacitorBridgeDaemonStarted } = await import("../../boot/capacitor-settings-permissions");
        /* WHY: a share-time AI job must keep the foreground bridge even if Settings left the daemon off. */
        await ensureCapacitorBridgeDaemonStarted({
            ...(settings || {}),
            shell: { ...(settings?.shell || {}), bridgeDaemonEnabled: true }
        });
    } catch {
        /* daemon optional */
    }
    return () => {};
};
