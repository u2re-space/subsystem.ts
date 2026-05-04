import {
    AlignmentType,
    BorderStyle,
    convertMillimetersToTwip,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ImageRun,
    MathAngledBrackets,
    Math as MathNode,
    type MathComponent,
    MathCurlyBrackets,
    MathFraction,
    MathRadical,
    MathRoundBrackets,
    MathRun,
    MathSquareBrackets,
    MathSubScript,
    MathSubSuperScript,
    MathSuperScript,
    LevelFormat,
    PageOrientation,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableBorders,
    TableCell,
    TableRow,
    TextRun,
    UnderlineType,
    WidthType,
} from "docx";
import { marked, type MarkedExtension } from "marked";
import markedKatex from "marked-katex-extension";
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";

export type DocxExportOptions = {
    title?: string;
    filename?: string;
    creator?: string;
};

let markedConfigured = false;

const ORDERED_LIST_REF = "cw-ordered-list";
const COLORS = {
    text: "1A1A1A",
    border: "D1D5DB",
    borderDark: "666666",
    link: "333333",
    codeBg: "F5F5F5",
    quoteBg: "FAFAFA",
    thBg: "E5E5E5",
} as const;

const FONTS = {
    serif: "Times New Roman",
    mono: "Consolas",
    math: "Cambria Math",
} as const;

const SIZES = {
    // docx uses half-points; 24 = 12pt
    body: 24,
    code: 20,
    h1: 40,
    h2: 32,
    h3: 28,
    h4: 26,
    h5: 24,
    h6: 22,
} as const;

// Word "Normal" baseline + ГОСТ-like overrides for exported DOCX.
const GOST_LAYOUT = {
    page: {
        widthMm: 210,
        heightMm: 297,
        marginTopMm: 20,
        marginRightMm: 15,
        marginBottomMm: 20,
        marginLeftMm: 30,
    },
    paragraph: {
        // ~1.25 cm first-line indent.
        firstLineTwip: 708,
        // 1.5 line spacing in twentieths of a point.
        lineTwip: 360,
    },
} as const;

const MATH_DELIMITER_PATTERN = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|(?<!\$)\$[^$\n]+\$|\\\([\s\S]*?\\\)/;
const FENCED_CODE_PATTERN = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;

function maskCodeSegments(markdown: string): { masked: string; restore: (value: string) => string } {
    const maskedValues: string[] = [];
    const tokenPrefix = "__MD_MASK_";
    const tokenSuffix = "__";

    const mask = (value: string): string => value.replace(FENCED_CODE_PATTERN, (segment) => {
        const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
        maskedValues.push(segment);
        return token;
    });

    const maskInline = (value: string): string => value.replace(INLINE_CODE_PATTERN, (segment) => {
        const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
        maskedValues.push(segment);
        return token;
    });

    const masked = maskInline(mask(markdown));

    return {
        masked,
        restore: (value: string): string => value.replace(/__MD_MASK_(\d+)__/g, (_, index) => maskedValues[Number(index)] ?? "")
    };
}

function ensureMarkedConfigured(): void {
    if (markedConfigured) return;
    markedConfigured = true;

    // Configure marked with KaTeX extension for HTML output with proper delimiters
    marked?.use?.(markedKatex({
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
                // Code fragments are masked above, so HTML here is only from non-code markdown.
                katexNode.innerHTML = masked;
                renderMathInElement(katexNode, {
                    throwOnError: false,
                    nonStandard: true,
                    output: "mathml",
                    strict: false,
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "\\[", right: "\\]", display: true },
                        { left: "$", right: "$", display: false },
                        { left: "\\(", right: "\\)", display: false }
                    ]
                });
    
                return restore(katexNode.innerHTML)
                    .replace(/&gt;/g, ">")
                    .replace(/&lt;/g, "<")
                    .replace(/&amp;/g, "&");
            },
        },
    });
}

function safeFilename(name: string): string {
    const trimmed = (name || "").trim() || "document";
    return trimmed.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").slice(0, 180);
}

