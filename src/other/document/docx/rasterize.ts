import { FONTS } from "./constants";
import { fitImageToWidth } from "./image";


export const OPERATOR_REMAP: Record<string, string> = {
    "−": "-",
    "–": "-",
    "—": "-",
    "∗": "*",
    "⋅": "*",
};

export function normalizeMathText(s: string): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

export function isFenceOperatorElement(el: Element): boolean {
    if (el.tagName.toLowerCase() !== "mo") return false;
    const fenceAttr = (el.getAttribute("fence") || "").toLowerCase();
    const text = normalizeMathOperator(el.textContent || "");
    return fenceAttr === "true" || ["(", ")", "[", "]", "{", "}", "⟨", "⟩", "〈", "〉"].includes(text);
}

export function normalizeMathOperator(text: string): string {
    const normalized = normalizeMathText(text);
    return OPERATOR_REMAP[normalized] ?? normalized;
}

export type MatrixDisplayModel = {
    rows: string[][];
    prefix: string;
    suffix: string;
    openFence: string;
    closeFence: string;
};

export function dataUrlToUint8Array(dataUrl: string): Uint8Array | null {
    const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl || "");
    if (!match) return null;
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
    const viaBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (viaBlob) return new Uint8Array(await viaBlob.arrayBuffer());
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrlToUint8Array(dataUrl);
}

export function matrixFenceGlyph(rowIndex: number, rowCount: number, side: "left" | "right", openFence: string, closeFence: string): string {
    const open = openFence || "(";
    const close = closeFence || ")";
    if (rowCount <= 1) return side === "left" ? open : close;
    const top = rowIndex === 0;
    const bottom = rowIndex === rowCount - 1;

    if ((open === "[" && close === "]")) {
        if (top) return side === "left" ? "⎡" : "⎤";
        if (bottom) return side === "left" ? "⎣" : "⎦";
        return side === "left" ? "⎢" : "⎥";
    }
    if ((open === "{" && close === "}")) {
        if (top) return side === "left" ? "⎧" : "⎫";
        if (bottom) return side === "left" ? "⎩" : "⎭";
        return side === "left" ? "⎨" : "⎬";
    }
    if (open === "|" && close === "|") return "│";
    if (top) return side === "left" ? "⎛" : "⎞";
    if (bottom) return side === "left" ? "⎝" : "⎠";
    return side === "left" ? "⎜" : "⎟";
}

export function matrixTextFromNode(node: Element): string {
    const text = normalizeMathText(node.textContent || "");
    return text;
}

export function stripRawTextFromMathContainers(root: Element): void {
    const containers = [root, ...Array.from(root.querySelectorAll("math,semantics,mstyle,annotation-xml,mphantom"))];
    for (const container of containers) {
        for (const node of Array.from(container.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            if ((node.nodeValue || "").trim().length) node.remove();
        }
    }
}


export function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to load math image"));
        img.src = url;
    });
}

