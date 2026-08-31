/*
 * Filename: workcenter.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/workcenter.ts
 * FIND:process-ingress
 * TAG:workcenter,share-target
 *
 * Work Center panel: pinned-task defaults plus per-kind share / launch / Capacitor policy.
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
    settingsSelectField,
    settingsTextField
} from "../settings-contribution-ui";

const MODE_OPTIONS: Array<[string, string]> = [
    ["attach", "Attach only"],
    ["process", "Run AI"]
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

export const registerWorkcenterSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "workcenter",
        label: "Work Center",
        order: 65,
        requiresView: "workcenter",
        manualFields: true,
        render: () =>
            settingsPanel("workcenter", "Work Center", [
                settingsCheckboxField("Auto-run pinned tasks", "views.workcenter.autoRunPinned"),
                settingsTextField("Default instruction id", "views.workcenter.defaultInstructionId", "(none)"),
                settingsHeading("Share, launch, and open-with"),
                settingsHint(
                    "Per type: attach only, or run AI with that type’s instruction and copy the result. Capacitor can keep the foreground service so clipboard-write still happens after Share."
                ),
                settingsCheckboxField("Allow automatic AI for shares", "ai.processIngress.autoProcess"),
                settingsCheckboxField(
                    "Capacitor: keep background service and write clipboard",
                    "ai.processIngress.backgroundClipboard"
                ),
                settingsSelectField("AI action", "ai.shareTargetMode", [
                    ["recognize", "Recognize"],
                    ["analyze", "Analyze"]
                ]),
                ...OPEN_KINDS.flatMap((kind) => kindBlock(kind))
            ]),
        load: (settings, panel) => {
            settings.ai = settings.ai || {};
            settings.ai.processIngress = mergeProcessIngress(settings.ai.processIngress);
            if (settings.ai.autoProcessShared === false) settings.ai.processIngress.autoProcess = false;
            fillInstructionSelects(panel, settings);
            bindContributionFields(panel, settings);
        },
        save: (settings, panel) => {
            collectContributionFields(panel, settings);
            settings.ai = settings.ai || {};
            settings.ai.processIngress = mergeProcessIngress(settings.ai.processIngress);
            settings.ai.autoProcessShared = settings.ai.processIngress.autoProcess !== false;
        }
    });
