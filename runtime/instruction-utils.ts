import type { CustomInstruction } from "./app-settings";

export function buildInstructionPrompt(prompt: string, instruction?: CustomInstruction | null): string {
    const content = instruction?.content?.trim();
    return content ? `${content}\n\n${prompt}` : prompt;
}
