import {
    AlignmentType,
    BorderStyle,
    convertMillimetersToTwip,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    Math as MathNode,
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
import { COLORS, FONTS, GOST_LAYOUT, ORDERED_LIST_REF, SIZES } from "./docx/constants";
import { downloadBlob, safeFilename } from "./docx/download";
import { imageRunFromSrc } from "./docx/image";
import { htmlToBody, markdownToHtml } from "./docx/markdown";
import { buildDisplayMatrixBlocks, convertDisplayMathMatrixParagraph, mathFromElement } from "./docx/math";
import type { DocxExportOptions } from "./docx/types";

export type { DocxExportOptions } from "./docx/types";

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
    /** Suppress page break for the first H2 after each H1 */
    firstH2AfterH1Pending: boolean;
    /** Tracks whether non-heading content appears after latest H1 */
    sawContentSinceLastH1: boolean;
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
    const rawText = Array.from(nodes)
        .map((n) =>
            n.nodeType === Node.TEXT_NODE ? (n.nodeValue || "") : ((n as HTMLElement).textContent || "")
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    const isShortParagraph = rawText.length > 0 && rawText.length <= 120;

    return new Paragraph({
        widowControl: true,
        alignment: options?.alignment ?? (isShortParagraph ? AlignmentType.LEFT : undefined),
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
    const items = Array.from(listEl.children).filter(
        (c) => c.tagName.toLowerCase() === "li"
    ) as HTMLElement[];

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
                alignment: AlignmentType.LEFT,
                indent: { left, hanging },
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
                        return (
                            t === "p" ||
                            t === "ul" ||
                            t === "ol" ||
                            t === "pre" ||
                            t === "blockquote" ||
                            t === "div"
                        );
                    });

                    if (hasBlock) {
                        for (const c of Array.from(cellEl.childNodes))
                            children.push(...(await convertBlockNode(c, 0, ctx)));
                    } else {
                        children.push(paragraphFromInlineNodes(cellEl.childNodes));
                    }

                    return new TableCell({
                        width: { size: 1, type: WidthType.AUTO },
                        shading: isHeader
                            ? { type: ShadingType.CLEAR, fill: COLORS.thBg, color: "auto" }
                            : undefined,
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

async function convertBlockNode(
    node: Node,
    listLevel: number,
    ctx: ConvertContext
): Promise<BlockChild[]> {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.nodeValue ?? "").trim();
        if (!text) return [];
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return [new Paragraph({ children: [textRun(text, {})] })];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "math") {
        const displayMatrix = await buildDisplayMatrixBlocks(el);
        if (displayMatrix) {
            if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
            return displayMatrix;
        }
    }

    if (tag === "div" && (el.classList.contains("math-display") || el.classList.contains("katex-display"))) {
        const mathEl = el.querySelector("math");
        if (mathEl) {
            const displayMatrix = await buildDisplayMatrixBlocks(mathEl);
            if (displayMatrix) {
                if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
                return displayMatrix;
            }
        }
    }

    if (tag === "p") {
        const displayMatrix = await convertDisplayMathMatrixParagraph(el);
        if (displayMatrix) {
            if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
            return displayMatrix;
        }
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;

        const imgs = Array.from(el.children).filter(
            (c) => c.tagName.toLowerCase() === "img"
        ) as HTMLElement[];
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
        const isH2 = heading === HeadingLevel.HEADING_2;
        const skipBreakForImmediateFirstH2 =
            isH2 && ctx.firstH2AfterH1Pending && !ctx.sawContentSinceLastH1;
        const shouldBreakBeforeH2 = isH2 && ctx.blockIndex > 0 && !skipBreakForImmediateFirstH2;
        const wantsPageBreakBefore =
            (ctx.chapterByH1 && isH1 && ctx.blockIndex > 0) ||
            shouldBreakBeforeH2 ||
            el.classList.contains("print-chapter") ||
            el.classList.contains("print-break-before");

        if (isH1) {
            ctx.firstH2AfterH1Pending = true;
            ctx.sawContentSinceLastH1 = false;
        } else if (isH2) {
            ctx.firstH2AfterH1Pending = false;
            ctx.sawContentSinceLastH1 = false;
        } else if (ctx.firstH2AfterH1Pending) {
            ctx.sawContentSinceLastH1 = true;
        }

        const withBorder =
            heading === HeadingLevel.HEADING_1 || heading === HeadingLevel.HEADING_2
                ? {
                      border: {
                          bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
                      },
                  }
                : undefined;
        return [
            paragraphFromInlineNodes(el.childNodes, {
                heading,
                spacing: { before: 200, after: 120 },
                keepNext: true,
                keepLines: true,
                alignment:
                    heading === HeadingLevel.HEADING_1 || heading === HeadingLevel.HEADING_2
                        ? AlignmentType.CENTER
                        : AlignmentType.LEFT,
                pageBreakBefore: wantsPageBreakBefore || undefined,
                ...withBorder,
            }),
        ];
    }

    if (tag === "hr") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return [
            new Paragraph({
                thematicBreak: true,
                border: {
                    bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border },
                },
                spacing: { before: 200, after: 200 },
            }),
        ];
    }

    if (tag === "blockquote") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        const out: BlockChild[] = [];
        const quoteDecor = {
            style: "Quote",
            indent: { left: 720 },
            border: {
                left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.borderDark },
            },
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
                const text = (codeEl?.textContent ?? ce.textContent ?? "").replace(
                    /\r\n/g,
                    "\n"
                );
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

        return out.length
            ? out
            : [
                  new Paragraph({
                      ...quoteDecor,
                      children: [textRun((el.textContent || "").trim(), {})],
                  }),
              ];
    }

    if (tag === "pre") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return convertPre(el);
    }

    if (tag === "ul") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return convertList(el, false, listLevel);
    }
    if (tag === "ol") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return convertList(el, true, listLevel);
    }

    if (tag === "table") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        return [await convertTable(el, ctx)];
    }

    if (tag === "img") {
        if (ctx.firstH2AfterH1Pending) ctx.sawContentSinceLastH1 = true;
        const alt = (el.getAttribute("alt") || "").trim();
        const src = (el.getAttribute("src") || "").trim();
        const img = await imageRunFromSrc(src, alt);
        if (!img) {
            return [
                new Paragraph({
                    children: [
                        textRun(
                            `[image${alt ? `: ${alt}` : ""}] ${
                                src ? `(${src})` : ""
                            }`.trim(),
                            {}
                        ),
                    ],
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
        for (const child of Array.from(el.childNodes))
            out.push(...(await convertBlockNode(child, listLevel, ctx)));
        return out;
    }

    if (ctx.firstH2AfterH1Pending && (el.textContent || "").trim()) {
        ctx.sawContentSinceLastH1 = true;
    }
    return [paragraphFromInlineNodes(el.childNodes)];
}

export async function createDocxBlobFromHtml(
    html: string,
    options: DocxExportOptions = {}
): Promise<Blob> {
    const title = options.title || "Document";
    const body = htmlToBody(html);
    const children: BlockChild[] = [];
    const ctx: ConvertContext = {
        blockIndex: 0,
        chapterByH1: true,
        firstH2AfterH1Pending: false,
        sawContentSinceLastH1: false,
    };

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
                        spacing: {
                            line: GOST_LAYOUT.paragraph.lineTwip,
                            before: 0,
                            after: 0,
                        },
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
                        spacing: {
                            line: GOST_LAYOUT.paragraph.lineTwip,
                            before: 0,
                            after: 0,
                        },
                        indent: { firstLine: GOST_LAYOUT.paragraph.firstLineTwip },
                        alignment: AlignmentType.JUSTIFIED,
                    },
                    run: {
                        font: FONTS.serif,
                        color: COLORS.text,
                        size: SIZES.body,
                    },
                },
                {
                    id: "ListParagraph",
                    name: "List Paragraph",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { before: 0, after: 0 },
                        contextualSpacing: true,
                        indent: { firstLine: 0 },
                    },
                    run: {
                        font: FONTS.serif,
                        color: COLORS.text,
                        size: SIZES.body,
                    },
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
                    run: {
                        font: FONTS.serif,
                        color: COLORS.text,
                        italics: true,
                        size: SIZES.body,
                    },
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
                    run: {
                        font: FONTS.mono,
                        color: COLORS.link,
                        size: SIZES.code,
                    },
                },
                {
                    id: "Caption",
                    name: "Caption",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    paragraph: {
                        spacing: { before: 80, after: 160 },
                        indent: { firstLine: 0 },
                    },
                    run: {
                        font: FONTS.serif,
                        color: COLORS.link,
                        size: 20,
                        italics: true,
                    },
                },
                {
                    id: "Heading1",
                    name: "Heading 1",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h1,
                    },
                    paragraph: {
                        spacing: { before: 320, after: 160 },
                        alignment: AlignmentType.CENTER,
                    },
                },
                {
                    id: "Heading2",
                    name: "Heading 2",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h2,
                    },
                    paragraph: {
                        spacing: { before: 280, after: 140 },
                        alignment: AlignmentType.CENTER,
                    },
                },
                {
                    id: "Heading3",
                    name: "Heading 3",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h3,
                    },
                    paragraph: {
                        spacing: { before: 240, after: 120 },
                        alignment: AlignmentType.LEFT,
                    },
                },
                {
                    id: "Heading4",
                    name: "Heading 4",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h4,
                    },
                    paragraph: {
                        spacing: { before: 220, after: 120 },
                        alignment: AlignmentType.LEFT,
                    },
                },
                {
                    id: "Heading5",
                    name: "Heading 5",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h5,
                    },
                    paragraph: {
                        spacing: { before: 200, after: 100 },
                        alignment: AlignmentType.LEFT,
                    },
                },
                {
                    id: "Heading6",
                    name: "Heading 6",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: FONTS.serif,
                        bold: true,
                        color: COLORS.text,
                        size: SIZES.h6,
                    },
                    paragraph: {
                        spacing: { before: 180, after: 100 },
                        alignment: AlignmentType.LEFT,
                    },
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

export async function createDocxBlobFromMarkdown(
    markdown: string,
    options: DocxExportOptions = {}
): Promise<Blob> {
    const html = await markdownToHtml(markdown ?? "");
    return await createDocxBlobFromHtml(html, options);
}

export async function downloadMarkdownAsDocx(
    markdown: string,
    options: DocxExportOptions = {}
): Promise<void> {
    const title = options.title || "Document";
    const filename = options.filename || `${safeFilename(title)}.docx`;
    const blob = await createDocxBlobFromMarkdown(markdown ?? "", options);
    downloadBlob(blob, filename);
}

export async function downloadHtmlAsDocx(
    html: string,
    options: DocxExportOptions = {}
): Promise<void> {
    const title = options.title || "Document";
    const filename = options.filename || `${safeFilename(title)}.docx`;
    const blob = await createDocxBlobFromHtml(html ?? "", options);
    downloadBlob(blob, filename);
}