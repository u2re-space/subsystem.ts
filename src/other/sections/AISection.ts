import { BUILTIN_AI_MODELS, type SectionConfig } from "com/config/SettingsTypes";

//
export const AISection: SectionConfig = {
    key: "ai",
    title: "AI Integration",
    icon: "cpu",
    description: "Manage credentials for your AI provider and optional bridge services.",
    groups: [
        {
            key: "ai-credentials",
            label: "Credentials",
            fields: [
                { path: "ai.baseUrl", label: "Base URL", type: "text", placeholder: "https://api.openai.com/v1" },
                { path: "ai.apiKey", label: "API key", type: "password", placeholder: "sk-..." },
                {
                    path: "ai.model",
                    label: "Model",
                    type: "select",
                    options: [
                        ...BUILTIN_AI_MODELS.map((model) => ({ value: model, label: model })),
                        { value: "custom", label: "Custom..." }
                    ]
                }
            ]
        },
        {
            key: "custom-model",
            label: "Custom model",
            description: "Provide a fully-qualified model identifier.",
            fields: [
                { path: "ai.customModel", label: "Model identifier", type: "text", placeholder: "provider/model" }
            ]
        },
        {
            key: "advanced-runtime",
            label: "Advanced Runtime",
            description: "Default effort/verbosity, token limits, context, retries, and tool-call caps.",
            collapsible: true,
            startOpen: false,
            fields: [
                {
                    path: "ai.defaultReasoningEffort",
                    label: "Default reasoning effort",
                    type: "select",
                    options: [
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" }
                    ]
                },
                {
                    path: "ai.defaultVerbosity",
                    label: "Default verbosity",
                    type: "select",
                    options: [
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" }
                    ]
                },
                { path: "ai.maxOutputTokens", label: "Max output tokens", type: "text", placeholder: "400000" },
                {
                    path: "ai.contextTruncation",
                    label: "Context truncation",
                    type: "select",
                    options: [
                        { value: "disabled", label: "Disabled" },
                        { value: "auto", label: "Auto" }
                    ]
                },
                {
                    path: "ai.promptCacheRetention",
                    label: "Prompt cache retention",
                    type: "select",
                    options: [
                        { value: "in-memory", label: "In-memory" },
                        { value: "24h", label: "24h" }
                    ]
                },
                { path: "ai.maxToolCalls", label: "Max tool calls", type: "text", placeholder: "8" },
                { path: "ai.requestTimeout.low", label: "Timeout low (ms)", type: "text", placeholder: "60000" },
                { path: "ai.requestTimeout.medium", label: "Timeout medium (ms)", type: "text", placeholder: "300000" },
                { path: "ai.requestTimeout.high", label: "Timeout high (ms)", type: "text", placeholder: "900000" },
                { path: "ai.maxRetries", label: "Max retries", type: "text", placeholder: "2" }
            ]
        },
        {
            key: "custom-instructions",
            label: "Custom Instructions",
            description: "Define custom instructions for AI operations. Instructions are used in 'Recognize & Copy' and can also be applied in Work Center via the instruction selector.",
            collapsible: true,
            startOpen: false,
            fields: []
        }
    ]
};
