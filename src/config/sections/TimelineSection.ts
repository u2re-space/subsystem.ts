import type { SectionConfig } from "com/config/SettingsTypes";

//
export const TimelineSection: SectionConfig = {
    key: "timeline",
    title: "Timeline Planner",
    icon: "calendar-plus",
    description: "Choose which preference note should seed generated plans.",
    groups: [
        {
            key: "timeline-source",
            label: "Preference note",
            fields: [
                {
                    path: "timeline.source",
                    label: "Source file",
                    type: "text",
                    helper: "Files inside /docs/preferences appear in this list.",
                    options: [{ value: "", label: "(auto)" }]
                }
            ]
        }
    ]
};