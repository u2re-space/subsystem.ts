/**
 * Cross-cutting file/workspace helpers for channels: attachment (viewer/workcenter),
 * “use” surfaces (speed-dial, wallpaper, explorer toolbar), and explorer save (FL-UI OPFS).
 */

import {
    addSpeedDialItem,
    createEmptySpeedDialItem,
    ensureSpeedDialMeta,
    persistWallpaper,
    wallpaperState,
    type SpeedDialItem
} from "core/store/StateStorage";
import {
    ExplorerChannelAction,
    FileAttachmentApiAction,
    WorkcenterChannelAction
} from "views/apis/channel-actions";
import { invokeCrossWordViewChannel, type ViewChannelInvokeResult } from "./view-channel-invoke";

export type { ViewChannelInvokeResult };

/** Merge wallpaper reactive state + persist (SpeedDial/home shell reads `wallpaperState`). */
export function workspaceApplyWallpaper(patch: Partial<{ src: string; opacity: number; blur: number }>): void {
    Object.assign(wallpaperState as object, patch);
    persistWallpaper();
}

/** Use an object URL as wallpaper background (caller may revoke URL later if replacing often). */
export function workspaceApplyWallpaperFromFile(file: File): void {
    const src = URL.createObjectURL(file);
    workspaceApplyWallpaper({ src });
}

/** Pin an arbitrary href on the speed-dial grid (open-link). */
export function workspacePinHrefToSpeedDial(input: {
    href: string;
    label: string;
    icon?: string;
    action?: SpeedDialItem["action"];
}): SpeedDialItem {
    const item = createEmptySpeedDialItem();
    const labelRef = item.label as { value?: string };
    const iconRef = item.icon as { value?: string };
    if (labelRef && typeof labelRef === "object") labelRef.value = input.label;
    if (iconRef && typeof iconRef === "object" && input.icon) iconRef.value = input.icon;
    item.action = input.action || "open-link";
    const meta = ensureSpeedDialMeta(item.id, {
        action: item.action,
        href: input.href,
        description: input.label
    });
    meta.href = input.href;
    addSpeedDialItem(item);
    return item;
}

/** Pin a local file tile (blob URL) for quick open from home/speed-dial. */
export function workspacePinFileToSpeedDial(file: File, label?: string): SpeedDialItem {
    const href = URL.createObjectURL(file);
    return workspacePinHrefToSpeedDial({
        href,
        label: label || file.name || "File",
        icon: "file",
        action: "open-link"
    });
}

/** Attach binary/text files to the loaded Work Center instance. */
export function channelAttachFilesToWorkcenter(files: File[]): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("workcenter", FileAttachmentApiAction.WorkcenterAttach, { files });
}

/** Push markdown/text content into Work Center without a File handle. */
export function channelAttachMarkdownToWorkcenter(text: string, filename?: string): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("workcenter", WorkcenterChannelAction.ContentShare, {
        text,
        content: text,
        filename,
        source: "workspace-files-api"
    });
}

/** Runs viewer’s built-in “attach current document to Work Center” flow (markdown in buffer). */
export function channelAttachViewerDocumentToWorkcenter(): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("viewer", FileAttachmentApiAction.ViewerPushToWorkcenter, {});
}

/** Save a file through the explorer’s wired `ui-file-manager` / OPFS operative. */
export function channelSaveFileThroughExplorer(file: File, destPath?: string): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("explorer", ExplorerChannelAction.FileSave, { file, path: destPath });
}

/** Mirror of FL-UI toolbar “Use” — pick/consume external file into workspace. */
export function channelExplorerRequestUse(): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("explorer", ExplorerChannelAction.RequestUse, {});
}

export function channelExplorerRequestUpload(): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("explorer", ExplorerChannelAction.RequestUpload, {});
}

export function channelExplorerRequestPaste(): Promise<ViewChannelInvokeResult> {
    return invokeCrossWordViewChannel("explorer", ExplorerChannelAction.RequestPaste, {});
}
