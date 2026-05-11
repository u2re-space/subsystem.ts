import type { ViewId } from "shells/types";

export const VIEW_ENABLED_VIEWER = "viewer";
export const VIEW_ENABLED_EDITOR = "editor";
export const VIEW_ENABLED_WORKCENTER = "workcenter";
export const VIEW_ENABLED_EXPLORER = "explorer";
export const VIEW_ENABLED_SETTINGS = "settings";
export const VIEW_ENABLED_HISTORY = "history";
export const VIEW_ENABLED_HOME = "home";
export const VIEW_ENABLED_PRINT = "print";
export const DEFAULT_VIEW_ID = "viewer";

const VIEW_FLAGS: Record<string, string> = {
    viewer: VIEW_ENABLED_VIEWER,
    editor: VIEW_ENABLED_EDITOR,
    workcenter: VIEW_ENABLED_WORKCENTER,
    explorer: VIEW_ENABLED_EXPLORER,
    settings: VIEW_ENABLED_SETTINGS,
    history: VIEW_ENABLED_HISTORY,
    home: VIEW_ENABLED_HOME,
    print: VIEW_ENABLED_PRINT,
};

export const ENABLED_VIEW_IDS = Object.entries(VIEW_FLAGS)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([viewId]) => viewId as ViewId);

export const isEnabledView = (viewId: string): viewId is ViewId => {
    return Boolean(VIEW_FLAGS[viewId]);
};

export const pickEnabledView = (
    preferred: ViewId | string = DEFAULT_VIEW_ID,
    fallback: ViewId | string = DEFAULT_VIEW_ID
): ViewId => {
    if (isEnabledView(preferred)) return preferred;
    if (isEnabledView(fallback)) return fallback;
    if (ENABLED_VIEW_IDS.length > 0) return ENABLED_VIEW_IDS[0];
    return "viewer";
};