function downloadBlob(blob: Blob, filename: string): void {
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

async function markdownToHtml(markdown: string): Promise<string> {
    ensureMarkedConfigured();
    return await marked.parse(markdown ?? "", { gfm: true, breaks: true });
}

function htmlToBody(html: string): HTMLElement {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return doc.body;
}

type InlineStyle = {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
};

type InlineChild = TextRun | ExternalHyperlink | MathNode;
type BlockChild = Paragraph | Table;

type ConvertContext = {
    blockIndex: number;
    /** If true, prefer page breaks before H1-like sections */
    chapterByH1: boolean;
};

function textRun(text: string, style: InlineStyle): TextRun {
    return new TextRun({
        text,
        bold: !!style.bold,
        italics: !!style.italic,
        // Keep font/color controlled by doc defaults + paragraph styles.
        // Only override for inline code.
        font: style.code ? FONTS.mono : undefined,
    });
}

function textRunHyperlink(text: string): TextRun {
    return new TextRun({
        text,
        style: "Hyperlink",
    });
}

function breakRun(): TextRun {
    return new TextRun({ break: 1 });
}

function normalizeMathText(s: string): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

function mathComponentsFromMathNode(node: Element): MathComponent[] {
    const tag = node.tagName.toLowerCase();

    // Containers
    if (tag === "math" || tag === "mrow" || tag === "mstyle" || tag === "semantics") {
        const kids: MathComponent[] = [];
        for (const c of Array.from(node.children)) {
            kids.push(...mathComponentsFromMathNode(c));
        }
        if (!kids.length) {
            const t = normalizeMathText(node.textContent || "");
            return t ? [new MathRun(t)] : [];
        }
        return kids;
    }

    // KaTeX often includes <annotation> text; ignore it
    if (tag === "annotation") return [];

    // Runs
    if (tag === "mi" || tag === "mn" || tag === "mtext") {
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }
    if (tag === "mo") {
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    // Fraction: <mfrac><num/><den/></mfrac>
    if (tag === "mfrac") {
        const [num, den] = Array.from(node.children);
        return [
            new MathFraction({
                numerator: num ? mathComponentsFromMathNode(num) : [],
                denominator: den ? mathComponentsFromMathNode(den) : [],
            }),
        ];
    }

    // Matrix table cells/rows: preserve nested structure.
    if (tag === "mtd" || tag === "mtr") {
        const kids: MathComponent[] = [];
        for (const c of Array.from(node.children)) {
            kids.push(...mathComponentsFromMathNode(c));
        }
        if (kids.length) return kids;
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    // Matrix fallback for inline/unsupported contexts.
    // DOCX API does not expose a dedicated matrix MathComponent, so we encode
    // matrix rows/cells as bracketed math runs to keep semantics readable.
    if (tag === "mtable") {
        const rowElements = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === "mtr");
        const matrixChildren: MathComponent[] = [];
        for (let ri = 0; ri < rowElements.length; ri++) {
            const row = rowElements[ri];
            const cellElements = Array.from(row.children).filter((c) => c.tagName.toLowerCase() === "mtd");
            for (let ci = 0; ci < cellElements.length; ci++) {
                matrixChildren.push(...mathComponentsFromMathNode(cellElements[ci]));
                if (ci < cellElements.length - 1) matrixChildren.push(new MathRun(", "));
            }
            if (ri < rowElements.length - 1) matrixChildren.push(new MathRun("; "));
        }
        return matrixChildren.length ? [new MathSquareBrackets({ children: matrixChildren })] : [];
    }

    // Roots
    if (tag === "msqrt") {
        const children: MathComponent[] = [];
        for (const c of Array.from(node.children)) children.push(...mathComponentsFromMathNode(c));
        return [new MathRadical({ children })];
    }
    if (tag === "mroot") {
        const [base, degree] = Array.from(node.children);
        const children = base ? mathComponentsFromMathNode(base) : [];
        const deg = degree ? mathComponentsFromMathNode(degree) : [];
        return [new MathRadical({ children, degree: deg })];
    }

    // Sub/Sup
    if (tag === "msup") {
        const [base, sup] = Array.from(node.children);
        return [
            new MathSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [],
                superScript: sup ? mathComponentsFromMathNode(sup) : [],
            }),
        ];
    }
    if (tag === "msub") {
        const [base, sub] = Array.from(node.children);
        return [
            new MathSubScript({
                children: base ? mathComponentsFromMathNode(base) : [],
                subScript: sub ? mathComponentsFromMathNode(sub) : [],
            }),
        ];
    }
    if (tag === "msubsup") {
        const [base, sub, sup] = Array.from(node.children);
        return [
            new MathSubSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [],
                subScript: sub ? mathComponentsFromMathNode(sub) : [],
                superScript: sup ? mathComponentsFromMathNode(sup) : [],
            }),
        ];
    }

    // Fenced: brackets
    if (tag === "mfenced") {
        const open = (node.getAttribute("open") || "(").trim();
        const close = (node.getAttribute("close") || ")").trim();
        const children: MathComponent[] = [];
        for (const c of Array.from(node.children)) children.push(...mathComponentsFromMathNode(c));

        const wrap = (() => {
            if (open === "(" && close === ")") return MathRoundBrackets;
            if (open === "[" && close === "]") return MathSquareBrackets;
            if (open === "{" && close === "}") return MathCurlyBrackets;
            if (open === "⟨" && close === "⟩") return MathAngledBrackets;
            return MathRoundBrackets;
        })();

        return [new wrap({ children })];
    }

    // Fallback: flatten to a run
    const t = normalizeMathText(node.textContent || "");
    return t ? [new MathRun(t)] : [];
}

function mathFromElement(el: Element): MathNode | null {
    const components = mathComponentsFromMathNode(el);
    if (!components.length) return null;
    return new MathNode({ children: components });
}

type MathMatrixData = {
    rows: Element[][];
    open: string;
    close: string;
};

