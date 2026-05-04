/**
 * Canonical channel action strings for {@link ChannelInvokableView.invokeChannelApi}.
 * Align with UnifiedMessaging `type` / share-target flows where possible.
 */

/** Markdown / binary hand-off into Work Center or from Viewer. */
export const FileAttachmentApiAction = {
    ViewerPushToWorkcenter: "viewer.attach-to-workcenter",
    WorkcenterAttach: "attach-files",
    WorkcenterFileAttach: "file-attach",
    WorkcenterShare: "content-share"
} as const;

/** Home / speed-dial / wallpaper (StateStorage; helpers in `shared/routing/workspace-files-api`). */
export const FileWorkspaceUseAction = {
    WallpaperSet: "workspace.wallpaper-set",
    WallpaperFromFile: "workspace.wallpaper-from-file",
    SpeedDialPinHref: "workspace.speed-dial-pin-href",
    SpeedDialPinFile: "workspace.speed-dial-pin-file"
} as const;

/** explorer + FL-UI `ui-file-manager` wiring */
export const ExplorerChannelAction = {
    NavigatePath: "navigate-path",
    ContentExplorer: "content-explorer",
    Navigate: "navigate",
    GetPath: "get-path",
    /** Payload: `{ file: File, path?: string }` — OPFS save via operative. */
    FileSave: "file-save",
    RequestUpload: "explorer-request-upload",
    RequestPaste: "explorer-request-paste",
    RequestUse: "explorer-request-use"
} as const;

export const WorkcenterChannelAction = {
    ContentShare: "content-share",
    AttachFiles: "attach-files",
    FileAttach: "file-attach",
    ContentProcess: "content-process",
    SetPrompt: "set-prompt",
    ShareTargetInput: "share-target-input"
} as const;

export const ViewerChannelAction = {
    ContentView: "content-view",
    ContentLoad: "content-load",
    SetContent: "set-content",
    OpenUrl: "open-url",
    OpenMarkdownUrl: "open-markdown-url",
    AttachToWorkcenter: FileAttachmentApiAction.ViewerPushToWorkcenter
} as const;

export const SettingsChannelAction = {
    Patch: "patch",
    SettingsUpdate: "settings-update"
} as const;

export const AirpadChannelAction = {
    Start: "start",
    AirpadStart: "airpad-start",
    Retry: "retry"
} as const;

export const HomeChannelAction = {
    Navigate: "navigate",
    OpenView: "open-view",
    ...FileWorkspaceUseAction
} as const;

export const HistoryChannelAction = {
    Reload: "reload",
    Refresh: "refresh"
} as const;

export const EditorChannelAction = {
    ContentLoad: "content-load",
    SetContent: "set-content",
    ContentEdit: "content-edit"
} as const;
