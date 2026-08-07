export function safeFilename(name: string): string {
    const trimmed = (name || "").trim() || "document";
    return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").slice(0, 180);
}

export function downloadBlob(blob: Blob, filename: string): void {
    let promised: any = null; // @ts-ignore
    if (typeof showSaveFilePicker !== "undefined") { // @ts-ignore
        promised = showSaveFilePicker({
            suggestedName: filename,
                types: [{
                    description: "Document files",
                    accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] }
                }] //@ts-ignore
            })?.then?.(async (fileHandle: FileHandle) => {
                if (fileHandle) {
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } else {
                    return null;
                }
                return fileHandle;
            })?.catch?.(() => {
                return null;
            });
    } else {
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
}
