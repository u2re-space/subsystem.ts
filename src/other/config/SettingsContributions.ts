/**
 * Canonical settings contribution registry (tabs/panels registered by views and shells).
 * INVARIANT: register and read paths must resolve to this module (see `com/config/*` alias).
 */
import type { AppSettings } from "./SettingsTypes";

/** `markdown` = VDS md.u2re.space / /markdown/ (cw-markdown) — document SPA, not CWSP Control. */
export type SettingsContributionSurface =
    | "web"
    | "markdown"
    | "crx"
    | "capacitor"
    | "native"
    | "unknown";

export type SettingsContributionContext = {
    isExtension?: boolean;
    surface: SettingsContributionSurface;
};

export type SettingsContribution = {
    id: string;
    label: string;
    order?: number;
    requiresView?: string;
    surfaces?: SettingsContributionSurface[];
    excludeSurfaces?: SettingsContributionSurface[];
    /** When true, host skips generic `[data-field]` bind/collect for this panel. */
    manualFields?: boolean;
    render: (ctx: SettingsContributionContext) => HTMLElement | null;
    load?: (settings: AppSettings, panel: HTMLElement, ctx: SettingsContributionContext) => void;
    save?: (settings: AppSettings, panel: HTMLElement, ctx: SettingsContributionContext) => void;
};

const registry = new Map<string, SettingsContribution>();

export const registerSettingsContribution = (entry: SettingsContribution): (() => void) => {
    const id = String(entry?.id || "").trim();
    if (!id) return () => {};
    const contribution = { ...entry, id };
    registry.set(id, contribution);
    return () => {
        if (registry.get(id) === contribution) registry.delete(id);
    };
};

export const getSettingsContributions = (): SettingsContribution[] =>
    [...registry.values()].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id)
    );

const getByPath = (source: unknown, path: string): unknown => {
    if (!source || !path) return undefined;
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc == null || typeof acc !== "object") return undefined;
        return (acc as Record<string, unknown>)[key];
    }, source);
};

const setByPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
    if (!target || !path) return;
    const keys = path.split(".");
    let cursor: Record<string, unknown> = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        const next = cursor[key];
        if (next == null || typeof next !== "object") cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[keys[keys.length - 1]] = value;
};

const readFieldValue = (el: Element): unknown => {
    const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const fieldType = (el.getAttribute("data-field-type") || "").toLowerCase();
    if (fieldType === "boolean" || input.type === "checkbox") {
        return !!(input as HTMLInputElement).checked;
    }
    const raw = "value" in input ? String(input.value ?? "") : "";
    if (fieldType === "number" || input.type === "number") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    if (fieldType === "json") {
        try {
            return raw.trim() ? JSON.parse(raw) : undefined;
        } catch {
            return undefined;
        }
    }
    // WHY: browsers often clear type=password on blur/background; empty must not wipe stored secrets.
    if (input.type === "password" && !raw.trim()) {
        return undefined;
    }
    return raw;
};

/** Populate `[data-field]` controls from `AppSettings`. */
export const bindContributionFields = (panel: HTMLElement, settings: AppSettings): void => {
    panel.querySelectorAll("[data-field]").forEach((el) => {
        const path = el.getAttribute("data-field");
        if (!path) return;
        const value = getByPath(settings, path);
        if (value === undefined) return;
        const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (input.type === "checkbox") {
            (input as HTMLInputElement).checked = !!value;
            return;
        }
        if (el.getAttribute("data-field-type") === "json") {
            try {
                input.value = typeof value === "string" ? value : JSON.stringify(value, null, 2);
            } catch {
                input.value = "";
            }
            return;
        }
        if ("value" in input) input.value = String(value ?? "");
    });
};

/** Merge `[data-field]` control values into `AppSettings`. */
export const collectContributionFields = (panel: HTMLElement, settings: AppSettings): void => {
    const target = settings as Record<string, unknown>;
    panel.querySelectorAll("[data-field]").forEach((el) => {
        const path = el.getAttribute("data-field");
        if (!path) return;
        const value = readFieldValue(el);
        // Skip undefined so empty password fields keep the previously loaded secret.
        if (value === undefined) return;
        setByPath(target, path, value);
    });
};