function extractMathMatrix(mathEl: Element): MathMatrixData | null {
    let fenced: Element | null = null;
    let mtable: Element | null = null;

    for (const candidate of Array.from(mathEl.querySelectorAll("mfenced, mtable"))) {
        const tag = candidate.tagName.toLowerCase();
        if (!fenced && tag === "mfenced" && candidate.querySelector("mtable")) fenced = candidate;
        if (!mtable && tag === "mtable") mtable = candidate;
        if (fenced && mtable) break;
    }
    if (!mtable) return null;

    const rows = Array.from(mtable.querySelectorAll(":scope > mtr")).map((r) =>
        Array.from(r.querySelectorAll(":scope > mtd"))
    );
    if (!rows.length) return null;

    const open = (fenced?.getAttribute("open") || "[").trim() || "[";
    const close = (fenced?.getAttribute("close") || "]").trim() || "]";
    return { rows, open, close };
}

function matrixBracketGlyph(open: string, close: string, rowIndex: number, rowCount: number): { left: string; right: string } {
    const isSingle = rowCount <= 1;
    const isFirst = rowIndex === 0;
    const isLast = rowIndex === rowCount - 1;

    const edge = (o: string, c: string): { left: string; right: string } => ({ left: o, right: c });
    if (open === "(" && close === ")") {
        if (isSingle) return edge("(", ")");
        if (isFirst) return edge("⎛", "⎞");
        if (isLast) return edge("⎝", "⎠");
        return edge("⎜", "⎟");
    }
    if (open === "[" && close === "]") {
        if (isSingle) return edge("[", "]");
        if (isFirst) return edge("⎡", "⎤");
        if (isLast) return edge("⎣", "⎦");
        return edge("⎢", "⎥");
    }
    if (open === "{" && close === "}") {
        if (isSingle) return edge("{", "}");
        if (isFirst) return edge("⎧", "⎫");
        if (isLast) return edge("⎩", "⎭");
        return edge("⎨", "⎬");
    }
    if (open === "⟨" && close === "⟩") {
        if (isSingle) return edge("⟨", "⟩");
        if (isFirst) return edge("⎧", "⎫");
        if (isLast) return edge("⎩", "⎭");
        return edge("⎪", "⎪");
    }
    return edge(open, close);
}

function convertDisplayMathMatrixParagraph(pEl: HTMLElement): BlockChild[] | null {
    const meaningful = Array.from(pEl.childNodes).filter((n) => {
        if (n.nodeType === Node.TEXT_NODE) return !!(n.nodeValue || "").trim();
        return n.nodeType === Node.ELEMENT_NODE;
    });
    if (meaningful.length !== 1 || meaningful[0].nodeType !== Node.ELEMENT_NODE) return null;

    const onlyEl = meaningful[0] as HTMLElement;
    const displayRoot =
        onlyEl.classList.contains("katex-display") ? onlyEl : (onlyEl.querySelector(".katex-display") as HTMLElement | null);
    if (!displayRoot) return null;

    const mathEl = displayRoot.querySelector("math");
    if (!mathEl) return null;
    const matrix = extractMathMatrix(mathEl);
    if (!matrix) return null;

    const rowCount = matrix.rows.length;
    const tableRows = matrix.rows.map((cells, rowIndex) => {
        const bracket = matrixBracketGlyph(matrix.open, matrix.close, rowIndex, rowCount);
        const cellChildren = cells.map((cell) => {
            const math = mathFromElement(cell);
            const children = math ? [math] : [new TextRun({ text: normalizeMathText(cell.textContent || "") })];
            return new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children })],
            });
        });

        return new TableRow({
            children: [
                new TableCell({
                    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: bracket.left, font: FONTS.math })] })],
                }),
                ...cellChildren,
                new TableCell({
                    children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: bracket.right, font: FONTS.math })] })],
                }),
            ],
        });
    });

    return [
        new Table({
            alignment: AlignmentType.CENTER,
            borders: ({
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
            } as any) satisfies TableBorders,
            rows: tableRows,
        }),
    ];
}

function collectInline(node: Node, style: InlineStyle, out: InlineChild[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue ?? "";
        if (!text) return;
        out.push(textRun(text, style));
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
        out.push(new TextRun({ break: 1 }));
        return;
    }

    if (tag === "strong" || tag === "b") {
        for (const child of Array.from(el.childNodes)) collectInline(child, { ...style, bold: true }, out);
        return;
    }

    if (tag === "em" || tag === "i") {
        for (const child of Array.from(el.childNodes)) collectInline(child, { ...style, italic: true }, out);
        return;
    }

    // Inline code (block code handled by <pre>)
    if (tag === "code" && el.parentElement?.tagName.toLowerCase() !== "pre") {
        const text = el.textContent ?? "";
        if (text) out.push(textRun(text, { ...style, code: true }));
        return;
    }

    if (tag === "a") {
        const href = (el.getAttribute("href") || "").trim();
        const children: TextRun[] = [];
        const tmp: InlineChild[] = [];
        for (const child of Array.from(el.childNodes)) collectInline(child, style, tmp);
        for (const c of tmp) {
            if (c instanceof TextRun) children.push(c);
            else children.push(textRunHyperlink((el.textContent || href || "").trim() || href));
        }

        out.push(
            new ExternalHyperlink({
                link: href || (el.textContent || "").trim() || "",
                children: children.length ? children : [textRunHyperlink(href || "link")],
            })
        );
        return;
    }

    // MathML (KaTeX output: <span class="katex-mathml"><math>...</math></span>)
    if (tag === "math") {
        const m = mathFromElement(el);
        if (m) out.push(m);
        else {
            const text = (el.textContent || "").trim();
            if (text) out.push(textRun(text, style));
        }
        return;
    }
    if (tag === "span" && (el.classList.contains("katex") || el.classList.contains("katex-mathml"))) {
        const mathEl = el.querySelector("math");
        if (mathEl) {
            const m = mathFromElement(mathEl);
            if (m) {
                out.push(m);
                return;
            }
        }
    }

    // Keep SVG etc as plain text fallback
    if (tag === "svg") {
        const text = (el.textContent || "").trim();
        if (text) out.push(textRun(text, style));
        return;
    }

    for (const child of Array.from(el.childNodes)) collectInline(child, style, out);
}

