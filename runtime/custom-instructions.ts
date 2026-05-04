import type { CustomInstruction } from "./app-settings";

const registry: CustomInstruction[] = [];
let activeId = "";

export function getInstructionRegistry(): CustomInstruction[] {
    return [...registry];
}

export function addInstruction(instruction: CustomInstruction): void {
    registry.push(instruction);
}

export function addInstructions(instructions: CustomInstruction[]): void {
    instructions.forEach(addInstruction);
}

export function updateInstruction(id: string, patch: Partial<CustomInstruction>): void {
    const current = registry.find((entry) => entry.id === id);
    if (current) Object.assign(current, patch);
}

export function deleteInstruction(id: string): void {
    const index = registry.findIndex((entry) => entry.id === id);
    if (index >= 0) registry.splice(index, 1);
}

export function setActiveInstruction(id: string): void {
    activeId = id;
}

export function getActiveInstruction(): CustomInstruction | null {
    return registry.find((entry) => entry.id === activeId) ?? null;
}
