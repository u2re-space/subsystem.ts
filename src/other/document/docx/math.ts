/**
 * FIND:docx-math
 * TAG:docx-export
 * KaTeX MathML → Office Math (`docx` 9.13, entry `docx/math`).
 * WHY: matrices, fences, accents and n-ary operators are real OMML.
 * TeX in `<annotation encoding="application/x-tex">` wins; MathML is the fallback.
 */
import {
    AlignmentType,
    Math as MathNode,
    type MathComponent,
    MathFraction,
    MathRadical,
    MathRun,
    MathSubScript,
    MathSubSuperScript,
    MathSuperScript,
    Paragraph,
    TextRun,
} from "docx";
import {
    latexToMath,
    MathAccent,
    type MathAccentName,
    MathBar,
    MathBrackets,
    MathCases,
    MathLargeOperator,
    type MathLargeOperatorName,
    MathMatrix,
    type MathMatrixBrackets,
    MathPhantom,
} from "docx/math";

import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import { repairLatexMatrixRowBreaks } from "./markdown";

function normalizeMathText(s: string): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

const OPERATOR_REMAP: Record<string, string> = {
    "−": "-",
    "–": "-",
    "—": "-",
    "∗": "*",
    "⋅": "*",
};

function normalizeMathOperator(text: string): string {
    const normalized = normalizeMathText(text);
    return OPERATOR_REMAP[normalized] ?? normalized;
}

const FENCE_CHARS = new Set(["(", ")", "[", "]", "{", "}", "⟨", "⟩", "〈", "〉", "|", "‖", "."]);

function isFenceOperatorElement(el: Element): boolean {
    if (el.tagName.toLowerCase() !== "mo") return false;
    const fenceAttr = (el.getAttribute("fence") || "").toLowerCase();
    const text = normalizeMathOperator(el.textContent || "");
    return fenceAttr === "true" || FENCE_CHARS.has(text);
}

function isNoClose(close: string): boolean {
    return close === "" || close === "." || close === " ";
}

const MATRIX_FENCES: Record<string, MathMatrixBrackets> = {
    "()": "round",
    "[]": "square",
    "{}": "curly",
    "⟨⟩": "angled",
    "〈〉": "angled",
    "||": "verticalBars",
    "‖‖": "doubleVerticalBars",
};

function knownMatrixBrackets(open: string, close: string): MathMatrixBrackets | null {
    return MATRIX_FENCES[`${open}${close}`] ?? null;
}

const ACCENT_CHARS: Record<string, MathAccentName> = {
    "\u0302": "hat",
    "^": "hat",
    "ˆ": "hat",
    "\u030C": "check",
    "ˇ": "check",
    "\u0303": "tilde",
    "~": "tilde",
    "˜": "tilde",
    "\u0301": "acute",
    "´": "acute",
    "\u0300": "grave",
    "`": "grave",
    "\u0307": "dot",
    "˙": "dot",
    "\u0308": "doubleDot",
    "¨": "doubleDot",
    "\u20DB": "tripleDot",
    "\u0306": "breve",
    "˘": "breve",
    "\u0305": "bar",
    "¯": "bar",
    "‾": "bar",
    "\u203E": "bar",
    "\u030A": "ring",
    "˚": "ring",
    "\u20D7": "rightArrow",
    "→": "rightArrow",
    "\u20D6": "leftArrow",
    "←": "leftArrow",
    "\u20E1": "leftRightArrow",
    "↔": "leftRightArrow",
    "\u20D1": "rightHarpoon",
    "\u20D0": "leftHarpoon",
};

const BAR_CHARS = new Set(["\u0305", "¯", "‾", "\u203E", "―", "_"]);

const LARGE_OPERATORS: Record<string, MathLargeOperatorName> = {
    "∑": "sum",
    "∏": "product",
    "∐": "coproduct",
    "⋃": "union",
    "⋂": "intersection",
    "⨆": "squareUnion",
    "⨄": "multisetUnion",
    "⋁": "logicalOr",
    "⋀": "logicalAnd",
    "⨁": "directSum",
    "⨂": "tensorProduct",
    "⨀": "circledDot",
    "∫": "integral",
    "∬": "doubleIntegral",
    "∭": "tripleIntegral",
    "⨌": "quadrupleIntegral",
    "∮": "contourIntegral",
    "∯": "surfaceIntegral",
    "∰": "volumeIntegral",
};

function largeOperatorName(text: string): MathLargeOperatorName | null {
    return LARGE_OPERATORS[normalizeMathOperator(text)] ?? null;
}