function paragraphFromInlineNodes(nodes: ArrayLike<Node>, options?: any): Paragraph {
    const children: InlineChild[] = [];
    for (const n of Array.from(nodes)) collectInline(n, {}, children);

    return new Paragraph({
        widowControl: true,
        ...(options || {}),
        children: children.length ? children : [new TextRun({ text: "" })],
    });
}

type HeadingLevelType = (typeof HeadingLevel)[keyof typeof HeadingLevel];

function headingLevelFromTag(tag: string): HeadingLevelType | undefined {
    if (tag === "h1") return HeadingLevel.HEADING_1;
    if (tag === "h2") return HeadingLevel.HEADING_2;
    if (tag === "h3") return HeadingLevel.HEADING_3;
    if (tag === "h4") return HeadingLevel.HEADING_4;
    if (tag === "h5") return HeadingLevel.HEADING_5;
    if (tag === "h6") return HeadingLevel.HEADING_6;
    return undefined;
}

function convertList(listEl: HTMLElement, ordered: boolean, level: number): BlockChild[] {
    const out: BlockChild[] = [];
    const items = Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === "li") as HTMLElement[];

    for (const li of items) {
        const nestedLists = Array.from(li.children).filter((c) => {
            const t = c.tagName.toLowerCase();
            return t === "ul" || t === "ol";
        }) as HTMLElement[];

        const inlineNodes: Node[] = [];
        for (const child of Array.from(li.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const t = (child as HTMLElement).tagName.toLowerCase();
                if (t === "ul" || t === "ol") continue;
            }
            inlineNodes.push(child);
        }

        const left = 720 * Math.max(1, level + 1);
        const hanging = 360;
        out.push(
            paragraphFromInlineNodes(inlineNodes, {
                style: "ListParagraph",
                bullet: ordered ? undefined : { level },
                numbering: ordered ? { reference: ORDERED_LIST_REF, level } : undefined,
                indent: { left, hanging },
                spacing: { after: 180 },
            })
        );

        for (const nested of nestedLists) {
            const t = nested.tagName.toLowerCase();
            out.push(...convertList(nested, t === "ol", level + 1));
        }
    }

    return out;
}

async function convertTable(tableEl: HTMLElement, ctx: ConvertContext): Promise<Table> {
    const rows = await Promise.all(
        Array.from(tableEl.querySelectorAll("tr")).map(async (tr) => {
            const cells = Array.from(tr.children).filter((c) => {
                const t = c.tagName.toLowerCase();
                return t === "td" || t === "th";
            }) as HTMLElement[];

            const cellRuns = await Promise.all(
                cells.map(async (cellEl) => {
                    const children: BlockChild[] = [];
                    const isHeader = cellEl.tagName.toLowerCase() === "th";
                    // Prefer block-level children inside a cell; fallback to a single paragraph.
                    const hasBlock = Array.from(cellEl.children).some((c) => {
                        const t = c.tagName.toLowerCase();
                        return t === "p" || t === "ul" || t === "ol" || t === "pre" || t === "blockquote" || t === "div";
                    });

                    if (hasBlock) {
                        for (const c of Array.from(cellEl.childNodes)) children.push(...(await convertBlockNode(c, 0, ctx)));
                    } else {
                        children.push(paragraphFromInlineNodes(cellEl.childNodes));
                    }

                    return new TableCell({
                        width: { size: 1, type: WidthType.AUTO },
                        shading: isHeader ? { type: ShadingType.CLEAR, fill: COLORS.thBg, color: "auto" } : undefined,
                        children,
                    });
                })
            );

            return new TableRow({ children: cellRuns });
        })
    );

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: ({
            top: { style: BorderStyle.SINGLE, size: 2, color: COLORS.borderDark },
            bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.borderDark },
            left: { style: BorderStyle.SINGLE, size: 2, color: COLORS.borderDark },
            right: { style: BorderStyle.SINGLE, size: 2, color: COLORS.borderDark },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
        } as any) satisfies TableBorders,
        rows,
    });
}

