/*
 * Filename: open-files.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/open-files.ts
 * FIND:open-policy
 * Change date and time: 01.15.00_30.08.2026
 * Reason for changes: Capacitor Explorer settings write nativeOpen — never Web channels.open.
 */

import { bindContributionFields, registerSettingsContribution } from "../../SettingsContributions";
import { mergeOpenPolicy, resolveHostOpenPolicy, stampHostOpenPolicy, type OpenSurface } from "../../open-policy";
import { isCwspNativeHost } from "../../ecosystem-skus";
import { settingsHint, settingsHeading, settingsPanel, settingsSelectField } from "../settings-contribution-ui";

const SINK_OPTIONS: Array<[string, string]> = [
    ["ask", "Follow default / this app"],
    ["display", "Display here"],
    ["viewer", "Markdown (in this app)"],
    ["document", "CWSP-document"],
    ["explorer", "CWSP-explorer"],
    ["workcenter", "CWSP-process"],
    ["transfer", "CWSP-transfer"],
    ["wallpaper", "Wallpaper if it fits, otherwise viewer"],
    ["external", "New tab / browser"],
    ["system", "Android / system chooser"]
];

/** Document PWA has no Work Center / Explorer host — those sinks swallow drop/paste. */
const DOCUMENT_VIEWER_SINK_OPTIONS: Array<[string, string]> = [
    ["ask", "Follow default / this app"],
    ["display", "Display here"],
    ["viewer", "Markdown (in this app)"],
    ["document", "Stay in this app"],
    ["external", "New tab / browser"]
];

const PLACEMENT_OPTIONS: Array<[string, string]> = [
    ["inline", "Inline window (same tab)"],
    ["native-window", "Separate window"],
    ["new-tab", "New tab (file as-is)"]
];

const ANDROID_EXPLORER_OPEN_OPTIONS: Array<[string, string]> = [
    ["document", "CWSP-document"],
    ["system", "Ask Android (Open with…)"],
    ["transfer", "CWSP-transfer"],
    ["workcenter", "CWSP-process"]
];

const ANDROID_EXPLORER_KIND_OPTIONS: Array<[string, string]> = [
    ["ask", "Follow Open / click"],
    ...ANDROID_EXPLORER_OPEN_OPTIONS
];

const SHELL_IMAGE_OPTIONS: Array<[string, string]> = [
    ["wallpaper", "Wallpaper if it fits, otherwise viewer"],
    ["viewer", "Markdown (in this app)"],
    ["document", "CWSP-document"],
    ["workcenter", "CWSP-process"],
    ["transfer", "CWSP-transfer"],
    ["ask", "Wallpaper if it fits, otherwise pin a shortcut"],
    ["system", "Android / system chooser"],
    ["external", "New tab / browser"]
];

const showSurface = (ctx: { sku?: string; surface?: string; hubSection?: string }, surface: OpenSurface): boolean => {
    const hub = String(ctx.hubSection || "").trim();
    const sku = String(ctx.sku || "").trim();
    const host = String(ctx.surface || "").trim();
    if (hub === "hub") return true;
    if (hub === "document") return surface === "viewer";
    if (hub === "explorer") return surface === "explorer";
    if (hub === "process") return surface === "process";
    if (hub === "transfer") return surface === "transfer";
    if (hub) return surface === "shell";
    if (sku === "document" || host === "markdown") return surface === "viewer";
    if (sku === "explorer") return surface === "explorer";
    if (sku === "process") return surface === "process";
    if (sku === "transfer") return surface === "transfer";
    if (sku === "launcher" || host === "environment") return surface === "shell" || surface === "explorer";
    if (sku === "crx" || host === "crx") return surface === "crx" || surface === "explorer";
    return true;
};

const section = (title: string, hint: string, fields: Array<string | HTMLElement>): HTMLElement[] => [
    settingsHeading(title),
    settingsHint(hint),
    ...fields?.map?.(field => typeof field === "string" ? settingsSelectField(field, field, SINK_OPTIONS) : field)
];

