/*
 * Filename: workspace.ts
 * FullPath: modules/projects/shared/src/other/config/settings/contributions/workspace.ts
 * Change date and time: 09.30.00_19.08.2026
 * Reason for changes: Workspace (speed dial) settings tab for CWSP-shell and CWSP-crx.
 */

/**
 * Workspace / speed-dial defaults. Live grid SoT is `cw::workspace::grid-layout`;
 * this tab mirrors it into `AppSettings.grid` and notifies the speed-dial module.
 */
import type { AppSettings, GridShape } from "../../SettingsTypes";
import { registerSettingsContribution } from "../../SettingsContributions";
import {
    settingsButton,
    settingsButtonRow,
    settingsHint,
    settingsNumberField,
    settingsPanel,
    settingsSelectField
} from "../settings-contribution-ui";

const GRID_LS_KEY = "cw::workspace::grid-layout";
const OPEN_LINK_LS_KEY = "rs-open-link-target";
const WORKSPACE_GRID_EVENT = "cwsp:workspace-grid";

const SHAPE_OPTIONS: Array<[string, string]> = [
    ["squircle", "Squircle"],
    ["circle", "Circle"],
    ["square", "Rounded square"],
    ["wavy", "Wavy"]
];

const ACTION_OPTIONS: Array<[string, string]> = [
    ["open-link", "Open link"],
    ["open-view", "Open view"]
];

const APP_MENU_SORT_OPTIONS: Array<[string, string]> = [
    ["name", "Name"],
    ["installed", "Date installed"],
    ["updated", "Date updated"],
    ["color", "Color (including mask)"],
    ["category", "Category"],
    ["package", "Package"]
];

const SORT_DIR_OPTIONS: Array<[string, string]> = [
    ["asc", "Ascending"],
    ["desc", "Descending"]
];

const OPEN_TARGET_OPTIONS: Array<[string, string]> = [
    ["inline", "Inline (iframe / env window, same tab)"],
    ["external-app", "External app (Android chooser)"],
    ["viewer", "Markdown (in this app)"],
    ["document", "CWSP-document"],
    ["explorer", "CWSP-explorer"],
    ["workcenter", "CWSP-process"],
    ["transfer", "CWSP-transfer"],
    ["native-window", "Native window (new browser window)"],
    ["new-tab", "New tab"]
];

const ICON_SCALE_OPTIONS: Array<[string, string]> = [
    ["compact", "Compact (0.78)"],
    ["fit", "Fit (1.0 — no zoom)"],
    ["fill", "Fill (1.28 — adaptive default)"],
    ["zoom", "Zoom (1.5)"],
    ["max", "Max (1.75)"]
];

const ALLOWED_SHAPES = new Set(SHAPE_OPTIONS.map(([value]) => value));
const ALLOWED_ACTIONS = new Set(ACTION_OPTIONS.map(([value]) => value));
const ALLOWED_TARGETS = new Set(OPEN_TARGET_OPTIONS.map(([value]) => value));
const ALLOWED_ICON_SCALES = new Set(ICON_SCALE_OPTIONS.map(([value]) => value));

type WorkspaceGrid = NonNullable<AppSettings["grid"]>;

const clampGridCount = (raw: unknown, fallback: number): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(16, Math.round(n)));
};

const normalizeShape = (raw: unknown, fallback: GridShape = "squircle"): GridShape => {
    const v = String(raw || "").trim().toLowerCase();
    return (ALLOWED_SHAPES.has(v) ? v : fallback) as GridShape;
};

const normalizeAction = (raw: unknown, fallback = "open-link"): string => {
    const v = String(raw || "").trim().toLowerCase();
    return ALLOWED_ACTIONS.has(v) ? v : fallback;
};

const normalizeIconScale = (
    raw: unknown,
    fallback: NonNullable<WorkspaceGrid["iconScale"]> = "fill"
): NonNullable<WorkspaceGrid["iconScale"]> => {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "small" || v === "0.78") return "compact";
    if (v === "1" || v === "contain") return "fit";
    if (v === "adaptive" || v === "1.28") return "fill";
    if (v === "1.5") return "zoom";
    if (v === "large" || v === "1.75") return "max";
    return (ALLOWED_ICON_SCALES.has(v) ? v : fallback) as NonNullable<WorkspaceGrid["iconScale"]>;
};

