export type CoreMode = "endpoint" | "client" | "standalone" | string;

export interface MCPConfig {
    id?: string;
    serverLabel?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
}

export interface CustomInstruction {
    id: string;
    title: string;
    content: string;
    enabled?: boolean;
}

export interface AppSettings {
    appearance?: Record<string, unknown>;
    ai?: Record<string, unknown>;
    general?: Record<string, unknown>;
    mcp?: MCPConfig[];
    customInstructions?: CustomInstruction[];
    [key: string]: unknown;
}

export const BUILTIN_AI_MODELS = [
    "gpt-5.5-high",
    "claude-4.6-sonnet-high-thinking",
    "gemini-3.1-pro"
];