function spaceRun(): MathRun {
    return new MathRun(" ");
}

function componentsOrSpace(node: Element | undefined): MathComponent[] {
    if (!node) return [spaceRun()];
    const kids = mathComponentsFromMathNode(node);
    return kids.length ? kids : [spaceRun()];
}

function latexAnnotation(node: Element): string | null {
    const ann = Array.from(node.children).find((el) => el.tagName.toLowerCase() === "annotation")
        ?? node.querySelector("annotation");
    if (!ann) return null;
    const encoding = (ann.getAttribute("encoding") || "").toLowerCase();
    if (encoding && !encoding.includes("tex")) return null;
    const text = (ann.textContent || "").trim();
    return text || null;
}

function componentsFromLatex(latex: string): MathComponent[] | null {
    try {
        const components = latexToMath(latex);
        return components.length ? [...components] : null;
    } catch {
        return null;
    }
}

function runFromToken(node: Element, text: string, normalText = false): MathRun {
    if (normalText) return new MathRun({ text, normalText: true });
    const variant = (node.getAttribute("mathvariant") || "").toLowerCase();
    if (variant === "double-struck") return new MathRun({ text, script: "doubleStruck" });
    if (variant === "bold-fraktur" || variant === "fraktur") return new MathRun({ text, script: "fraktur" });
    if (variant === "script" || variant === "bold-script") return new MathRun({ text, script: "script" });
    if (variant === "monospace") return new MathRun({ text, script: "monospace" });
    if (variant === "sans-serif" || variant === "bold-sans-serif") return new MathRun({ text, script: "sansSerif" });
    if (variant === "bold") return new MathRun({ text, style: "bold" });
    if (variant === "italic" || variant === "bold-italic") {
        return new MathRun({ text, style: variant === "bold-italic" ? "boldItalic" : "italic" });
    }
    if (variant === "normal") return new MathRun({ text, style: "plain" });
    return new MathRun(text);
}

function columnAlignment(
    mtable: Element,
    columns: number
): "left" | "center" | "right" | Array<"left" | "center" | "right"> | undefined {
    const raw = (mtable.getAttribute("columnalign") || "").trim();
    if (!raw) return undefined;
    const parts = raw.split(/\s+/).filter((part): part is "left" | "center" | "right" =>
        part === "left" || part === "center" || part === "right"
    );
    if (parts.length === 1) return parts[0];
    if (parts.length === columns) return parts;
    return undefined;
}

function matrixFromMtable(mtable: Element, brackets: MathMatrixBrackets): MathMatrix {
    const rows = Array.from(mtable.children).filter((el) => el.tagName.toLowerCase() === "mtr");
    const grid = rows.map((row) => {
        const cells = Array.from(row.children).filter((el) => el.tagName.toLowerCase() === "mtd");
        const mapped = cells.map((cell) => componentsOrSpace(cell));
        return mapped.length ? mapped : [[spaceRun()]];
    });
    const body = grid.length ? grid : [[[spaceRun()]]];
    const columns = body.reduce((max, row) => Math.max(max, row.length), 0);
    const alignment = columnAlignment(mtable, columns);
    return new MathMatrix({
        rows: body,
        brackets,
        ...(alignment ? { columnAlignment: alignment } : {}),
    });
}

function casesFromMtable(mtable: Element): MathCases | null {
    const rows = Array.from(mtable.children).filter((el) => el.tagName.toLowerCase() === "mtr");
    if (!rows.length) return null;
    const cases = rows.map((row) => {
        const cells = Array.from(row.children).filter((el) => el.tagName.toLowerCase() === "mtd");
        if (cells.length < 2) return null;
        return {
            value: componentsOrSpace(cells[0]),
            condition: componentsOrSpace(cells[1]),
        };
    });
    if (cases.some((row) => !row)) return null;
    return new MathCases({ cases: cases as NonNullable<(typeof cases)[number]>[] });
}

function fencedMatrix(open: string, close: string, inner: Element[]): MathComponent[] | null {
    if (inner.length !== 1 || inner[0].tagName.toLowerCase() !== "mtable") return null;
    const table = inner[0];
    if (open === "{" && isNoClose(close)) {
        const cases = casesFromMtable(table);
        if (cases) return [cases];
    }
    const known = knownMatrixBrackets(open, isNoClose(close) ? "" : close);
    if (known) return [matrixFromMtable(table, known)];
    return [
        new MathBrackets({
            open: open.slice(0, 1),
            close: isNoClose(close) ? "" : close.slice(0, 1),
            children: [matrixFromMtable(table, "none")],
        }),
    ];
}