function convertPre(preEl: HTMLElement): Paragraph[] {
    const codeEl = preEl.querySelector("code");
    const text = (codeEl?.textContent ?? preEl.textContent ?? "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");

    const children: TextRun[] = [];
    for (let i = 0; i < lines.length; i++) {
        children.push(new TextRun({ text: lines[i] }));
        if (i !== lines.length - 1) children.push(breakRun());
    }

    return [
        new Paragraph({
            style: "CodeBlock",
            widowControl: true,
            keepLines: true,
            children,
            spacing: { before: 0, after: 0 },
            border: {
                top: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
                bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
                left: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
                right: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
            },
            shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg, color: "auto" },
            alignment: AlignmentType.LEFT,
        }),
    ];
}

function tryDecodeUriComponent(input: string): string {
    try {
        return decodeURIComponent(input);
    } catch {
        return input;
    }
}

type ParsedDataUrl = { mimeType: string; isBase64: boolean; data: string };

function parseDataUrlLocal(input: string): ParsedDataUrl | null {
    const s = (input || "").trim();
    if (!s.toLowerCase().startsWith("data:")) return null;
    const m = s.match(/^data:(?<mime>[^;,]+)?(?<params>(?:;[^,]*)*?),(?<data>[\s\S]*)$/i);
    if (!m?.groups) return null;
    const mimeType = (m.groups.mime || "application/octet-stream").trim() || "application/octet-stream";
    const params = (m.groups.params || "").toLowerCase();
    const isBase64 = params.includes(";base64");
    const data = m.groups.data ?? "";
    return { mimeType, isBase64, data };
}

function decodeBase64ToBytesLocal(base64: string): Uint8Array {
    const s = (base64 || "").trim().replace(/[\r\n\s]/g, "");
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLen);
    const bin = typeof atob === "function" ? atob(padded) : "";
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function isBase64LikeLocal(input: string): boolean {
    const t = (input || "").trim().replace(/[\r\n\s]/g, "");
    if (!t || t.length < 8) return false;
    const normalized = t.replace(/-/g, "+").replace(/_/g, "/");
    return /^[A-Za-z0-9+/]*={0,2}$/.test(normalized);
}

function looksLikeSvgText(value: string): boolean {
    return /^\s*(<\?xml[\s\S]*?)?<svg[\s\S]*?>/i.test(value || "");
}

function mimeHintFromEncodedSource(src: string): string | undefined {
    const raw = (src || "").trim();
    if (!raw) return undefined;

    const parsed = parseDataUrlLocal(raw);
    if (parsed?.mimeType) return parsed.mimeType;

    const decoded = raw.includes("%") ? tryDecodeUriComponent(raw) : raw;
    const decodedDataUrl = parseDataUrlLocal(decoded);
    if (decodedDataUrl?.mimeType) return decodedDataUrl.mimeType;

    if (looksLikeSvgText(decoded)) return "image/svg+xml";

    // Common base64 signatures (with or without URI encoding).
    const compact = decoded.replace(/[\r\n\s]/g, "");
    if (/^iVBORw0KGgo/i.test(compact)) return "image/png";
    if (/^\/9j\//.test(compact)) return "image/jpeg";
    if (/^R0lGOD/.test(compact)) return "image/gif";
    if (/^Qk/.test(compact)) return "image/bmp";
    if (/^UklGR/i.test(compact)) return "image/webp";
    if (/^(PHN2Zy|PD94bWwg)/i.test(compact)) return "image/svg+xml";

    return undefined;
}

function sniffImageMimeFromBytes(bytes: Uint8Array): string | undefined {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x38 && (bytes[4] === 0x39 || bytes[4] === 0x37) && bytes[5] === 0x61) {
        return "image/gif";
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return "image/webp";
    }

    const head = new TextDecoder("utf-8").decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart();
    if (looksLikeSvgText(head)) return "image/svg+xml";
    return undefined;
}

function imageTypeFromMime(mime: string): "png" | "jpg" | "gif" | "bmp" | undefined {
    const m = (mime || "").toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("jpeg")) return "jpg";
    if (m.includes("jpg")) return "jpg";
    if (m.includes("gif")) return "gif";
    if (m.includes("bmp")) return "bmp";
    return undefined;
}

type BinaryAsset = { bytes: Uint8Array; mimeType: string };

