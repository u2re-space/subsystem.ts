/**
 * Send-time markers for coordinator input + clipboard acts.
 * `perfTs` is monotonic on the sender (performance.now); `ts` is wall clock (Date.now).
 */

export type InputCommandTiming = {
    /** Wall-clock ms at send (`Date.now`). */
    ts: number;
    /** Monotonic ms on sender (`performance.now`). Primary sort key within one peer. */
    perfTs: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readPerfNow = (): number => {
    try {
        const perf = (globalThis as { performance?: { now?: () => number } }).performance;
        if (typeof perf?.now === "function") return perf.now();
    } catch {
        /* ignore */
    }
    return Date.now();
};

/** Capture send-time markers for one input act. */
export const captureInputCommandTiming = (): InputCommandTiming => ({
    ts: Date.now(),
    perfTs: readPerfNow()
});

/** Low 16 bits of deci-ms perf clock — packed into legacy 8-byte AirPad frames (bytes 6–7). */
export const encodeInputPerfTsLo = (perfTs = readPerfNow()): number => Math.round(perfTs * 10) & 0xffff;

/** Expand binary {@link encodeInputPerfTsLo} back to a sortable perfTs fragment. */
export const decodeInputPerfTsLo = (perfTsLo: number): number => (perfTsLo & 0xffff) / 10;

export const isInputCoordinatorWhat = (what: string): boolean => {
    const normalized = String(what || "").trim().toLowerCase();
    return (
        normalized.startsWith("mouse:") ||
        normalized.startsWith("keyboard:") ||
        normalized.startsWith("airpad:mouse") ||
        normalized.startsWith("airpad:keyboard")
    );
};

export const isClipboardCoordinatorWhat = (what: string): boolean => {
    const normalized = String(what || "").trim().toLowerCase();
    return normalized.startsWith("clipboard:") || normalized.startsWith("airpad:clipboard:");
};

/** Input + clipboard coordinator acts carry send-time markers for ordering/dedupe. */
export const shouldAnnotateCoordinatorPayload = (what: string): boolean =>
    isInputCoordinatorWhat(what) || isClipboardCoordinatorWhat(what);

/** Merge timing into payload without overwriting explicit values. */
export const annotateCoordinatorPayload = <T extends Record<string, unknown>>(payload: T): T & InputCommandTiming => {
    const base = asRecord(payload) as T;
    const timing = captureInputCommandTiming();
    return {
        ...base,
        ts: Number(base.ts ?? timing.ts),
        perfTs: Number(base.perfTs ?? timing.perfTs)
    };
};

/** @deprecated Use {@link annotateCoordinatorPayload}. */
export const annotateInputPayload = annotateCoordinatorPayload;

export const extractInputCommandTiming = (
    payload: unknown,
    packetTimestamp?: number
): InputCommandTiming => {
    const body = asRecord(payload);
    const tsRaw = body.ts ?? packetTimestamp ?? 0;
    const perfRaw = body.perfTs ?? (body.perfTsLo !== undefined ? decodeInputPerfTsLo(Number(body.perfTsLo)) : 0);
    const ts = Number(tsRaw);
    const perfTs = Number(perfRaw);
    return {
        ts: Number.isFinite(ts) ? ts : 0,
        perfTs: Number.isFinite(perfTs) ? perfTs : 0
    };
};

/** Sort key: perfTs first, then wall ts, then stable 0. */
export const compareInputCommandTiming = (a: Partial<InputCommandTiming>, b: Partial<InputCommandTiming>): number => {
    const aPerf = Number(a.perfTs);
    const bPerf = Number(b.perfTs);
    if (Number.isFinite(aPerf) && Number.isFinite(bPerf) && aPerf !== bPerf) {
        return aPerf - bPerf;
    }
    const aTs = Number(a.ts);
    const bTs = Number(b.ts);
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
        return aTs - bTs;
    }
    return 0;
};

/** Preserve timing fields when normalizing airpad payload shapes. */
export const mergeInputTimingFields = (
    target: Record<string, unknown>,
    source: Record<string, unknown>
): Record<string, unknown> => {
    const out = { ...target };
    if (source.ts !== undefined) out.ts = source.ts;
    if (source.perfTs !== undefined) out.perfTs = source.perfTs;
    if (source.perfTsLo !== undefined) out.perfTsLo = source.perfTsLo;
    return out;
};