export const registerOpenFilesSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "open-files",
        label: "Open & share",
        order: 22,
        render: (ctx) => {
            const blocks: Array<string | HTMLElement> = [
                settingsHint(
                    "Where files go when you open, share, or launch them. “Follow default” keeps the current app’s behavior."
                )
            ];
            if (showSurface(ctx, "viewer")) {
                const documentSku =
                    ctx.sku === "document" ||
                    ctx.hubSection === "document" ||
                    ctx.surface === "markdown";
                const viewerSinks = documentSku ? DOCUMENT_VIEWER_SINK_OPTIONS : SINK_OPTIONS;
                blocks.push(
                    ...section(
                        "Markdown / document",
                        documentSku
                            ? "Drop, paste, share, and open always paint in this viewer. Sibling-app sinks are not available here."
                            : "Opened, pasted, dropped, or shared into the viewer.",
                        [
                            settingsSelectField("When a file opens", "openPolicy.viewer.channels.open", viewerSinks),
                            settingsSelectField("Share target", "openPolicy.viewer.channels.share-target", viewerSinks),
                            settingsSelectField("Launch queue", "openPolicy.viewer.channels.launch-queue", viewerSinks),
                            settingsSelectField("Markdown", "openPolicy.viewer.kinds.markdown", viewerSinks),
                            settingsSelectField("Text", "openPolicy.viewer.kinds.text", viewerSinks),
                            settingsSelectField(
                                "Documents (PDF, Office)",
                                "openPolicy.viewer.kinds.document",
                                viewerSinks
                            ),
                            settingsSelectField("Images", "openPolicy.viewer.kinds.image", viewerSinks),
                            settingsSelectField("Other files", "openPolicy.viewer.kinds.other", viewerSinks)
                        ]
                    )
                );
            }
            if (showSurface(ctx, "explorer")) {
                /* WHY: launcher Settings used to force surface=environment and show Web fields on the APK. */
                const android =
                    ctx.surface === "capacitor" || ctx.surface === "native" || isCwspNativeHost();
                blocks.push(
                    ...section(
                        "Explorer",
                        android
                            ? "These rows are Android-only. They do not change the site / PWA / CRX. Open / click is CWSP-document or Ask Android; a file-type row overrides it only when it is not “Follow Open / click”."
                            : "These rows are site / PWA / CRX only. They do not change the Android Explorer APK. Markdown and images open in an inline window unless you pick a separate window or a new tab.",
                        android
                            ? [
                                  settingsSelectField(
                                      "Open / click",
                                      "openPolicy.explorer.nativeOpen",
                                      ANDROID_EXPLORER_OPEN_OPTIONS
                                  ),
                                  settingsSelectField(
                                      "Markdown",
                                      "openPolicy.explorer.nativeKinds.markdown",
                                      ANDROID_EXPLORER_KIND_OPTIONS
                                  ),
                                  settingsSelectField(
                                      "Text",
                                      "openPolicy.explorer.nativeKinds.text",
                                      ANDROID_EXPLORER_KIND_OPTIONS
                                  ),
                                  settingsSelectField(
                                      "Documents",
                                      "openPolicy.explorer.nativeKinds.document",
                                      ANDROID_EXPLORER_KIND_OPTIONS
                                  ),
                                  settingsSelectField(
                                      "Images",
                                      "openPolicy.explorer.nativeKinds.image",
                                      ANDROID_EXPLORER_KIND_OPTIONS
                                  ),
                                  settingsSelectField(
                                      "Other files",
                                      "openPolicy.explorer.nativeKinds.other",
                                      ANDROID_EXPLORER_KIND_OPTIONS
                                  )
                              ]
                            : [
                                  settingsSelectField(
                                      "Open markdown / images in",
                                      "openPolicy.explorer.placement",
                                      PLACEMENT_OPTIONS
                                  ),
                                  settingsSelectField("Open / click", "openPolicy.explorer.channels.open", SINK_OPTIONS),
                                  settingsSelectField(
                                      "Double-click",
                                      "openPolicy.explorer.channels.dblclick",
                                      SINK_OPTIONS
                                  ),
                                  settingsSelectField("Markdown", "openPolicy.explorer.kinds.markdown", SINK_OPTIONS),
                                  settingsSelectField("Text", "openPolicy.explorer.kinds.text", SINK_OPTIONS),
                                  settingsSelectField("Documents", "openPolicy.explorer.kinds.document", SINK_OPTIONS),
                                  settingsSelectField("Images", "openPolicy.explorer.kinds.image", SINK_OPTIONS),
                                  settingsSelectField("Other files", "openPolicy.explorer.kinds.other", SINK_OPTIONS)
                              ]
                    )
                );
            }
            if (showSurface(ctx, "shell")) {
                blocks.push(
                    ...section(
                        "Environment / shell",
                        "Launch queue, Capacitor open-with, share, and drop/paste on the home grid. Per-tile “Open link in” still wins.",
                        [
                            settingsSelectField("Share target", "openPolicy.shell.channels.share-target", SINK_OPTIONS),
                            settingsSelectField("Launch queue", "openPolicy.shell.channels.launch-queue", SINK_OPTIONS),
                            settingsSelectField("Capacitor open-with", "openPolicy.shell.channels.capacitor", SINK_OPTIONS),
                            settingsSelectField("Markdown", "openPolicy.shell.kinds.markdown", SINK_OPTIONS),
                            settingsSelectField("Text", "openPolicy.shell.kinds.text", SINK_OPTIONS),
                            settingsSelectField("Documents", "openPolicy.shell.kinds.document", SINK_OPTIONS),
                            settingsHint(
                                "Images on CWSP-shell: a photo that is large enough and not a strip/icon becomes wallpaper. Anything that does not fit opens in the viewer."
                            ),
                            settingsSelectField("Images", "openPolicy.shell.kinds.image", SHELL_IMAGE_OPTIONS),
                            settingsSelectField("Links", "openPolicy.shell.kinds.url", SINK_OPTIONS)
                        ]
                    )
                );
            }
            if (showSurface(ctx, "crx")) {
                blocks.push(
                    ...section("Chrome extension", "Markdown, images, documents, and snip results from CWSP-crx.", [
                        settingsSelectField("Markdown", "openPolicy.crx.kinds.markdown", SINK_OPTIONS),
                        settingsSelectField("Documents", "openPolicy.crx.kinds.document", SINK_OPTIONS),
                        settingsSelectField("Images", "openPolicy.crx.kinds.image", SINK_OPTIONS),
                        settingsSelectField("Snip results", "openPolicy.crx.channels.snip", SINK_OPTIONS)
                    ])
                );
            }
            if (showSurface(ctx, "process")) {
                blocks.push(
                    ...section("Work Center / process", "Defaults when Work Center is the receiver (share, launch, open-with).", [
                        settingsSelectField("Text", "openPolicy.process.kinds.text", SINK_OPTIONS),
                        settingsSelectField("Documents", "openPolicy.process.kinds.document", SINK_OPTIONS),
                        settingsSelectField("Images", "openPolicy.process.kinds.image", SINK_OPTIONS),
                        settingsSelectField("Links", "openPolicy.process.kinds.url", SINK_OPTIONS),
                        settingsSelectField("Share target", "openPolicy.process.channels.share-target", SINK_OPTIONS),
                        settingsSelectField("Launch queue", "openPolicy.process.channels.launch-queue", SINK_OPTIONS),
                        settingsSelectField("Capacitor open-with", "openPolicy.process.channels.capacitor", SINK_OPTIONS)
                    ])
                );
            }
            if (showSurface(ctx, "transfer")) {
                blocks.push(
                    ...section("Transfer", "What to do when Transfer receives a type or share.", [
                        settingsSelectField("Text", "openPolicy.transfer.kinds.text", SINK_OPTIONS),
                        settingsSelectField("Documents", "openPolicy.transfer.kinds.document", SINK_OPTIONS),
                        settingsSelectField("Images", "openPolicy.transfer.kinds.image", SINK_OPTIONS),
                        settingsSelectField("Links", "openPolicy.transfer.kinds.url", SINK_OPTIONS),
                        settingsSelectField("Share target", "openPolicy.transfer.channels.share-target", SINK_OPTIONS)
                    ])
                );
            }
            return settingsPanel("open-files", "Open & share", blocks);
        },
        load: (settings, panel) => {
            settings.openPolicy = resolveHostOpenPolicy(settings);
            bindContributionFields(panel, settings);
        },
        save: (settings) => {
            settings.openPolicy = mergeOpenPolicy(settings.openPolicy);
            stampHostOpenPolicy(settings);
        }
    });