async function normalizeImageBinaryFromSource(src: string): Promise<BinaryAsset | null> {
    const raw = (src || "").trim();
    if (!raw) return null;

    const decoded = raw.includes("%") ? tryDecodeUriComponent(raw) : raw;
    const dataUrl = parseDataUrlLocal(raw) || parseDataUrlLocal(decoded);
    const hasEncodedPayload = !!dataUrl || isBase64LikeLocal(raw) || isBase64LikeLocal(decoded) || looksLikeSvgText(decoded);
    const mimeHint = mimeHintFromEncodedSource(raw);

    if (hasEncodedPayload) {
        try {
            let bytes: Uint8Array;
            let mimeType = mimeHint || "application/octet-stream";

            if (dataUrl) {
                mimeType = dataUrl.mimeType || mimeType;
                const payload = dataUrl.data || "";
                if (dataUrl.isBase64) {
                    bytes = decodeBase64ToBytesLocal(payload);
                } else {
                    const text = payload.includes("%") ? tryDecodeUriComponent(payload) : payload;
                    bytes = new TextEncoder().encode(text);
                }
            } else if (isBase64LikeLocal(raw) || isBase64LikeLocal(decoded)) {
                bytes = decodeBase64ToBytesLocal(isBase64LikeLocal(raw) ? raw : decoded);
            } else {
                bytes = new TextEncoder().encode(decoded);
            }

            mimeType = mimeType || sniffImageMimeFromBytes(bytes) || "application/octet-stream";
            if (mimeType === "application/octet-stream") {
                mimeType = sniffImageMimeFromBytes(bytes) || mimeType;
            }
            return { bytes, mimeType };
        } catch {
            // continue to fetch fallback
        }
    }

    try {
        const res = await fetch(raw);
        if (!res.ok) return null;
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = blob.type || mimeHint || sniffImageMimeFromBytes(bytes) || "application/octet-stream";
        return { bytes, mimeType };
    } catch {
        return null;
    }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buf: ArrayBufferLike = bytes.buffer;
    if (buf instanceof ArrayBuffer) return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    return ab;
}

async function rasterizeToPng(bytes: Uint8Array, mimeType: string): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
    try {
        if (typeof document === "undefined") return null;
        const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
        const url = URL.createObjectURL(blob);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.decoding = "async";
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error("Failed to decode image"));
                image.src = url;
            });

            const width = Math.max(1, Math.round((img.naturalWidth || img.width || 600)));
            const height = Math.max(1, Math.round((img.naturalHeight || img.height || 400)));

            if (typeof OffscreenCanvas !== "undefined") {
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext("2d");
                if (!ctx) return null;
                ctx.drawImage(img, 0, 0, width, height);
                const pngBlob = await canvas.convertToBlob({ type: "image/png" });
                return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), width, height };
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, width, height);
            const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            if (!pngBlob) return null;
            return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), width, height };
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch {
        return null;
    }
}

async function imageRunFromSrc(src: string, alt: string): Promise<ImageRun | null> {
    const data = await normalizeImageBinaryFromSource(src);
    if (!data) return null;

    let bytes = data.bytes;
    let mimeType = (data.mimeType || "").toLowerCase();
    let type = imageTypeFromMime(mimeType);

    // DOCX supports a subset of formats. Convert unsupported image payloads
    // (e.g. SVG/WebP/URI-encoded sources) to PNG for reliable embedding.
    if (!type) {
        const rasterized = await rasterizeToPng(bytes, mimeType || "application/octet-stream");
        if (!rasterized) return null;
        bytes = rasterized.bytes;
        mimeType = "image/png";
        type = "png";
    }

    const { width, height } = await getImageSize(bytes, mimeType);
    return new ImageRun({
        type,
        data: bytes,
        transformation: fitImageToWidth(width, height, 600),
        altText: alt ? { title: alt, description: alt, name: alt } : undefined,
    });
}

async function getImageSize(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
    try {
        if (typeof createImageBitmap !== "function") return { width: 600, height: 400 };
        const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
        const bmp: any = await createImageBitmap(blob);
        const width = Number(bmp?.width || 600);
        const height = Number(bmp?.height || 400);
        try { bmp?.close?.(); } catch { /* ignore */ }
        return { width, height };
    } catch {
        return { width: 600, height: 400 };
    }
}