function accentFromMover(base: Element, accentEl: Element): MathComponent | null {
    if (accentEl.tagName.toLowerCase() !== "mo") return null;
    const glyph = normalizeMathOperator(accentEl.textContent || "");
    const accent = ACCENT_CHARS[glyph];
    if (!accent) return null;
    const stretchy = (accentEl.getAttribute("stretchy") || "").toLowerCase() === "true";
    const accentAttr = (accentEl.getAttribute("accent") || "").toLowerCase();
    if (BAR_CHARS.has(glyph) && (stretchy || accentAttr === "false")) {
        return new MathBar({ children: componentsOrSpace(base) });
    }
    return new MathAccent({ accent, children: componentsOrSpace(base) });
}

function naryFromLimits(
    node: Element,
    body: MathComponent[]
): MathComponent | null {
    const tag = node.tagName.toLowerCase();
    const kids = Array.from(node.children);
    const base = kids[0];
    if (!base || largeOperatorName(base.textContent || "") == null) return null;
    const operator = largeOperatorName(base.textContent || "") as MathLargeOperatorName;
    const under = tag === "munder" || tag === "munderover" ? kids[1] : undefined;
    const over = tag === "mover" ? kids[1] : tag === "munderover" ? kids[2] : undefined;
    const limits = operator.includes("ntegral") ? "side" : "aboveBelow";
    return new MathLargeOperator({
        operator,
        children: body.length ? body : [spaceRun()],
        ...(under ? { subScript: componentsOrSpace(under) } : {}),
        ...(over ? { superScript: componentsOrSpace(over) } : {}),
        limits,
    });
}

function mathComponentsFromChildNodes(node: Element): MathComponent[] {
    const out: MathComponent[] = [];
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = normalizeMathText(child.nodeValue || "");
            if (text) out.push(new MathRun(text));
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        out.push(...mathComponentsFromMathNode(child as Element));
    }
    return out;
}

function mathComponentsFromElementChildren(node: Element): MathComponent[] {
    return componentsFromElements(Array.from(node.children));
}

function componentsFromElements(elements: Element[]): MathComponent[] {
    const out: MathComponent[] = [];
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const tag = el.tagName.toLowerCase();
        if ((tag === "munder" || tag === "mover" || tag === "munderover") && i + 1 < elements.length) {
            const next = elements[i + 1];
            if (next.tagName.toLowerCase() !== "mo" && naryFromLimits(el, []) ) {
                const body = mathComponentsFromMathNode(next);
                const nary = naryFromLimits(el, body);
                if (nary) {
                    out.push(nary);
                    i += 1;
                    continue;
                }
            }
        }
        out.push(...mathComponentsFromMathNode(el));
    }
    return out;
}

