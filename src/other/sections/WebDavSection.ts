import type { SectionConfig } from "com/config/SettingsTypes";

//
export const WebDavSection: SectionConfig = {
    key: "webdav",
    title: "WebDAV Synchronization",
    icon: "cloud-arrow-down",
    description: "Connect to a remote storage endpoint for automatic synchronization.",
    groups: [
        {
            key: "webdav-main",
            label: "Connection",
            fields: [
                { path: "webdav.url", label: "Server URL", type: "text", placeholder: "http://localhost:8080" },
                { path: "webdav.username", label: "Login", type: "text" },
                { path: "webdav.password", label: "Password", type: "password" },
                { path: "webdav.token", label: "Token", type: "password", helper: "Optional personal token." }
            ]
        }
    ]
};