function fitImageToWidth(width: number, height: number, maxWidth: number): { width: number; height: number } {
    const w = Math.max(1, width || 1);
    const h = Math.max(1, height || 1);
    if (w <= maxWidth) return { width: w, height: h };
    const ratio = maxWidth / w;
    return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

async function convertBlockNode(node: Node, listLevel: number, ctx: ConvertContext): Promise<BlockChild[]> {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.nodeValue ?? "").trim();
        if (!text) return [];
        return [new Paragraph({ children: [textRun(text, {})] })];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "p") {
        const displayMatrix = convertDisplayMathMatrixParagraph(el);
        if (displayMatrix) return displayMatrix;

        const imgs = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "img") as HTMLElement[];
        const hasOnlyImg =
            imgs.length === 1 &&
            el.childNodes.length === 1 &&
            el.firstElementChild?.tagName.toLowerCase() === "img";
        if (hasOnlyImg) {
            return await convertBlockNode(imgs[0], listLevel, ctx);
        }
        return [paragraphFromInlineNodes(el.childNodes)];
    }

    const heading = headingLevelFromTag(tag);
    if (heading) {
        const isH1 = heading === HeadingLevel.HEADING_1;
        const wantsPageBreakBefore =
            (ctx.chapterByH1 && isH1 && ctx.blockIndex > 0) ||
            el.classList.contains("print-chapter") ||
            el.classList.contains("print-break-before");
        const withBorder =
            heading === HeadingLevel.HEADING_1 || heading === HeadingLevel.HEADING_2
                ? {
                      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border } },
                  }
                : undefined;
        return [
            paragraphFromInlineNodes(el.childNodes, {
                heading,
                spacing: { before: 200, after: 120 },
                keepNext: true,
                keepLines: true,
                pageBreakBefore: wantsPageBreakBefore || undefined,
                ...withBorder,
            }),
        ];
    }

    if (tag === "hr") {
        return [
            new Paragraph({
                thematicBreak: true,
                border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border } },
                spacing: { before: 200, after: 200 },
            }),
        ];
    }

    if (tag === "blockquote") {
        const out: BlockChild[] = [];
        const quoteDecor = {
            style: "Quote",
            indent: { left: 720 },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.borderDark } },
            shading: { type: ShadingType.CLEAR, fill: COLORS.quoteBg, color: "auto" },
            spacing: { after: 240 },
        } as const;

        for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                const t = (child.nodeValue ?? "").trim();
                if (t) out.push(new Paragraph({ ...quoteDecor, children: [textRun(t, {})] }));
                continue;
            }

            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const ce = child as HTMLElement;
            const ct = ce.tagName.toLowerCase();

            if (ct === "p") {
                out.push(paragraphFromInlineNodes(ce.childNodes, quoteDecor));
                continue;
            }

            const heading = headingLevelFromTag(ct);
            if (heading) {
                out.push(
                    paragraphFromInlineNodes(ce.childNodes, {
                        ...quoteDecor,
                        heading,
                        spacing: { before: 200, after: 120 },
                    })
                );
                continue;
            }

            if (ct === "ul" || ct === "ol") {
                out.push(...convertList(ce, ct === "ol", listLevel));
                continue;
            }

            if (ct === "pre") {
                const codeEl = ce.querySelector("code");
                const text = (codeEl?.textContent ?? ce.textContent ?? "").replace(/\r\n/g, "\n");
                const lines = text.split("\n");
                const children: TextRun[] = [];
                for (let i = 0; i < lines.length; i++) {
                    children.push(new TextRun({ text: lines[i] }));
                    if (i !== lines.length - 1) children.push(breakRun());
                }
                out.push(
                    new Paragraph({
                        ...quoteDecor,
                        style: "CodeBlock",
                        keepLines: true,
                        children,
                        spacing: { before: 0, after: 0 },
                        shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg, color: "auto" },
                        alignment: AlignmentType.LEFT,
                    })
                );
                continue;
            }

            const t = (ce.textContent ?? "").trim();
            if (t) out.push(new Paragraph({ ...quoteDecor, children: [textRun(t, {})] }));
        }

        return out.length ? out : [new Paragraph({ ...quoteDecor, children: [textRun((el.textContent || "").trim(), {})] })];
    }

    if (tag === "pre") return convertPre(el);

    if (tag === "ul") return convertList(el, false, listLevel);
    if (tag === "ol") return convertList(el, true, listLevel);

    if (tag === "table") return [await convertTable(el, ctx)];

    if (tag === "img") {
        const alt = (el.getAttribute("alt") || "").trim();
        const src = (el.getAttribute("src") || "").trim();
        const img = await imageRunFromSrc(src, alt);
        if (!img) {
            return [
                new Paragraph({
                    children: [textRun(`[image${alt ? `: ${alt}` : ""}] ${src ? `(${src})` : ""}`.trim(), {})],
                }),
            ];
        }
        const blocks: BlockChild[] = [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                keepLines: true,
                children: [img],
            }),
        ];
        if (alt) {
            blocks.push(
                new Paragraph({
                    style: "Caption",
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 200 },
                    children: [new TextRun({ text: alt, italics: true })],
                })
            );
        }
        return blocks;
    }

    // Common wrappers like div/section/article: recurse, but keep structure
    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
        const out: BlockChild[] = [];
        for (const child of Array.from(el.childNodes)) out.push(...(await convertBlockNode(child, listLevel, ctx)));
        return out;
    }

    return [paragraphFromInlineNodes(el.childNodes)];
}

