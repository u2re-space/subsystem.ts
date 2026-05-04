import {
    AlignmentType,
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
    Paragraph,
    TextRun,
} from "docx";

import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import { repairLatexMatrixRowBreaks } from "./markdown";
import { renderMatrixAsPng, renderMathAsPng } from "./rasterize";

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

function bracketClassFromFence(
    open: string,
    close: string
): typeof MathRoundBrackets | typeof MathSquareBrackets | typeof MathCurlyBrackets | typeof MathAngledBrackets {
    if (open === "(" && close === ")") return MathRoundBrackets;
    if (open === "[" && close === "]") return MathSquareBrackets;
    if (open === "{" && close === "}") return MathCurlyBrackets;
    if ((open === "⟨" && close === "⟩") || (open === "〈" && close === "〉")) return MathAngledBrackets;
    return MathRoundBrackets;
}

function isFenceOperatorElement(el: Element): boolean {
    if (el.tagName.toLowerCase() !== "mo") return false;
    const fenceAttr = (el.getAttribute("fence") || "").toLowerCase();
    const text = normalizeMathOperator(el.textContent || "");
    return fenceAttr === "true" || ["(", ")", "[", "]", "{", "}", "⟨", "⟩", "〈", "〉"].includes(text);
}

function matrixComponentsFromMtable(mtable: Element): MathComponent[] {
    const rows = Array.from(mtable.children).filter((el) => el.tagName.toLowerCase() === "mtr");
    const out: MathComponent[] = [];
    rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.children).filter((el) => el.tagName.toLowerCase() === "mtd");
        const rowComponents: MathComponent[] = [];
        cells.forEach((cell, cellIndex) => {
            const cellMath = mathComponentsFromMathNode(cell);
            if (cellMath.length) rowComponents.push(...cellMath);
            else {
                const t = normalizeMathText(cell.textContent || "");
                if (t) rowComponents.push(new MathRun(t));
            }
            if (cellIndex < cells.length - 1) rowComponents.push(new MathRun(", "));
        });
        if (rowComponents.length) out.push(new MathRoundBrackets({ children: rowComponents }));
        if (rowIndex < rows.length - 1) out.push(new MathRun("; "));
    });
    return out;
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
    const out: MathComponent[] = [];
    for (const child of Array.from(node.children)) {
        out.push(...mathComponentsFromMathNode(child));
    }
    return out;
}