function mathComponentsFromMathNode(node: Element): MathComponent[] {
    const tag = node.tagName.toLowerCase();

    if (tag === "annotation") return [];

    if (tag === "math" || tag === "semantics") {
        const latex = latexAnnotation(node);
        if (latex) {
            const fromLatex = componentsFromLatex(latex);
            if (fromLatex) return fromLatex;
        }
        const kids = mathComponentsFromElementChildren(node);
        if (kids.length) return kids;
        const text = normalizeMathText(Array.from(node.children).map((el) => el.textContent || "").join(" "));
        return text ? [new MathRun(text)] : [];
    }

    if (tag === "mstyle" || tag === "annotation-xml") {
        const kids = mathComponentsFromElementChildren(node);
        if (kids.length) return kids;
        const text = normalizeMathText(node.textContent || "");
        return text ? [new MathRun(text)] : [];
    }

    if (tag === "mphantom") {
        const hidden = mathComponentsFromElementChildren(node);
        return [new MathPhantom({ children: hidden.length ? hidden : [spaceRun()] })];
    }

    if (tag === "mrow") {
        const elementChildren = Array.from(node.children);
        if (
            elementChildren.length >= 3 &&
            isFenceOperatorElement(elementChildren[0]) &&
            isFenceOperatorElement(elementChildren[elementChildren.length - 1])
        ) {
            const open = normalizeMathOperator(elementChildren[0].textContent || "");
            const close = normalizeMathOperator(elementChildren[elementChildren.length - 1].textContent || "");
            const inner = elementChildren.slice(1, -1);
            const matrix = fencedMatrix(open, close, inner);
            if (matrix) return matrix;
            const children = componentsFromElements(inner);
            return [
                new MathBrackets({
                    open: open.slice(0, 1) || "(",
                    close: isNoClose(close) ? "" : close.slice(0, 1),
                    children: children.length ? children : [spaceRun()],
                }),
            ];
        }
        const kids = componentsFromElements(elementChildren);
        if (kids.length) return kids;
        const text = normalizeMathText(node.textContent || "");
        return text ? [new MathRun(text)] : [];
    }

    if (tag === "mi" || tag === "mn" || tag === "ms") {
        const text = normalizeMathText(node.textContent || "");
        return text ? [runFromToken(node, text)] : [];
    }

    if (tag === "mtext") {
        const text = normalizeMathText(node.textContent || "");
        return text ? [runFromToken(node, text, true)] : [];
    }

    if (tag === "mo") {
        const text = normalizeMathOperator(node.textContent || "");
        if (!text) return [];
        const operator = largeOperatorName(text);
        if (operator && (node.getAttribute("largeop") || "").toLowerCase() === "true") {
            return [new MathLargeOperator({ operator, children: [spaceRun()] })];
        }
        return [new MathRun(text)];
    }

    if (tag === "mspace") return [spaceRun()];

    if (tag === "mfrac") {
        const [num, den] = Array.from(node.children);
        const linethickness = (node.getAttribute("linethickness") || "").trim();
        const bevelled = (node.getAttribute("bevelled") || "").toLowerCase() === "true";
        const type = bevelled ? "skewed" : linethickness === "0" ? "noBar" : undefined;
        return [
            new MathFraction({
                numerator: componentsOrSpace(num),
                denominator: componentsOrSpace(den),
                ...(type ? { type } : {}),
            }),
        ];
    }

    if (tag === "msqrt") {
        const children = mathComponentsFromChildNodes(node);
        return [new MathRadical({ children: children.length ? children : [spaceRun()] })];
    }

    if (tag === "mroot") {
        const [base, degree] = Array.from(node.children);
        return [
            new MathRadical({
                children: componentsOrSpace(base),
                degree: componentsOrSpace(degree),
            }),
        ];
    }

    if (tag === "msup") {
        const [base, sup] = Array.from(node.children);
        return [
            new MathSuperScript({
                children: componentsOrSpace(base),
                superScript: componentsOrSpace(sup),
            }),
        ];
    }

    if (tag === "msub") {
        const [base, sub] = Array.from(node.children);
        return [
            new MathSubScript({
                children: componentsOrSpace(base),
                subScript: componentsOrSpace(sub),
            }),
        ];
    }

    if (tag === "msubsup") {
        const [base, sub, sup] = Array.from(node.children);
        return [
            new MathSubSuperScript({
                children: componentsOrSpace(base),
                subScript: componentsOrSpace(sub),
                superScript: componentsOrSpace(sup),
            }),
        ];
    }

    if (tag === "munder" || tag === "mover" || tag === "munderover") {
        const nary = naryFromLimits(node, []);
        if (nary) return [nary];
        const [base, second, third] = Array.from(node.children);
        if (tag === "mover" && base && second) {
            const accent = accentFromMover(base, second);
            if (accent) return [accent];
            if (second.tagName.toLowerCase() === "mo" && BAR_CHARS.has(normalizeMathOperator(second.textContent || ""))) {
                return [new MathBar({ children: componentsOrSpace(base) })];
            }
        }
        if (tag === "munder" && base && second && second.tagName.toLowerCase() === "mo") {
            if (BAR_CHARS.has(normalizeMathOperator(second.textContent || ""))) {
                return [new MathBar({ position: "below", children: componentsOrSpace(base) })];
            }
        }
        if (tag === "munder") {
            return [
                new MathSubScript({
                    children: componentsOrSpace(base),
                    subScript: componentsOrSpace(second),
                }),
            ];
        }
        if (tag === "mover") {
            return [
                new MathSuperScript({
                    children: componentsOrSpace(base),
                    superScript: componentsOrSpace(second),
                }),
            ];
        }
        return [
            new MathSubSuperScript({
                children: componentsOrSpace(base),
                subScript: componentsOrSpace(second),
                superScript: componentsOrSpace(third),
            }),
        ];
    }

    if (tag === "mtable") return [matrixFromMtable(node, "none")];

    if (tag === "mtr" || tag === "mtd") {
        const kids = mathComponentsFromChildNodes(node);
        if (kids.length) return kids;
        const text = normalizeMathText(node.textContent || "");
        return text ? [new MathRun(text)] : [];
    }

    if (tag === "mfenced") {
        const open = (node.getAttribute("open") ?? "(").trim();
        const close = (node.getAttribute("close") ?? ")").trim();
        const inner = Array.from(node.children);
        const matrix = fencedMatrix(open, close, inner);
        if (matrix) return matrix;
        const separators = (node.getAttribute("separators") || "").trim();
        const items = inner.map((child) => componentsOrSpace(child));
        if (separators && items.length > 1) {
            return [
                new MathBrackets({
                    open: open.slice(0, 1) || "(",
                    close: isNoClose(close) ? "" : close.slice(0, 1),
                    separator: separators.slice(0, 1),
                    items,
                }),
            ];
        }
        const children = items.flat();
        return [
            new MathBrackets({
                open: open.slice(0, 1) || "(",
                close: isNoClose(close) ? "" : close.slice(0, 1),
                children: children.length ? children : [spaceRun()],
            }),
        ];
    }

    const kids = mathComponentsFromChildNodes(node);
    if (kids.length) return kids;
    const text = normalizeMathText(node.textContent || "");
    return text ? [new MathRun(text)] : [];
}

