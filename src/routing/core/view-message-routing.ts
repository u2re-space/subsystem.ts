import type { View } from "shells/types";
import type { UnifiedMessage } from "com/core/UnifiedMessaging";
import { normalizeViewId } from "com/config/Names";

const VIEW_MESSAGE_FALLBACKS: Record<string, string[]> = {
    viewer: ["content-view", "content-load", "markdown-content"],
    workcenter: ["content-attach", "file-attach", "share-target-input", "content-share"],
    explorer: ["file-save", "navigate-path", "content-explorer"],
    editor: ["content-load", "content-edit"],
    settings: ["settings-update"],
    history: ["history-update"],
    home: ["home-update"],
    airpad: ["content-load"],
    print: ["content-view"]
};

export const inferViewDestination = (viewId: string): string => {
    return normalizeViewId(viewId);
};

const selectMessageTypeForView = (view: View, incomingType: string): string | null => {
    const checks = [incomingType, ...(VIEW_MESSAGE_FALLBACKS[view.id] || [])];
    for (const type of checks) {
        if (!type) continue;
        if (!view.canHandleMessage || view.canHandleMessage(type)) {
            return type;
        }
    }
    return null;
};

export const mapUnifiedMessageToView = (
    view: View,
    message: UnifiedMessage
): { id?: string; type: string; data: unknown; metadata?: unknown } | null => {
    const selectedType = selectMessageTypeForView(view, message.type);
    if (!selectedType) return null;
    const id = typeof message.id === "string" && message.id.trim() ? message.id : undefined;
    return {
        ...(id ? { id } : {}),
        type: selectedType,
        data: message.data,
        metadata: message.metadata
    };
};
