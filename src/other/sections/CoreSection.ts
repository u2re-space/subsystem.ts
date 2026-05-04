import type { SectionConfig } from "com/config/SettingsTypes.js";

import { AISection } from "./AISection.js";
import { MCPSection } from "./MCPSection.js";
import { TimelineSection } from "./TimelineSection.js";
import { WebDavSection } from "./WebDavSection.js";

export const CoreSection: SectionConfig = {
    key: "core",
    title: "Core",
    icon: "gear-six",
    description: "AI, MCP, sync, and timeline configuration.",
    groups: [
        ...AISection.groups,
        ...MCPSection.groups,
        ...WebDavSection.groups,
        ...TimelineSection.groups
    ]
};
