import type { ActionContext, ActionInput } from "./action-history";

export const executionCore = {
    async execute(input: ActionInput, context: ActionContext, options?: Record<string, unknown>) {
        const started = Date.now();
        const text = input.text || "No prompt provided.";
        return {
            type: "text",
            content: text,
            input,
            context,
            options,
            processingTime: Date.now() - started
        };
    }
};
