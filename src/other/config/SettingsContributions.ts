/**
 * Settings contribution registry.
 *
 * WHY: each view (viewer, workcenter, airpad, …) and each shell surface
 * (web / CRX / Capacitor / native) should be able to contribute its own
 * settings tab + panel into the central settings UI instead of hard-coding
 * every section inside `settings-view`. This module is the shared, DOM-free,
 * fest-free contract that both the settings UI and contributors import.
 *
 * Contract:
 *   - `registerSettingsContribution(c)` adds/replaces a contribution by `id`
 *     and returns a disposer. It is safe to call from any layer (views, shells,
 *     extensions) and is idempotent per id.
 *   - `getSettingsContributions()` returns them ordered for rendering.
 *   - Panels may use `data-field="dot.path"` inputs that the host auto-binds to
 *     `AppSettings` via `bindContributionFields` / `collectContributionFields`,
 *     or set `manualFields` and implement `load`/`save` directly.
 *
 * INVARIANT: no DOM/UI framework imports here — only types + plain helpers, so
 * the registry is usable in service workers and native shells too.
 */
import type { AppSettings } from "./SettingsTypes";

export type SettingsSurface = "web" | "crx" | "capacitor" | "native" | "unknown";

export type SettingsContributionContext = {
    isExtension: boolean;
    surface: SettingsSurface;
};

export type SettingsContribution = {
    /** Unique id; also used as the tab id and `data-tab` value. */
    id: string;
    /** Tab label shown in the settings header. */
    label: string;
    /** Lower sorts first (default 100). Built-in tabs occupy < 100. */
    order?: number;
    /** Optional icon name (consumed by the host if it renders icons). */
    icon?: string;
    /**
     * If set, the panel is only shown when this view id is enabled
     * (`isEnabledView`). Use for view-owned settings (e.g. `reader` requires
     * `viewer`, `workcenter` requires `workcenter`) so a build that omits the
     * view (e.g. the CWSAndroid AirPad+Settings shell) shows no orphan tabs.
     */
    requiresView?: string;
    /** Build the panel body. Inputs with `data-field` auto-bind unless `manualFields`. */
    render: (ctx: SettingsContributionContext) => HTMLElement;
    /** Apply settings into the panel (runs after generic `data-field` binding). */
    load?: (settings: AppSettings, panel: HTMLElement, ctx: SettingsContributionContext) => void;
    /** Mutate settings before persist (runs after generic `data-field` collection). */
    save?: (settings: AppSettings, panel: HTMLElement, ctx: SettingsContributionContext) => void;
    /** When true, the host will not auto-bind `data-field` inputs for this panel. */
    manualFields?: boolean;
};

const registry = new Map<string, SettingsContribution>();

/** Register (or replace) a contribution by id. Returns a disposer. */
export const registerSettingsContribution = (contribution: SettingsContribution): (() => void) => {
    const id = String(contribution?.id || "").trim();
    if (!id) return () => {};
    const stored: SettingsContribution = { ...contribution, id };
    registry.set(id, stored);
    return () => {
        if (registry.get(id) === stored) registry.delete(id);
    };
};

/** All contributions, ordered (by `order`, then `id`). */
export const getSettingsContributions = (): SettingsContribution[] =>
    [...registry.values()].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id)
    );

export const hasSettingsContribution = (id: string): boolean => registry.has(String(id || "").trim());

export const clearSettingsContributions = (): void => registry.clear();

// --- Dot-path helpers (shared so contributions persist generically). ---

export const getByPath = (obj: any, path: string): unknown => {
    if (!obj || !path) return undefined;
    return path.split(".").reduce((acc: any, key) => (acc == null ? acc : acc[key]), obj);
};

export const setByPath = (obj: any, path: string, value: unknown): void => {
    if (!obj || !path) return;
    const keys = path.split(".");
    let cursor = obj;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = {};
        cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
};

const coerceOutbound = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown => {
    const el = input as HTMLInputElement;
    const explicit = (input.getAttribute("data-field-type") || "").toLowerCase();
    if (explicit === "boolean" || el.type === "checkbox") return Boolean(el.checked);
    const raw = "value" in input ? String((input as any).value ?? "") : "";
    if (explicit === "number" || el.type === "number") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    if (explicit === "json") {
        try {
            return raw.trim() ? JSON.parse(raw) : undefined;
        } catch {
            return undefined;
        }
    }
    return raw;
};

/** Apply `AppSettings` values into a panel's `data-field` inputs. */
export const bindContributionFields = (panel: HTMLElement, settings: AppSettings): void => {
    const fields = panel.querySelectorAll<HTMLElement>("[data-field]");
    fields.forEach((node) => {
        const path = node.getAttribute("data-field");
        if (!path) return;
        const value = getByPath(settings, path);
        if (value === undefined) return;
        const el = node as HTMLInputElement;
        if (el.type === "checkbox") {
            el.checked = Boolean(value);
        } else if (el.getAttribute("data-field-type") === "json") {
            (el as any).value = (() => {
                try {
                    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
                } catch {
                    return "";
                }
            })();
        } else if ("value" in el) {
            (el as any).value = String(value ?? "");
        }
    });
};

/** Collect a panel's `data-field` inputs back into the `AppSettings` object. */
export const collectContributionFields = (panel: HTMLElement, settings: AppSettings): void => {
    const fields = panel.querySelectorAll<HTMLElement>("[data-field]");
    fields.forEach((node) => {
        const path = node.getAttribute("data-field");
        if (!path) return;
        const value = coerceOutbound(node as HTMLInputElement);
        if (value === undefined) return;
        setByPath(settings, path, value);
    });
};
