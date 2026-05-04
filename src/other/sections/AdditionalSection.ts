import type { SectionConfig } from "../SettingsTypes";

export const AdditionalSection: SectionConfig = {
    key: "additional",
    title: "Additional",
    icon: "dots-three-circle",
    description: "Extra tools and configuration.",
    groups: [
        {
            key: "appearance",
            label: "Appearance",
            description: "Customize the look and feel.",
            fields: [
                {
                    path: "appearance.theme",
                    label: "Theme",
                    type: "select",
                    options: [
                        { value: "auto", label: "System Default" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" }
                    ]
                },
                {
                    path: "appearance.color",
                    label: "Accent Color",
                    type: "color-palette",
                    options: [
                        { value: "#469", label: "Default", color: "#469" },
                        { value: "#71717a", label: "Neutral", color: "#71717a" },
                        { value: "#64748b", label: "Slate", color: "#64748b" },
                        { value: "#ef4444", label: "Red", color: "#ef4444" },
                        { value: "#f97316", label: "Orange", color: "#f97316" },
                        { value: "#f59e0b", label: "Amber", color: "#f59e0b" },
                        { value: "#eab308", label: "Yellow", color: "#eab308" },
                        { value: "#84cc16", label: "Lime", color: "#84cc16" },
                        { value: "#22c55e", label: "Green", color: "#22c55e" },
                        { value: "#10b981", label: "Emerald", color: "#10b981" },
                        { value: "#14b8a6", label: "Teal", color: "#14b8a6" },
                        { value: "#06b6d4", label: "Cyan", color: "#06b6d4" },
                        { value: "#3b82f6", label: "Blue", color: "#3b82f6" },
                        { value: "#6366f1", label: "Indigo", color: "#6366f1" },
                        { value: "#8b5cf6", label: "Violet", color: "#8b5cf6" },
                        { value: "#d946ef", label: "Fuchsia", color: "#d946ef" },
                        { value: "#ec4899", label: "Pink", color: "#ec4899" }
                    ]
                },
                {
                    path: "appearance.fontSize",
                    label: "Font Size",
                    type: "select",
                    options: [
                        { value: "small", label: "Small" },
                        { value: "medium", label: "Medium" },
                        { value: "large", label: "Large" }
                    ]
                }
            ]
        },
        {
            key: "markdown-viewer",
            label: "Markdown Viewer",
            description: "User-defined markdown rendering and print styles.",
            fields: [
                {
                    path: "appearance.markdown.customCss",
                    label: "Custom CSS (screen/view)",
                    type: "textarea",
                    placeholder: ".markdown-viewer-content h1 { color: var(--color-primary); }",
                    helper: "Applied to markdown viewer while browsing documents."
                },
                {
                    path: "appearance.markdown.printCss",
                    label: "Custom CSS (print)",
                    type: "textarea",
                    placeholder: ".markdown-viewer-content { font-size: 12pt; }",
                    helper: "Wrapped in @media print when printing markdown."
                },
                {
                    path: "appearance.markdown.extensions",
                    label: "Extensions JSON",
                    type: "textarea",
                    placeholder: "[{\"pattern\":\"==(.+?)==\",\"replacement\":\"<mark>$1</mark>\",\"flags\":\"g\",\"enabled\":true}]",
                    helper: "JSON array of regex replacement rules applied before markdown parsing."
                }
            ]
        },
        {
            key: "grid-layout",
            label: "Grid Layout",
            description: "Configure the home screen grid layout.",
            fields: [
                {
                    path: "grid.columns",
                    label: "Columns",
                    type: "number-select",
                    helper: "Number of columns (4-6)",
                    options: [
                        { value: "4", label: "4 Columns" },
                        { value: "5", label: "5 Columns" },
                        { value: "6", label: "6 Columns" }
                    ]
                },
                {
                    path: "grid.rows",
                    label: "Rows",
                    type: "number-select",
                    helper: "Number of rows (6-12)",
                    options: [
                        { value: "6", label: "6 Rows" },
                        { value: "7", label: "7 Rows" },
                        { value: "8", label: "8 Rows" },
                        { value: "9", label: "9 Rows" },
                        { value: "10", label: "10 Rows" },
                        { value: "11", label: "11 Rows" },
                        { value: "12", label: "12 Rows" }
                    ]
                },
                {
                    path: "grid.shape",
                    label: "Icon Shape",
                    type: "shape-palette",
                    helper: "Shape of grid item icons",
                    options: [
                        // Border-radius based (simple)
                        { value: "square", label: "Square", shape: "square" },
                        { value: "squircle", label: "Squircle", shape: "squircle" },
                        { value: "circle", label: "Circle", shape: "circle" },
                        { value: "rounded", label: "Rounded", shape: "rounded" },
                        { value: "blob", label: "Blob", shape: "blob" },
                        // Clip-path polygonal
                        { value: "hexagon", label: "Hexagon", shape: "hexagon" },
                        { value: "diamond", label: "Diamond", shape: "diamond" },
                        { value: "star", label: "Star", shape: "star" },
                        { value: "badge", label: "Badge", shape: "badge" },
                        { value: "heart", label: "Heart", shape: "heart" },
                        // Clip-path decorative
                        { value: "clover", label: "Clover", shape: "clover" },
                        { value: "flower", label: "Flower", shape: "flower" },
                        // Asymmetric / procedural
                        { value: "tear", label: "Tear", shape: "tear" },
                        { value: "egg", label: "Egg", shape: "egg" },
                        { value: "wavy", label: "Wavy", shape: "wavy" }
                    ]
                }
            ]
        },
        {
            key: "speech",
            label: "Speech Recognition",
            description: "Configure speech recognition settings.",
            fields: [
                {
                    path: "speech.language",
                    label: "Language",
                    type: "select",
                    options: [] // Populated at runtime
                }
            ]
        },
        {
            key: "wallpaper",
            label: "Wallpaper",
            description: "Customize the workspace background.",
            fields: []
        },
        {
            key: "actions",
            label: "Actions",
            description: "Quick actions for the workspace.",
            fields: []
        },
        {
            key: "bluetooth",
            label: "Bluetooth",
            description: "Bluetooth settings.",
            fields: []
        },
        {
            key: "synchronization",
            label: "Synchronization",
            description: "Synchronize the workspace with external services.",
            fields: []
        }
    ]
};
