/**
 * PROCESSING_RULES derived from BUILT_IN_AI_ACTIONS.
 * Types live here so this module does not import UnifiedAIConfig (avoids circular init).
 */
import type { RecognizeByInstructionsOptions } from "../service/service/ProcessingData";
import { AI_INSTRUCTIONS } from "../service/instructions/core";
import { BUILT_IN_AI_ACTIONS } from "../service/instructions/templates";

export type AIProcessingType =
    | "solve-and-answer"
    | "write-code"
    | "extract-css"
    | "recognize-content"
    | "convert-data"
    | "extract-entities"
    | "general-processing";

export interface ProcessingRule {
    type: AIProcessingType;
    instruction: string;
    options?: RecognizeByInstructionsOptions;
    supportedContentTypes: string[];
    priority: number;
}

const AI_PROCESSING_TYPES: readonly AIProcessingType[] = [
    "solve-and-answer",
    "write-code",
    "extract-css",
    "recognize-content",
    "convert-data",
    "extract-entities",
    "general-processing",
] as const;

const toAIProcessingType = (id: string): AIProcessingType | null => {
    const normalized = String(id || "").toLowerCase().replace(/_/g, "-") as AIProcessingType;
    return (AI_PROCESSING_TYPES as readonly string[]).includes(normalized) ? normalized : null;
};

/**
 * Build lazily: eager `BUILT_IN_AI_ACTIONS.map(...)` at module top caused TDZ
 * (`ReferenceError: Cannot access 'n' before initialization`) when Vite/Rollup
 * split `shells/boot-*` and `com/app` chunks — boot could run before `templates`
 * finished initializing the const export.
 */
function buildProcessingRules(): ProcessingRule[] {
    return BUILT_IN_AI_ACTIONS
        .map((action) => {
            const type = toAIProcessingType(action.id);
            if (!type) return null;
            return {
                type,
                instruction: AI_INSTRUCTIONS[action.instructionKey],
                supportedContentTypes: action.supportedContentTypes,
                priority: action.priority,
            } satisfies ProcessingRule;
        })
        .filter((v): v is ProcessingRule => Boolean(v));
}

let cachedProcessingRules: ProcessingRule[] | null = null;

export function getProcessingRules(): ProcessingRule[] {
    if (cachedProcessingRules === null) {
        cachedProcessingRules = buildProcessingRules();
    }
    return cachedProcessingRules;
}
