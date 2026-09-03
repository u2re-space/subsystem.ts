/*
 * Filename: workcenter.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/workcenter.ts
 * FIND:process-ingress
 * TAG:workcenter,share-target
 *
 * Process panel: per-kind Share Target / Launch Queue / Capacitor policy.
 * INVARIANT: attach vs process is only `ai.processIngress.kinds.*.mode`.
 */

import { bindContributionFields, collectContributionFields, registerSettingsContribution } from "../../SettingsContributions";
import type { AppSettings } from "../../SettingsTypes";
import {
    mergeProcessIngress,
    PROCESS_INGRESS_KIND_LABELS,
    type ProcessIngressKind
} from "../../process-ingress";
import { OPEN_KINDS } from "../../open-policy";
import {
    settingsCheckboxField,
    settingsHeading,
    settingsHint,
    settingsPanel,
    settingsSelectField
} from "../settings-contribution-ui";

const MODE_OPTIONS: Array<[string, string]> = [
    ["attach", "Open as attachment in chat"],
    ["process", "Run AI and write to clipboard"]
];

const instructionSelect = (label: string, path: string): HTMLElement => {
    const wrap = settingsSelectField(label, path, [["", "Active instruction"]]);
    const sel = wrap.querySelector("select");
    sel?.setAttribute("data-instruction-select", "");
    return wrap;
};

const fillInstructionSelects = (panel: HTMLElement, settings: AppSettings): void => {
    const items = settings.ai?.customInstructions || [];
    panel.querySelectorAll<HTMLSelectElement>("[data-instruction-select]").forEach((sel) => {
        const current = sel.value;
        sel.replaceChildren();
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Active instruction";
        sel.appendChild(empty);
        for (const item of items) {
            const opt = document.createElement("option");
            opt.value = item.id;
            opt.textContent = item.label || item.id;
            sel.appendChild(opt);
        }
        if (current && [...sel.options].some((opt) => opt.value === current)) sel.value = current;
    });
};

const kindBlock = (kind: ProcessIngressKind): HTMLElement[] => [
    settingsHeading(PROCESS_INGRESS_KIND_LABELS[kind]),
    settingsSelectField(`When ${PROCESS_INGRESS_KIND_LABELS[kind].toLowerCase()} arrives`, `ai.processIngress.kinds.${kind}.mode`, MODE_OPTIONS),
    instructionSelect("Default instruction", `ai.processIngress.kinds.${kind}.instructionId`),
    settingsCheckboxField("Copy AI result to clipboard", `ai.processIngress.kinds.${kind}.copyToClipboard`)
];

const isNativeSettingsSurface = (): boolean => {
    try {
        const root = document.documentElement;
        const shell = String(root.dataset.cwspNativeShell || root.dataset.cwspSurface || "").toLowerCase();
        if (shell.includes("capacitor") || shell === "native") return true;
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean }; __CWS_NATIVE__?: boolean };
        return Boolean(g.Capacitor?.isNativePlatform?.() || g.__CWS_NATIVE__);
    } catch {
        return false;
    }
};

const dropRetiredProcessFlags = (settings: AppSettings): void => {
    if (settings.ai) {
        delete settings.ai.autoProcessShared;
        delete settings.ai.shareTargetMode;
    }
    const views = (settings as { views?: { workcenter?: Record<string, unknown> } }).views?.workcenter;
    if (views) {
        delete views.autoRunPinned;
        delete views.defaultInstructionId;
    }
};

export const registerWorkcenterSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "workcenter",
        label: "Process",
        order: 20,
        requiresView: "workcenter",
        manualFields: true,
        render: () =>
            settingsPanel("workcenter", "Process", [
                settingsHint(
                    "Share Target, file open, and Launch Queue use the action for each type. Attach puts the file in chat. Process runs AI (and copies the result when that box is on)."
                ),
                ...(isNativeSettingsSurface()
                    ? [
                          settingsCheckboxField(
                              "Android: keep background service for clipboard-write",
                              "ai.processIngress.backgroundClipboard"
                          )
                      ]
                    : []),
                settingsHeading("Incoming file types"),
                ...OPEN_KINDS.flatMap((kind) => kindBlock(kind))
            ]),
        load: (settings, panel) => {
            settings.ai = settings.ai || {};
            settings.ai.processIngress = mergeProcessIngress(settings.ai.processIngress);
            dropRetiredProcessFlags(settings);
            fillInstructionSelects(panel, settings);
            bindContributionFields(panel, settings);
        },
        save: (settings, panel) => {
            collectContributionFields(panel, settings);
            settings.ai = settings.ai || {};
            settings.ai.processIngress = mergeProcessIngress(settings.ai.processIngress);
            dropRetiredProcessFlags(settings);
        }
    });