export async function createDocxBlobFromHtml(html: string, options: DocxExportOptions = {}): Promise<Blob> {
    const title = options.title || "Document";
    const body = htmlToBody(html);
    const children: BlockChild[] = [];
    const ctx: ConvertContext = { blockIndex: 0, chapterByH1: true };

    for (const node of Array.from(body.childNodes)) {
        children.push(...(await convertBlockNode(node, 0, ctx)));
        ctx.blockIndex++;
    }

    const doc = new Document({
        creator: options.creator || "CrossWord",
        title,
        styles: {
            default: {
                document: {
                    run: {
                        font: FONTS.serif,
                        size: SIZES.body,
                        color: COLORS.text,
                    },
                    paragraph: {
                        // Word "Normal" baseline with ГОСТ-like line spacing.
                        spacing: { line: GOST_LAYOUT.paragraph.lineTwip, before: 0, after: 0 },
                        indent: { firstLine: GOST_LAYOUT.paragraph.firstLineTwip },
                        alignment: AlignmentType.JUSTIFIED,
                    },
                },
            },
            characterStyles: [
                {
                    id: "Hyperlink",
                    name: "Hyperlink",
                    basedOn: "DefaultParagraphFont",
                    quickFormat: true,
                    run: {
                        color: COLORS.link,
                        underline: { type: UnderlineType.SINGLE, color: COLORS.link },
                    },
                },
            ],
            paragraphStyles: [
                {
                    id: "Normal",
                    name: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { line: GOST_LAYOUT.paragraph.lineTwip, before: 0, after: 0 },
                        indent: { firstLine: GOST_LAYOUT.paragraph.firstLineTwip },
                        alignment: AlignmentType.JUSTIFIED,
                    },
                    run: { font: FONTS.serif, color: COLORS.text, size: SIZES.body },
                },
                {
                    id: "ListParagraph",
                    name: "List Paragraph",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { after: 180 },
                        indent: { firstLine: 0 },
                    },
                    run: { font: FONTS.serif, color: COLORS.text, size: SIZES.body },
                },
                {
                    id: "Quote",
                    name: "Quote",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { after: 240 },
                        indent: { left: 720, firstLine: 0 },
                    },
                    run: { font: FONTS.serif, color: COLORS.text, italics: true, size: SIZES.body },
                },
                {
                    id: "CodeBlock",
                    name: "Code Block",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { before: 120, after: 120 },
                        alignment: AlignmentType.LEFT,
                        indent: { firstLine: 0 },
                    },
                    run: { font: FONTS.mono, color: COLORS.link, size: SIZES.code },
                },
                {
                    id: "Caption",
                    name: "Caption",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: { spacing: { before: 80, after: 160 }, indent: { firstLine: 0 } },
                    run: { font: FONTS.serif, color: COLORS.link, size: 20, italics: true },
                },
                {
                    id: "Heading1",
                    name: "Heading 1",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h1 },
                    paragraph: { spacing: { before: 320, after: 160 } },
                },
                {
                    id: "Heading2",
                    name: "Heading 2",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h2 },
                    paragraph: { spacing: { before: 280, after: 140 } },
                },
                {
                    id: "Heading3",
                    name: "Heading 3",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h3 },
                    paragraph: { spacing: { before: 240, after: 120 } },
                },
                {
                    id: "Heading4",
                    name: "Heading 4",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h4 },
                    paragraph: { spacing: { before: 220, after: 120 } },
                },
                {
                    id: "Heading5",
                    name: "Heading 5",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h5 },
                    paragraph: { spacing: { before: 200, after: 100 } },
                },
                {
                    id: "Heading6",
                    name: "Heading 6",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: { font: FONTS.serif, bold: true, color: COLORS.text, size: SIZES.h6 },
                    paragraph: { spacing: { before: 180, after: 100 } },
                },
            ],
        },
        numbering: {
            config: [
                {
                    reference: ORDERED_LIST_REF,
                    levels: [
                        {
                            level: 0,
                            format: LevelFormat.DECIMAL,
                            text: "%1.",
                            alignment: AlignmentType.LEFT,
                        },
                        {
                            level: 1,
                            format: LevelFormat.LOWER_LETTER,
                            text: "%2.",
                            alignment: AlignmentType.LEFT,
                        },
                        {
                            level: 2,
                            format: LevelFormat.LOWER_ROMAN,
                            text: "%3.",
                            alignment: AlignmentType.LEFT,
                        },
                    ],
                },
            ],
        },
        sections: [
            {
                properties: {
                    page: {
                        size: {
                            orientation: PageOrientation.PORTRAIT,
                            width: convertMillimetersToTwip(GOST_LAYOUT.page.widthMm),
                            height: convertMillimetersToTwip(GOST_LAYOUT.page.heightMm),
                        },
                        margin: {
                            top: convertMillimetersToTwip(GOST_LAYOUT.page.marginTopMm),
                            right: convertMillimetersToTwip(GOST_LAYOUT.page.marginRightMm),
                            bottom: convertMillimetersToTwip(GOST_LAYOUT.page.marginBottomMm),
                            left: convertMillimetersToTwip(GOST_LAYOUT.page.marginLeftMm),
                        },
                    },
                },
                children,
            },
        ],
    });

    // Improve justified text handling for soft line breaks (Shift+Enter equivalents)
    // https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/paragraph.md
    try {
        (doc as any).Settings?.addCompatibility?.()?.doNotExpandShiftReturn?.();
    } catch {
        // ignore
    }

    return await Packer.toBlob(doc);
}

export async function createDocxBlobFromMarkdown(markdown: string, options: DocxExportOptions = {}): Promise<Blob> {
    const html = await markdownToHtml(markdown ?? "");
    return await createDocxBlobFromHtml(html, options);
}

export async function downloadMarkdownAsDocx(markdown: string, options: DocxExportOptions = {}): Promise<void> {
    const title = options.title || "Document";
    const filename = options.filename || `${safeFilename(title)}.docx`;
    const blob = await createDocxBlobFromMarkdown(markdown ?? "", options);
    downloadBlob(blob, filename);
}

export async function downloadHtmlAsDocx(html: string, options: DocxExportOptions = {}): Promise<void> {
    const title = options.title || "Document";
    const filename = options.filename || `${safeFilename(title)}.docx`;
    const blob = await createDocxBlobFromHtml(html ?? "", options);
    downloadBlob(blob, filename);
}