function mathComponentsFromMathNode(node: Element): MathComponent[] {
    const tag = node.tagName.toLowerCase();

    if (tag === "annotation") return [];

    if (tag === "math" || tag === "mstyle" || tag === "semantics" || tag === "annotation-xml" || tag === "mphantom") {
        // Some producers append raw LaTeX text nodes inside <math>/<semantics>.
        // We intentionally prefer element children to avoid duplicate exports.
        const kids = mathComponentsFromElementChildren(node);
        if (kids.length) return kids;
        const t = normalizeMathText(Array.from(node.children).map((el) => el.textContent || "").join(" "));
        return t ? [new MathRun(t)] : [];
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
            const inner: MathComponent[] = [];
            for (const child of elementChildren.slice(1, -1)) inner.push(...mathComponentsFromMathNode(child));
            const Bracket = bracketClassFromFence(open, close);
            return [new Bracket({ children: inner })];
        }
        const kids = mathComponentsFromChildNodes(node);
        if (kids.length) return kids;
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    if (tag === "mi" || tag === "mn" || tag === "mtext" || tag === "ms") {
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    if (tag === "mo") {
        const t = normalizeMathOperator(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    if (tag === "mspace") {
        return [new MathRun(" ")];
    }

    if (tag === "mfrac") {
        const [num, den] = Array.from(node.children);
        return [
            new MathFraction({
                numerator: num ? mathComponentsFromMathNode(num) : [new MathRun(" ")],
                denominator: den ? mathComponentsFromMathNode(den) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "msqrt") {
        const children = mathComponentsFromChildNodes(node);
        return [new MathRadical({ children: children.length ? children : [new MathRun(" ")] })];
    }

    if (tag === "mroot") {
        const [base, degree] = Array.from(node.children);
        const children = base ? mathComponentsFromMathNode(base) : [new MathRun(" ")];
        const deg = degree ? mathComponentsFromMathNode(degree) : [new MathRun(" ")];
        return [new MathRadical({ children, degree: deg })];
    }

    if (tag === "msup") {
        const [base, sup] = Array.from(node.children);
        return [
            new MathSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                superScript: sup ? mathComponentsFromMathNode(sup) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "msub") {
        const [base, sub] = Array.from(node.children);
        return [
            new MathSubScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                subScript: sub ? mathComponentsFromMathNode(sub) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "msubsup") {
        const [base, sub, sup] = Array.from(node.children);
        return [
            new MathSubSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                subScript: sub ? mathComponentsFromMathNode(sub) : [new MathRun(" ")],
                superScript: sup ? mathComponentsFromMathNode(sup) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "munder") {
        const [base, under] = Array.from(node.children);
        return [
            new MathSubScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                subScript: under ? mathComponentsFromMathNode(under) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "mover") {
        const [base, over] = Array.from(node.children);
        return [
            new MathSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                superScript: over ? mathComponentsFromMathNode(over) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "munderover") {
        const [base, under, over] = Array.from(node.children);
        return [
            new MathSubSuperScript({
                children: base ? mathComponentsFromMathNode(base) : [new MathRun(" ")],
                subScript: under ? mathComponentsFromMathNode(under) : [new MathRun(" ")],
                superScript: over ? mathComponentsFromMathNode(over) : [new MathRun(" ")],
            }),
        ];
    }

    if (tag === "mtable") {
        return matrixComponentsFromMtable(node);
    }

    if (tag === "mtr" || tag === "mtd") {
        const kids = mathComponentsFromChildNodes(node);
        if (kids.length) return kids;
        const t = normalizeMathText(node.textContent || "");
        return t ? [new MathRun(t)] : [];
    }

    if (tag === "mfenced") {
        const open = (node.getAttribute("open") || "(").trim();
        const close = (node.getAttribute("close") || ")").trim();
        const children = mathComponentsFromChildNodes(node);
        const Bracket = bracketClassFromFence(open, close);
        return [new Bracket({ children: children.length ? children : [new MathRun(" ")] })];
    }

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

    const kids = mathComponentsFromChildNodes(node);
    if (kids.length) return kids;
    const t = normalizeMathText(node.textContent || "");
    return t ? [new MathRun(t)] : [];
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
    return /\\begin\{(?:p|b|B|v|V)?matrix\}|\\begin\{smallmatrix\}/.test(text || "");
}



export async function buildDisplayMatrixBlocks(mathEl: Element): Promise<Paragraph[] | null> {
    const rawMathText = (mathEl.textContent || "").trim();
    if (!hasMatrixElement(mathEl) && hasLatexMatrixMarkup(rawMathText)) {
        const host = document.createElement("div");
        const source = /(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])/.test(rawMathText)
            ? repairLatexMatrixRowBreaks(rawMathText)
            : `$$${repairLatexMatrixRowBreaks(rawMathText)}$$`;
        host.textContent = source;
        renderMathInElement(host, {
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
        const reparsedMath = host.querySelector("math");
        if (reparsedMath && hasMatrixElement(reparsedMath)) {
            return await buildDisplayMatrixBlocks(reparsedMath);
        }
    }

    if (hasMatrixElement(mathEl)) {
        const png = (await renderMatrixAsPng(mathEl)) ?? (await renderMathAsPng(mathEl, { display: true }));
        if (png) {
            return [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    keepLines: true,
                    spacing: { before: 120, after: 120 },
                    indent: { firstLine: 0 },
                    children: [
                        new ImageRun({
                            data: png.data,
                            type: "png",
                            transformation: { width: png.width, height: png.height },
                        }),
                    ],
                }),
            ];
        }

        // Matrix export must stay image-based to avoid broken one-line Word rendering.
        return [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                keepLines: true,
                spacing: { before: 120, after: 120 },
                indent: { firstLine: 0 },
                children: [new TextRun({ text: normalizeMathText(mathEl.textContent || "") || "[matrix]" })],
            }),
        ];
    }

    const math = mathFromElement(mathEl);
    if (!math) return null;
    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            keepLines: true,
            spacing: { before: 120, after: 120 },
            indent: { firstLine: 0 },
            children: [math],
        }),
    ];
}

export async function convertDisplayMathMatrixParagraph(pEl: HTMLElement): Promise<Paragraph[] | null> {
    const children = Array.from(pEl.childNodes).filter((n) => {
        if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue || "").trim().length > 0;
        return true;
    });
    if (children.length !== 1) {
        const embeddedMath = pEl.querySelector("math");
        if (embeddedMath && (hasMatrixElement(embeddedMath) || hasLatexMatrixMarkup(embeddedMath.textContent || ""))) {
            return await buildDisplayMatrixBlocks(embeddedMath);
        }

        const raw = (pEl.textContent || "").trim();
        if (!raw) return null;
        if (!hasLatexMatrixMarkup(raw)) return null;

        const host = document.createElement("div");
        const mathSource = /(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])/.test(raw)
            ? repairLatexMatrixRowBreaks(raw)
            : `$$${repairLatexMatrixRowBreaks(raw)}$$`;
        host.textContent = mathSource;
        renderMathInElement(host, {
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

        const mathEl = host.querySelector("math");
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