export async function renderMathAsPng(
    mathEl: Element,
    opts?: { display?: boolean }
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
    try {
        const mathClone = mathEl.cloneNode(true) as Element;
        stripRawTextFromMathContainers(mathClone);

        const probe = document.createElement("div");
        probe.style.position = "fixed";
        probe.style.left = "-99999px";
        probe.style.top = "0";
        probe.style.visibility = "hidden";
        probe.style.whiteSpace = "nowrap";
        probe.style.padding = opts?.display ? "6px 8px" : "2px 4px";
        probe.style.fontFamily = `${FONTS.math}, ${FONTS.serif}`;
        probe.style.fontSize = opts?.display ? "24px" : "20px";
        probe.style.color = "#1A1A1A";
        probe.append(mathClone);
        document.body.append(probe);

        const bounds = probe.getBoundingClientRect();
        probe.remove();
        const width = Math.max(1, Math.ceil(bounds.width));
        const height = Math.max(1, Math.ceil(bounds.height));

        const serializedMath = new XMLSerializer().serializeToString(mathClone);
        const xhtmlStyle =
            `display:inline-block;white-space:nowrap;` +
            `font-family:${FONTS.math}, ${FONTS.serif};` +
            `font-size:${opts?.display ? 24 : 20}px;color:#1A1A1A;`;

        const svgMarkup =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            `<foreignObject width="100%" height="100%">` +
            `<div xmlns="http://www.w3.org/1999/xhtml" style="${xhtmlStyle}">${serializedMath}</div>` +
            `</foreignObject>` +
            `</svg>`;

        const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
            const img = await loadImageFromObjectUrl(svgUrl);
            const maxWidth = opts?.display ? 1200 : 700;
            const fitted = fitImageToWidth(img.width || width, img.height || height, maxWidth);
            const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(fitted.width * scale));
            canvas.height = Math.max(1, Math.round(fitted.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, fitted.width, fitted.height);

            const data = await canvasToPngBytes(canvas);
            if (!data) return null;
            return { data, width: fitted.width, height: fitted.height };
        } finally {
            URL.revokeObjectURL(svgUrl);
        }
    } catch {
        return null;
    }
}


export async function renderMatrixAsPng(mathEl: Element): Promise<{ data: Uint8Array; width: number; height: number } | null> {
    try {
        const model = extractMatrixDisplayModel(mathEl);
        if (!model) return null;
        const rowCount = model.rows.length;
        const colCount = Math.max(...model.rows.map((r) => r.length), 1);

        const fontSize = 26;
        const rowHeight = 38;
        const colGap = 20;
        const sidePadding = 12;
        const edgeGap = 10;
        const outerPaddingX = 8;
        const outerPaddingY = 8;
        const prefixGap = model.prefix ? 14 : 0;
        const suffixGap = model.suffix ? 14 : 0;

        const measureCanvas = document.createElement("canvas");
        const measureCtx = measureCanvas.getContext("2d");
        if (!measureCtx) return null;
        measureCtx.font = `${fontSize}px ${FONTS.math}, ${FONTS.serif}`;

        const colWidths = Array.from({ length: colCount }, (_, col) => {
            let max = 0;
            for (const row of model.rows) {
                const txt = row[col] || "";
                max = Math.max(max, measureCtx.measureText(txt || " ").width);
            }
            return Math.max(18, Math.ceil(max));
        });

        const prefixW = model.prefix ? Math.ceil(measureCtx.measureText(model.prefix).width) : 0;
        const suffixW = model.suffix ? Math.ceil(measureCtx.measureText(model.suffix).width) : 0;
        const bracketW = Math.ceil(measureCtx.measureText("⎢").width) + 4;
        const matrixInnerWidth = colWidths.reduce((a, b) => a + b, 0) + colGap * (colCount - 1);
        const matrixBlockWidth = bracketW + edgeGap + sidePadding + matrixInnerWidth + sidePadding + edgeGap + bracketW;
        const matrixBlockHeight = rowCount * rowHeight;

        const width = Math.max(
            1,
            outerPaddingX * 2 + prefixW + prefixGap + matrixBlockWidth + suffixGap + suffixW
        );
        const height = Math.max(1, outerPaddingY * 2 + matrixBlockHeight);

        const fitted = fitImageToWidth(width, height, 1200);
        const scaleRatio = fitted.width / width;
        const drawWidth = Math.max(1, Math.round(width * scaleRatio));
        const drawHeight = Math.max(1, Math.round(height * scaleRatio));

        const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(drawWidth * scale));
        canvas.height = Math.max(1, Math.round(drawHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.scale(scale, scale);
        ctx.scale(scaleRatio, scaleRatio);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#1A1A1A";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${fontSize}px ${FONTS.math}, ${FONTS.serif}`;

        const centerY = outerPaddingY + matrixBlockHeight / 2;
        let x = outerPaddingX;
        if (model.prefix) {
            ctx.textAlign = "left";
            ctx.fillText(model.prefix, x, centerY);
            x += prefixW + prefixGap;
        }

        const leftBracketX = x + bracketW / 2;
        const firstCellStart = x + bracketW + edgeGap + sidePadding;
        const rightBracketX = x + matrixBlockWidth - bracketW / 2;

        for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
            const rowCenterY = outerPaddingY + rowHeight * rowIdx + rowHeight / 2;
            const leftGlyph = matrixFenceGlyph(rowIdx, rowCount, "left", model.openFence, model.closeFence);
            const rightGlyph = matrixFenceGlyph(rowIdx, rowCount, "right", model.openFence, model.closeFence);
            ctx.textAlign = "center";
            ctx.fillText(leftGlyph, leftBracketX, rowCenterY);
            ctx.fillText(rightGlyph, rightBracketX, rowCenterY);

            let cellX = firstCellStart;
            for (let colIdx = 0; colIdx < colCount; colIdx++) {
                const cw = colWidths[colIdx];
                const txt = model.rows[rowIdx]?.[colIdx] || " ";
                ctx.fillText(txt, cellX + cw / 2, rowCenterY);
                cellX += cw + colGap;
            }
        }

        if (model.suffix) {
            ctx.textAlign = "left";
            const suffixX = outerPaddingX + prefixW + prefixGap + matrixBlockWidth + suffixGap;
            ctx.fillText(model.suffix, suffixX, centerY);
        }

        const data = await canvasToPngBytes(canvas);
        if (!data) return null;
        return { data, width: drawWidth, height: drawHeight };
    } catch {
        return null;
    }
}


