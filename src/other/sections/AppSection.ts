import type { SectionConfig } from "com/config/SettingsTypes.js";

import { AdditionalSection } from "./AdditionalSection.js";

export const AppSection: SectionConfig = {
    key: "app",
    title: "App",
    icon: "paint-roller",
    description: "Appearance, grid layout, UI/UX, inputs, and quick actions.",
    groups: [...AdditionalSection.groups]
};
