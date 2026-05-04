import { H } from "fest/lure";
import type { DocCollection, DocEntry, DocParser } from "../other/utils/Types";
import { formatDateTime, sanitizeDocSnippet, truncateDocSnippet } from "core/text";

//
export const parseMarkdownEntry: DocParser = async ({ collection, file, filePath }) => {
    const text = await file.text();
    const rawTitleLine = text.trim().split(/\r?\n/).find((line) => line.trim().length) || "";
    const sanitizedTitle = sanitizeDocSnippet(rawTitleLine);
    const fallbackTitle = sanitizeDocSnippet(file.name.replace(/\.[^.]+$/, "")) || file.name;
    const title = sanitizedTitle || fallbackTitle;
    const summarySource = text.trim().split(/\r?\n/).slice(0, 6).join(" ");
    const summary = truncateDocSnippet(sanitizeDocSnippet(summarySource));
    const sanitizedBody = sanitizeDocSnippet(text);

    //
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const $setter = (el) => {
        el?.renderMarkdown?.(text);
    }

    const entry: DocEntry = {
        id: `${collection.id}:${filePath}`,
        title,
        subtitle: formatDateTime(file.lastModified),
        summary: summary || undefined,
        path: filePath,
        fileName: file.name,
        collectionId: collection.id,
        modifiedAt: file.lastModified,
        wordCount,
        searchText: [title, summary, truncateDocSnippet(sanitizedBody, 20000)].filter(Boolean).join(" \n").toLowerCase(),
        renderPreview: (container) => {
            container.replaceChildren(
                H`<div class="doc-preview-frame">
                    <header class="doc-preview-header">
                        <div>
                            <h2>${title || file.name}</h2>
                            <p class="doc-subtitle">Updated ${formatDateTime(file.lastModified)}</p>
                        </div>
                        ${wordCount ? H`<span class="doc-meta-tag">${wordCount} words</span>` : null}
                    </header>
                    <md-view ref=${$setter} src=${url}></md-view>
                </div>`
            );
        },
        //dispose: () => URL.revokeObjectURL(url),
        raw: text
    };

    return entry;
};

//
export const unique = <T,>(values: T[]) => Array.from(new Set(values));
export const normalizeCollections = (collections: DocCollection[]): DocCollection[] => {
    return collections.map((collection) => {
        const dirs = collection.dirs?.length
            ? collection.dirs.slice()
            : collection.dir
                ? [collection.dir]
                : [];
        const normalized = { ...collection, dirs };
        if (!normalized.emptyState && collection.description) {
            normalized.emptyState = collection.description;
        }
        return normalized;
    });
};

//
export const ensureCollections = async (COLLECTIONS) => {
    for (const collection of COLLECTIONS) {
        const dirs = collection.dirs ?? (collection.dir ? [collection.dir] : []);
        for (const dir of dirs) {
            try {
                await getDirectoryHandle(null, dir, { create: true } as any);
            } catch (error) {
                console.warn("Failed to ensure directory", dir, error);
            }
        }
    }
};