export function extractMatrixDisplayModel(mathEl: Element): MatrixDisplayModel | null {
    const mtable = mathEl.querySelector("mtable");
    if (!mtable) return null;
    const rows = Array.from(mtable.children)
        .filter((el) => el.tagName.toLowerCase() === "mtr")
        .map((row) =>
            Array.from(row.children)
                .filter((cell) => cell.tagName.toLowerCase() === "mtd")
                .map((cell) => matrixTextFromNode(cell))
        )
        .filter((row) => row.length > 0);
    if (!rows.length) return null;

    let openFence = "(";
    let closeFence = ")";
    const mtableParent = mtable.parentElement;
    if (mtableParent) {
        const parentTag = mtableParent.tagName.toLowerCase();
        if (parentTag === "mfenced") {
            openFence = normalizeMathOperator(mtableParent.getAttribute("open") || "(") || "(";
            closeFence = normalizeMathOperator(mtableParent.getAttribute("close") || ")") || ")";
        } else if (parentTag === "mrow") {
            const pChildren = Array.from(mtableParent.children);
            if (pChildren.length >= 3) {
                const first = pChildren[0];
                const last = pChildren[pChildren.length - 1];
                if (isFenceOperatorElement(first) && isFenceOperatorElement(last)) {
                    openFence = normalizeMathOperator(first.textContent || "") || "(";
                    closeFence = normalizeMathOperator(last.textContent || "") || ")";
                }
            }
        }
    }

    const rootRow = (() => {
        const children = Array.from(mathEl.children);
        if (children.length === 1 && children[0].tagName.toLowerCase() === "mrow") return children[0];
        return mathEl;
    })();
    const matrixExpr = (() => {
        if (!mtableParent) return mtable;
        const parentTag = mtableParent.tagName.toLowerCase();
        if (parentTag === "mrow" || parentTag === "mfenced") return mtableParent;
        return mtable;
    })();
    const rootChildren = Array.from(rootRow.children);
    const matrixIdx = rootChildren.findIndex((child) => child === matrixExpr || child.contains(mtable));
    const prefix = matrixIdx > 0 ? rootChildren.slice(0, matrixIdx).map((el) => matrixTextFromNode(el)).join(" ").trim() : "";
    const suffix = matrixIdx >= 0 ? rootChildren.slice(matrixIdx + 1).map((el) => matrixTextFromNode(el)).join(" ").trim() : "";

    return { rows, prefix, suffix, openFence, closeFence };
}
