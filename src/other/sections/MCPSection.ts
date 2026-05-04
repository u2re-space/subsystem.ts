import type { SectionConfig } from "com/config/SettingsTypes";

//
export const MCPSection: SectionConfig = {
    key: "mcp",
    title: "Model Context Protocol",
    icon: "plugs",
    description: "Bridge the assistant with local or remote MCP servers for tool access.",
    groups: [
        {
            key: "mcp-management",
            label: "MCP Servers",
            description: "Manage multiple MCP server connections.",
            fields: []
        }
    ]
};