const normalizeOpenTarget = (
    raw: unknown,
    fallback: NonNullable<WorkspaceGrid["defaultOpenLinkTarget"]> = "inline"
): NonNullable<WorkspaceGrid["defaultOpenLinkTarget"]> => {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "in-shell" || v === "env" || v === "shell") return "inline";
    if (v === "native" || v === "window" || v === "app-window") return "native-window";
    if (v === "tab" || v === "browser" || v === "browser-tab") return "new-tab";
    if (v === "app" || v === "chooser" || v === "open-with" || v === "open-in-app" || v === "intent") {
        return "external-app";
    }
    if (v === "markdown") return "viewer";
    if (v === "document" || v === "cwsp-document") return "document";
    if (v === "files") return "explorer";
    if (v === "process" || v === "cwsp-process") return "workcenter";
    if (v === "transfer" || v === "cwsp" || v === "network") return "transfer";
    return (ALLOWED_TARGETS.has(v) ? v : fallback) as NonNullable<WorkspaceGrid["defaultOpenLinkTarget"]>;
};

/** Best-effort parse of makeUIState JSOX/JSON without importing lure. */
const parseStoredGrid = (raw: string | null): Partial<WorkspaceGrid> => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed as Partial<WorkspaceGrid>;
    } catch {
        /* JSOX unquoted keys */
    }
    const columns = /columns["']?\s*:\s*(\d+)/.exec(raw);
    const rows = /rows["']?\s*:\s*(\d+)/.exec(raw);
    const shape = /shape["']?\s*:\s*["']?([a-z-]+)/i.exec(raw);
    const defaultAction = /defaultAction["']?\s*:\s*["']?([a-z-]+)/i.exec(raw);
    const defaultOpenLinkTarget = /defaultOpenLinkTarget["']?\s*:\s*["']?([a-z-]+)/i.exec(raw);
    const iconScale = /iconScale["']?\s*:\s*["']?([a-z0-9.-]+)/i.exec(raw);
    const out: Partial<WorkspaceGrid> = {};
    if (columns) out.columns = Number(columns[1]);
    if (rows) out.rows = Number(rows[1]);
    if (shape) out.shape = normalizeShape(shape[1]);
    if (defaultAction) out.defaultAction = normalizeAction(defaultAction[1]);
    if (defaultOpenLinkTarget) out.defaultOpenLinkTarget = normalizeOpenTarget(defaultOpenLinkTarget[1]);
    if (iconScale) out.iconScale = normalizeIconScale(iconScale[1]);
    return out;
};

const readLiveGrid = (): WorkspaceGrid => {
    let live: Partial<WorkspaceGrid> | null = null;
    try {
        window.dispatchEvent(
            new CustomEvent(WORKSPACE_GRID_EVENT, {
                detail: {
                    query: true,
                    receive: (grid: Partial<WorkspaceGrid>) => {
                        live = grid;
                    }
                }
            })
        );
    } catch {
        /* ignore */
    }
    let stored: Partial<WorkspaceGrid> = {};
    let openTarget = "";
    try {
        stored = parseStoredGrid(localStorage.getItem(GRID_LS_KEY));
        openTarget = String(localStorage.getItem(OPEN_LINK_LS_KEY) || "");
    } catch {
        /* private mode */
    }
    return {
        columns: clampGridCount(live?.columns ?? stored.columns, 4),
        rows: clampGridCount(live?.rows ?? stored.rows, 8),
        shape: normalizeShape(live?.shape ?? stored.shape, "squircle"),
        defaultAction: normalizeAction(live?.defaultAction ?? stored.defaultAction, "open-link"),
        defaultOpenLinkTarget: normalizeOpenTarget(
            live?.defaultOpenLinkTarget ?? stored.defaultOpenLinkTarget ?? openTarget,
            "inline"
        ),
        iconScale: normalizeIconScale(live?.iconScale ?? stored.iconScale, "fill")
    };
};

const setFieldValue = (panel: HTMLElement, path: string, value: unknown): void => {
    const el = panel.querySelector(`[data-field="${path}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!el || value == null) return;
    el.value = String(value);
};

const CATALOG_KEY = "cw::workspace::pages";

const paintWorkspacePages = (host: HTMLElement): void => {
    let pages: Array<{ id: string; label: string }> = [];
    let active = "side-a";
    try {
        const parsed = JSON.parse(localStorage.getItem(CATALOG_KEY) || "null");
        if (parsed?.pages?.length) {
            pages = parsed.pages;
            active = String(parsed.activeId || pages[0].id);
        }
    } catch {
        pages = [
            { id: "side-a", label: "Side A" },
            { id: "side-b", label: "Side B" },
            { id: "side-c", label: "Side C" }
        ];
    }
    if (!pages.length) {
        pages = [
            { id: "side-a", label: "Side A" },
            { id: "side-b", label: "Side B" },
            { id: "side-c", label: "Side C" }
        ];
    }
    host.replaceChildren();
    for (const page of pages) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:.4rem;align-items:center;margin:.25rem 0;";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "view-settings__btn";
        btn.textContent = page.label + (page.id === active ? " · active" : "");
        btn.addEventListener("click", () => {
            window.dispatchEvent(new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "switch", id: page.id } }));
            requestAnimationFrame(() => paintWorkspacePages(host));
        });
        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "view-settings__btn";
        rename.textContent = "Rename";
        rename.addEventListener("click", () => {
            const next = window.prompt("Workspace name", page.label);
            if (!next) return;
            window.dispatchEvent(
                new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "rename", id: page.id, label: next } })
            );
            requestAnimationFrame(() => paintWorkspacePages(host));
        });
        row.append(btn, rename);
        if (pages.length > 1) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "view-settings__btn";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                window.dispatchEvent(new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "remove", id: page.id } }));
                requestAnimationFrame(() => paintWorkspacePages(host));
            });
            row.append(remove);
        }
        host.append(row);
    }
};

const bindWorkspacePagesUi = (panel: HTMLElement): void => {
    const host = panel.querySelector<HTMLElement>("[data-workspace-pages]");
    if (host) paintWorkspacePages(host);
    if (panel.dataset.workspacePagesBound === "1") return;
    panel.dataset.workspacePagesBound = "1";
    panel.addEventListener("click", (ev) => {
        const btn = (ev.target as HTMLElement | null)?.closest?.("[data-action]") as HTMLElement | null;
        const action = btn?.getAttribute("data-action") || "";
        if (action === "add-workspace-page") {
            window.dispatchEvent(new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "add" } }));
        } else if (action === "workspace-page-prev") {
            window.dispatchEvent(new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "prev" } }));
        } else if (action === "workspace-page-next") {
            window.dispatchEvent(new CustomEvent("cwsp:workspace-cmd", { detail: { cmd: "next" } }));
        } else {
            return;
        }
        if (host) requestAnimationFrame(() => paintWorkspacePages(host));
    });
};

const persistGridFallback = (grid: WorkspaceGrid): void => {
    try {
        localStorage.setItem(
            GRID_LS_KEY,
            JSON.stringify({
                columns: grid.columns,
                rows: grid.rows,
                shape: grid.shape,
                defaultAction: grid.defaultAction,
                iconScale: grid.iconScale || "fill"
            })
        );
        if (grid.defaultOpenLinkTarget) {
            localStorage.setItem(OPEN_LINK_LS_KEY, grid.defaultOpenLinkTarget);
        }
    } catch {
        /* private mode */
    }
};

const applyLiveGrid = (grid: WorkspaceGrid): void => {
    let applied = false;
    try {
        window.dispatchEvent(
            new CustomEvent(WORKSPACE_GRID_EVENT, {
                detail: {
                    ...grid,
                    ack: () => {
                        applied = true;
                    }
                }
            })
        );
    } catch {
        /* ignore */
    }
    if (!applied) persistGridFallback(grid);
};

export const registerWorkspaceSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "workspace",
        label: "Workspace",
        order: 18,
        requiresView: "home",
        // WHY: speed-dial hosts only — document PWA must not grow a launcher tab.
        surfaces: ["environment", "crx", "web", "native", "capacitor"],
        excludeSurfaces: ["markdown"],
        render: () =>
            settingsPanel("workspace", "Workspace", [
                settingsHint("Theme, workspaces, and the Speed Dial grid share this page."),
                "Workspaces",
                settingsHint("Pages of the Speed Dial. Explorer roots: /user/workspaces/side-a, side-b, …"),
                (() => {
                    const host = document.createElement("div");
                    host.setAttribute("data-workspace-pages", "1");
                    host.className = "field";
                    return host;
                })(),
                settingsButtonRow(
                    settingsButton("Add workspace", "add-workspace-page"),
                    settingsButton("Previous page", "workspace-page-prev"),
                    settingsButton("Next page", "workspace-page-next")
                ),
                "Grid",
                settingsHint("Speed dial grid on the Home / NTP workspace."),
                settingsSelectField("Default icon shape", "grid.shape", SHAPE_OPTIONS),
                settingsSelectField("Icon bitmap scale", "grid.iconScale", ICON_SCALE_OPTIONS),
                settingsNumberField("Columns", "grid.columns", {
                    min: "1",
                    max: "16",
                    step: "1",
                    placeholder: "4"
                }),
                settingsNumberField("Rows", "grid.rows", {
                    min: "1",
                    max: "16",
                    step: "1",
                    placeholder: "8"
                }),
                "Default actions",
                settingsSelectField("New tile action", "grid.defaultAction", ACTION_OPTIONS),
                settingsSelectField("Open links in", "grid.defaultOpenLinkTarget", OPEN_TARGET_OPTIONS),
                "App menu",
                settingsHint("Installed-app icons in the App Menu. Color uses the painted icon, including mask."),
                settingsSelectField("Sort icons by", "appMenu.sortBy", APP_MENU_SORT_OPTIONS),
                settingsSelectField("Icon order", "appMenu.sortDir", SORT_DIR_OPTIONS)
            ]),
        load: (settings, panel) => {
            const live = readLiveGrid();
            const grid = settings.grid || {};
            setFieldValue(panel, "grid.shape", live.shape || grid.shape || "squircle");
            setFieldValue(panel, "grid.iconScale", live.iconScale || grid.iconScale || "fill");
            setFieldValue(panel, "grid.columns", live.columns ?? grid.columns ?? 4);
            setFieldValue(panel, "grid.rows", live.rows ?? grid.rows ?? 8);
            setFieldValue(panel, "grid.defaultAction", live.defaultAction || grid.defaultAction || "open-link");
            setFieldValue(
                panel,
                "grid.defaultOpenLinkTarget",
                live.defaultOpenLinkTarget || grid.defaultOpenLinkTarget || "inline"
            );
            let liveAppMenu: { sortBy?: string; sortDir?: string } = {};
            try {
                const raw = localStorage.getItem("cwsp-app-menu-sort");
                if (raw) liveAppMenu = JSON.parse(raw) as { sortBy?: string; sortDir?: string };
            } catch {
                /* ignore */
            }
            settings.appMenu = {
                ...(settings.appMenu || {}),
                sortBy: (liveAppMenu.sortBy || settings.appMenu?.sortBy || "name") as NonNullable<
                    typeof settings.appMenu
                >["sortBy"],
                sortDir: (liveAppMenu.sortDir || settings.appMenu?.sortDir || "asc") as NonNullable<
                    typeof settings.appMenu
                >["sortDir"]
            };
            setFieldValue(panel, "appMenu.sortBy", settings.appMenu.sortBy || "name");
            setFieldValue(panel, "appMenu.sortDir", settings.appMenu.sortDir || "asc");
            bindWorkspacePagesUi(panel);
        },
        save: (settings) => {
            const next: WorkspaceGrid = {
                columns: clampGridCount(settings.grid?.columns, 4),
                rows: clampGridCount(settings.grid?.rows, 8),
                shape: normalizeShape(settings.grid?.shape, "squircle"),
                defaultAction: normalizeAction(settings.grid?.defaultAction, "open-link"),
                defaultOpenLinkTarget: normalizeOpenTarget(settings.grid?.defaultOpenLinkTarget, "inline"),
                iconScale: normalizeIconScale(settings.grid?.iconScale, "fill")
            };
            settings.grid = { ...(settings.grid || {}), ...next };
            applyLiveGrid(next);
            try {
                localStorage.setItem(
                    "cwsp-app-menu-sort",
                    JSON.stringify({
                        sortBy: settings.appMenu?.sortBy || "name",
                        sortDir: settings.appMenu?.sortDir || "asc"
                    })
                );
                window.dispatchEvent(new CustomEvent("cwsp:app-menu-sort-change"));
            } catch {
                /* private mode */
            }
        }
    });
