export async function downloadMarkdownAsDocx(markdown: string, filename = "document.docx"): Promise<void> {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.replace(/\.docx$/i, ".md");
    link.click();
    URL.revokeObjectURL(url);
}
