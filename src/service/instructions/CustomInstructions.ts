/*
 * Custom Instructions Service
 * Manages user-defined instructions for AI recognition operations
 */

import { loadSettings, saveSettings } from "../../config/Settings";
import { type AppSettings } from "../../config/SettingsTypes";
import { generateInstructionId, type CustomInstruction } from "./utils";

export type { CustomInstruction };

/**
 * Same behavior as `./utils` `buildInstructionPrompt`, inlined here so the workcenter chunk does not
 * import that symbol from `com/app` (circular init → TDZ). Other modules keep using `utils.ts`.
 */
export function buildInstructionPrompt(baseInstruction: string, customInstruction: string): string {
    if (!customInstruction?.trim()) return baseInstruction;

    return `${baseInstruction}

---

USER CUSTOM INSTRUCTIONS:
${customInstruction.trim()}

---

Apply the user's custom instructions above when processing the data. Prioritize user instructions when they conflict with default behavior.
`;
}

/** Defer read of `generateInstructionId` until call — avoids TDZ when workcenter ↔ com-app chunks cycle. */
const generateId = (): string => generateInstructionId();

export type InstructionRegistrySnapshot = {
    instructions: CustomInstruction[];
    activeId: string;
    activeInstruction: CustomInstruction | null;
};

const byOrderAndLabel = (a: CustomInstruction, b: CustomInstruction): number => {
    const ao = Number.isFinite(a.order as number) ? (a.order as number) : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(b.order as number) ? (b.order as number) : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.label || "").localeCompare(b.label || "");
};

const normalizeInstructions = (items: CustomInstruction[] | undefined | null): CustomInstruction[] =>
    [...(items || [])].sort(byOrderAndLabel);

const pickActiveInstruction = (instructions: CustomInstruction[], activeId?: string): CustomInstruction | null => {
    if (!activeId) return null;
    return instructions.find(i => i.id === activeId) || null;
};

export const getInstructionRegistry = async (): Promise<InstructionRegistrySnapshot> => {
    const settings = await loadSettings();
    const instructions = normalizeInstructions(settings?.ai?.customInstructions);
    const activeInstruction = pickActiveInstruction(instructions, settings?.ai?.activeInstructionId);

    return {
        instructions,
        activeId: activeInstruction?.id || "",
        activeInstruction
    };
};

export const getCustomInstructions = async (): Promise<CustomInstruction[]> => {
    const snapshot = await getInstructionRegistry();
    return snapshot.instructions;
};

export const getActiveInstruction = async (): Promise<CustomInstruction | null> => {
    try {
        const snapshot = await getInstructionRegistry();
        if (!snapshot.activeId) return null;
        if (!snapshot.activeInstruction) {
            console.warn("[CustomInstructions] activeInstructionId not found:", snapshot.activeId);
        }
        return snapshot.activeInstruction;
    } catch (e) {
        console.error("[CustomInstructions] Error in getActiveInstruction:", e);
        return null;
    }
};

export const getActiveInstructionText = async (): Promise<string> => {
    const instruction = await getActiveInstruction();
    return instruction?.instruction || "";
};

export const setActiveInstruction = async (id: string | null): Promise<void> => {
    const settings = await loadSettings();
    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            activeInstructionId: id || ""
        }
    };
    await saveSettings(updated);
};

export const addInstruction = async (label: string, instruction: string): Promise<CustomInstruction> => {
    const settings = await loadSettings();
    const instructions = settings?.ai?.customInstructions || [];

    const newInstruction: CustomInstruction = {
        id: generateId(),
        label: label.trim() || "Untitled",
        instruction: instruction.trim(),
        enabled: true,
        order: instructions.length
    };

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: [...instructions, newInstruction]
        }
    };

    await saveSettings(updated);
    return newInstruction;
};

/**
 * Add multiple instructions at once (avoids race conditions from parallel saves)
 */
export const addInstructions = async (
    items: { label: string; instruction: string; enabled?: boolean }[]
): Promise<CustomInstruction[]> => {
    if (!items.length) return [];

    const settings = await loadSettings();
    const instructions = settings?.ai?.customInstructions || [];

    const newInstructions: CustomInstruction[] = items.map((item, index) => ({
        id: generateId(),
        label: item.label.trim() || "Untitled",
        instruction: item.instruction.trim(),
        enabled: item.enabled ?? true,
        order: instructions.length + index
    }));

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: [...instructions, ...newInstructions]
        }
    };

    await saveSettings(updated);
    return newInstructions;
};

export const updateInstruction = async (id: string, updates: Partial<Omit<CustomInstruction, "id">>): Promise<boolean> => {
    const settings = await loadSettings();
    const instructions = settings?.ai?.customInstructions || [];
    const index = instructions.findIndex((i: { id: string; }) => i.id === id);

    if (index === -1) return false;

    instructions[index] = { ...instructions[index], ...updates };

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: instructions
        }
    };

    await saveSettings(updated);
    return true;
};

export const deleteInstruction = async (id: string): Promise<boolean> => {
    const settings = await loadSettings();
    const instructions = settings?.ai?.customInstructions || [];
    const filtered = instructions.filter((i: { id: string; }) => i.id !== id);

    if (filtered.length === instructions.length) return false;

    // If deleting the active instruction, clear activeInstructionId
    const newActiveId = settings.ai?.activeInstructionId === id ? "" : (settings.ai?.activeInstructionId || "");

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: filtered,
            activeInstructionId: newActiveId
        }
    };

    await saveSettings(updated);
    return true;
};

export const reorderInstructions = async (orderedIds: string[]): Promise<void> => {
    const settings = await loadSettings();
    const instructions = settings?.ai?.customInstructions || [];

    const reordered = orderedIds
        .map((id, index) => {
            const instr = instructions.find((i: { id: string; }) => i.id === id);
            return instr ? { ...instr, order: index } : null;
        })
        .filter((i): i is CustomInstruction & { order: number; } => i !== null && i !== undefined);

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: reordered
        }
    };

    await saveSettings(updated);
};

export const addDefaultTemplates = async (): Promise<CustomInstruction[]> => {
    const settings = await loadSettings();
    const existing = settings?.ai?.customInstructions || [];

    if (existing.length > 0) return existing;

    const { DEFAULT_INSTRUCTION_TEMPLATES } = await import("./templates");
    const newInstructions: CustomInstruction[] = DEFAULT_INSTRUCTION_TEMPLATES.map((template, index) => ({
        ...template,
        id: generateId(),
        order: index
    }));

    const updated: AppSettings = {
        ...settings,
        ai: {
            ...settings.ai,
            customInstructions: newInstructions
        }
    };

    await saveSettings(updated);
    return newInstructions;
};