export function mathFromElement(el: Element): MathNode | null {
    const components = mathComponentsFromMathNode(el);
    if (!components.length) return null;
    return new MathNode({ children: components });
}

function hasMatrixElement(mathEl: Element): boolean {
    if (mathEl.tagName.toLowerCase() === "mtable") return true;
    return !!mathEl.querySelector("mtable");
}

function hasLatexMatrixMarkup(text: string): boolean {
    return /\\begin\{(?:p|b|B|v|V|small)?matrix\}|\\begin\{cases\}|\\begin\{align\*?\}/.test(text || "");
}

const KATEX_RENDER = {
    throwOnError: false,
    nonStandard: true,
    output: "mathml" as const,
    strict: false,
    delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
    ],
};

function reparseLatexMath(raw: string): Element | null {
    const host = document.createElement("div");
    const source = /(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])/.test(raw)
        ? repairLatexMatrixRowBreaks(raw)
        : `$$${repairLatexMatrixRowBreaks(raw)}$$`;
    host.textContent = source;
    renderMathInElement(host, KATEX_RENDER);
    return host.querySelector("math");
}

function displayParagraph(children: Array<MathNode | TextRun>): Paragraph {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        keepLines: true,
        spacing: { before: 120, after: 120 },
        indent: { firstLine: 0 },
        children,
    });
}

export async function buildDisplayMatrixBlocks(mathEl: Element): Promise<Paragraph[] | null> {
    const rawMathText = (mathEl.textContent || "").trim();
    if (!hasMatrixElement(mathEl) && !latexAnnotation(mathEl) && hasLatexMatrixMarkup(rawMathText)) {
        const reparsed = reparseLatexMath(rawMathText);
        if (reparsed) return await buildDisplayMatrixBlocks(reparsed);
    }

    const math = mathFromElement(mathEl);
    if (math) return [displayParagraph([math])];
    if (!rawMathText) return null;
    return [displayParagraph([new TextRun({ text: normalizeMathText(rawMathText) })])];
}

export async function convertDisplayMathMatrixParagraph(pEl: HTMLElement): Promise<Paragraph[] | null> {
    const children = Array.from(pEl.childNodes).filter((n) => {
        if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue || "").trim().length > 0;
        return true;
    });
    if (children.length !== 1) {
        const embeddedMath = pEl.querySelector("math");
        if (embeddedMath && (hasMatrixElement(embeddedMath) || hasLatexMatrixMarkup(embeddedMath.textContent || "") || latexAnnotation(embeddedMath))) {
            return await buildDisplayMatrixBlocks(embeddedMath);
        }

        const raw = (pEl.textContent || "").trim();
        if (!raw || !hasLatexMatrixMarkup(raw)) return null;
        const mathEl = reparseLatexMath(raw);
        if (mathEl) return await buildDisplayMatrixBlocks(mathEl);
        return null;
    }
    const only = children[0];
    if (only.nodeType !== Node.ELEMENT_NODE) return null;
    const el = only as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "math") return await buildDisplayMatrixBlocks(el);
    if (tag === "div" && (el.classList.contains("math-display") || el.classList.contains("katex-display"))) {
        const mathEl = el.querySelector("math");
        if (mathEl) return await buildDisplayMatrixBlocks(mathEl);
    }
    return null;
}
