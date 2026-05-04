export function safeFilename(name: string): string {
    const trimmed = (name || "").trim() || "document";
    return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").slice(0, 180);
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250);
}
