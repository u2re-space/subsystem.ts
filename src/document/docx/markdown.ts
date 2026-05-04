import { marked, type MarkedExtension } from "marked";
import markedKatex from "marked-katex-extension";
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";

const MATH_DELIMITER_PATTERN = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|(?<!\$)\$[^$\n]+\$|\\\([\s\S]*?\\\)/;
const FENCED_CODE_PATTERN = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const MATRIX_ENV_PATTERN = /\\begin\{((?:p|b|B|v|V)?matrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g;

let markedConfigured = false;

function maskCodeSegments(markdown: string): { masked: string; restore: (value: string) => string } {
    const maskedValues: string[] = [];
    const tokenPrefix = "__MD_MASK_";
    const tokenSuffix = "__";

    const mask = (value: string): string =>
        value.replace(FENCED_CODE_PATTERN, (segment) => {
            const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
            maskedValues.push(segment);
            return token;
        });

    const maskInline = (value: string): string =>
        value.replace(INLINE_CODE_PATTERN, (segment) => {
            const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
            maskedValues.push(segment);
            return token;
        });

    const masked = maskInline(mask(markdown));

    return {
        masked,
        restore: (value: string): string =>
            value.replace(/__MD_MASK_(\d+)__/g, (_, index) => maskedValues[Number(index)] ?? ""),
    };
}

export function repairLatexMatrixRowBreaks(input: string): string {
    return (input || "").replace(MATRIX_ENV_PATTERN, (_match, envName: string, body: string) => {
        const fixedBody = (body || "").replace(/(^|[^\\])\\\r?\n/g, "$1\\\\\n");
        return `\\begin{${envName}}${fixedBody}\\end{${envName}}`;
    });
}

function repairLatexInMathDelimiters(markdown: string): string {
    return (markdown || "").replace(MATH_DELIMITER_PATTERN, (segment) => repairLatexMatrixRowBreaks(segment));
}

function replaceKatexNodeWithMathMl(domDoc: globalThis.Document, node: Element, isDisplay: boolean): void {
    const mathMlContainer = node.querySelector(".katex-mathml");
    const mathEl = mathMlContainer?.querySelector("math") || node.querySelector("math");
    if (!mathEl) return;

    const pureMath = mathEl.cloneNode(true) as Element;
    if (!isDisplay) {
        node.replaceWith(pureMath);
        return;
    }

    const wrapper = domDoc.createElement("div");
    wrapper.className = "math-display";
    wrapper.append(pureMath);
    node.replaceWith(wrapper);
}

function normalizeKatexToPureMathMlHtml(inputHtml: string): string {
    const parser = new DOMParser();
    const domDoc = parser.parseFromString(`<div id="katex-root">${inputHtml || ""}</div>`, "text/html");
    const root = domDoc.getElementById("katex-root");
    if (!root) return inputHtml || "";

    // Process display equations first.
    for (const node of Array.from(root.querySelectorAll(".katex-display"))) {
        replaceKatexNodeWithMathMl(domDoc, node, true);
    }

    // Inline equations: only standalone .katex, not ones nested under display wrappers.
    for (const node of Array.from(root.querySelectorAll("span.katex"))) {
        if (node.closest(".katex-display")) continue;
        replaceKatexNodeWithMathMl(domDoc, node, false);
    }

    return root.innerHTML;
}

function ensureMarkedConfigured(): void {
    if (markedConfigured) return;
    markedConfigured = true;

    // Configure marked with KaTeX extension for HTML output with proper delimiters
    marked?.use?.(
        markedKatex({
            throwOnError: false,
            nonStandard: true,
            output: "mathml",
            strict: false,
        }) as unknown as MarkedExtension,
        {
            hooks: {
                preprocess: (markdown: string): string => {
                    if (!MATH_DELIMITER_PATTERN.test(markdown)) {
                        return markdown;
                    }

                    const { masked, restore } = maskCodeSegments(markdown);
                    const katexNode = document.createElement("div");
                    const repairedMathMarkdown = repairLatexInMathDelimiters(masked);
                    katexNode.textContent = repairedMathMarkdown;
                    renderMathInElement(katexNode, {
                        throwOnError: false,
                        nonStandard: true,
                        output: "mathml",
                        strict: false,
                        delimiters: [
                            { left: "$$", right: "$$", display: true },
                            { left: "\\[", right: "\\]", display: true },
                            { left: "$", right: "$", display: false },
                            { left: "\\(", right: "\\)", display: false },
                        ],
                    });

                    const normalized = normalizeKatexToPureMathMlHtml(katexNode.innerHTML);
                    return restore(normalized);
                },
            },
        }
    );
}

export async function markdownToHtml(markdown: string): Promise<string> {
    ensureMarkedConfigured();
    return marked.parse(markdown ?? "", { gfm: true, breaks: true });
}

export function htmlToBody(html: string): HTMLElement {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return doc.body;
}
