/*
 * Filename: open-files.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/open-files.ts
 * FIND:open-policy
 * Change date and time: 21.55.00_28.08.2026
 * Reason for changes: Open & share settings — per SKU / channel / file kind.
 */

import { registerSettingsContribution } from "../../SettingsContributions";
import { mergeOpenPolicy, type OpenSurface } from "../../open-policy";
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
    if (sku === "launcher" || host === "environment") return surface === "shell";
    if (sku === "crx" || host === "crx") return surface === "crx";
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
                blocks.push(
                    ...section("Markdown / document", "Opened, pasted, dropped, or shared into the viewer.", [
                        settingsSelectField("When a file opens", "openPolicy.viewer.channels.open", SINK_OPTIONS),
                        settingsSelectField("Share target", "openPolicy.viewer.channels.share-target", SINK_OPTIONS),
                        settingsSelectField("Launch queue", "openPolicy.viewer.channels.launch-queue", SINK_OPTIONS),
                        settingsSelectField("Markdown", "openPolicy.viewer.kinds.markdown", SINK_OPTIONS),
                        settingsSelectField("Text", "openPolicy.viewer.kinds.text", SINK_OPTIONS),
                        settingsSelectField("Documents (PDF, Office)", "openPolicy.viewer.kinds.document", SINK_OPTIONS),
                        settingsSelectField("Images", "openPolicy.viewer.kinds.image", SINK_OPTIONS),
                        settingsSelectField("Other files", "openPolicy.viewer.kinds.other", SINK_OPTIONS)
                    ])
                );
            }
            if (showSurface(ctx, "explorer")) {
                blocks.push(
                    ...section(
                        "Explorer",
                        "Open / click is the default. A file-type row overrides it only when that row is not “Follow default”. Capacitor Explorer has no in-app viewer — Display / Markdown here still open CWSP-document.",
                        [
                        settingsSelectField("Open / click", "openPolicy.explorer.channels.open", SINK_OPTIONS),
                        settingsSelectField("Double-click", "openPolicy.explorer.channels.dblclick", SINK_OPTIONS),
                        settingsSelectField("Share target", "openPolicy.explorer.channels.share-target", SINK_OPTIONS),
                        settingsSelectField("Launch queue", "openPolicy.explorer.channels.launch-queue", SINK_OPTIONS),
                        settingsSelectField("Capacitor open-with", "openPolicy.explorer.channels.capacitor", SINK_OPTIONS),
                        settingsSelectField("Markdown", "openPolicy.explorer.kinds.markdown", SINK_OPTIONS),
                        settingsSelectField("Text", "openPolicy.explorer.kinds.text", SINK_OPTIONS),
                        settingsSelectField("Documents", "openPolicy.explorer.kinds.document", SINK_OPTIONS),
                        settingsSelectField("Images", "openPolicy.explorer.kinds.image", SINK_OPTIONS),
                        settingsSelectField("Other files", "openPolicy.explorer.kinds.other", SINK_OPTIONS)
                    ])
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
            const merged = { ...settings, openPolicy: mergeOpenPolicy(settings.openPolicy) };
            settings.openPolicy = merged.openPolicy;
            /* bindContributionFields runs after load when manualFields is unset */
            void panel;
        },
        save: (settings) => {
            settings.openPolicy = mergeOpenPolicy(settings.openPolicy);
        }
    });
