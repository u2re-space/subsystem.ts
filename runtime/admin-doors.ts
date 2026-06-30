export function resolveAdminDoorUrls(): { http: string; https: string } {
    const origin = globalThis.location?.origin ?? "";
    return { http: origin.replace(/^https:/, "http:"), https: origin.replace(/^http:/, "https:") };
}

export function openAdminDoorFromCore(): void {
    const url = resolveAdminDoorUrls().https || resolveAdminDoorUrls().http;
    if (url) globalThis.open?.(url, "_blank", "noopener,noreferrer");
}
