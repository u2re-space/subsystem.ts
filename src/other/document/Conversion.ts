/**
 * Clipboard/document conversion helpers for web content and math markup.
 *
 * This module converts between HTML, Markdown, MathML, and LaTeX, with optional
 * translation and AI-assisted fallback behavior for some richer sources.
 */
import { escapeML, bySelector, serialize, extractFromAnnotation, getContainerFromTextSelection } from './DocTools';
import { deAlphaChannel } from 'core/workers/ImageProcess';
import { writeText, writeHTML } from 'core/modules/Clipboard';
import { loadSettings } from 'com/config/Settings';
import type { ResponseLanguage } from 'com/config/SettingsTypes';

// Lazy-load CJS packages so vite:import-analysis never needs to run
// transformCjsImport → parseAst on them (fragile with some bundler CJS interop paths).
const getTurndownService = (() => {
    let svc: InstanceType<any> | null = null;
    return async () => {
        if (!svc) {
            const { default: TurndownService } = await import('turndown');
            svc = new TurndownService();
        }
        return svc as { turndown(html: string): string };
    };
})();

const getTemml = (() => {
    let mod: { renderToString(input: string, opts?: any): string } | null = null;
    return async () => {
        if (!mod) mod = ((await import('temml')) as any).default ?? (await import('temml'));
        return mod!;
    };
})();

const getMathMLToLaTeX = (() => {
    let MML: { convert(input: string): string } | null = null;
    return async () => {
        if (!MML) MML = ((await import('mathml-to-latex')) as any).MathMLToLaTeX;
        return MML!;
    };
})();

// Options for copy operations
export type CopyOptions = {
    translate?: boolean;
    targetLanguage?: ResponseLanguage;
};

// Translation helper using AI
const translateContent = async (content: string, targetLang: ResponseLanguage): Promise<string> => {
    if (!content?.trim() || targetLang === "auto" || targetLang === "follow") return content;

    const langNames: Record<ResponseLanguage, string> = {
        auto: "",
        follow: "",
        en: "English",
        ru: "Russian"
    };

    try {
        const response = await chrome.runtime.sendMessage({
            type: "gpt:translate",
            input: content,
            targetLanguage: langNames[targetLang] || "English"
        });
        return response?.data || content;
    } catch (e) {
        console.warn("Translation failed:", e);
        return content;
    }
};

// Check if translation is enabled in settings
const shouldTranslate = async (): Promise<{ translate: boolean; lang: ResponseLanguage }> => {
    try {
        const settings = await loadSettings();
        return {
            translate: settings?.ai?.translateResults || false,
            lang: settings?.ai?.responseLanguage || "auto"
        };
    } catch {
        return { translate: false, lang: "auto" };
    }
};

// Apply translation if enabled
const applyTranslation = async (content: string): Promise<string> => {
    const { translate, lang } = await shouldTranslate();
    if (translate && lang !== "auto" && lang !== "follow") {
        return translateContent(content, lang);
    }
    return content;
};

let markedParserPromise: Promise<(input: string) => Promise<string>> | null = null;

const getMarkedParser = async (): Promise<(input: string) => Promise<string>> => {
    if (markedParserPromise) return markedParserPromise;
    markedParserPromise = (async () => {
        const [{ marked }, { default: markedKatex }] = await Promise.all([
            import("marked"),
            import("marked-katex-extension"),
        ]);
        marked?.use?.(
            markedKatex?.({
                throwOnError: false,
                nonStandard: true,
            }) as any
        );
        return async (input: string) => {
            return await marked.parse(input);
        };
    })();
    return markedParserPromise;
};

/** Convert markdown-like text into HTML while preserving already-HTML input. */
export const convertToHtml = async (input: string): Promise<string> => {
    const original = escapeML(input);
    // if already html, don't convert
    if (input?.trim()?.startsWith?.("<") && input?.trim()?.endsWith?.(">")) {
        return input;
    }
    try {
        const parse = await getMarkedParser();
        input = escapeML(await parse(input) || "") || input;
    } catch (e) {
        input = "";
        console.warn(e);
    }
    input ||= original;
    return (input?.normalize?.()?.trim?.() || input?.trim?.() || input);
};

/** Convert HTML into Markdown using the lazy turndown bridge. */
export const convertToMarkdown = async (input: string): Promise<string> => {
    const original = escapeML(input);
    try {
        const td = await getTurndownService();
        input = td.turndown(input);
    } catch (e) {
        input = "";
        console.warn(e);
    }
    input ||= original;
    return (input?.normalize?.()?.trim?.() || input?.trim?.() || input);
};

/** Copy the selected/target HTML content as Markdown, optionally translating the final text. */
export const copyAsMarkdown = async (target: HTMLElement, options?: CopyOptions) => {
    const container = getContainerFromTextSelection(target);
    let markdown = await convertToMarkdown(container?.innerHTML || container?.outerHTML || "");
    let text = markdown?.trim?.()?.normalize?.()?.trim?.() || markdown?.trim?.() || markdown;

    // Apply translation if enabled
    if (options?.translate !== false) {
        text = await applyTranslation(text);
    }

    if (text) await writeText(text);
    return text;
}

/** Copy text content as HTML, using Markdown rendering when the source is plain text. */
export const copyAsHTML = async (target: HTMLElement, options?: CopyOptions) => {
    const container = getContainerFromTextSelection(target);
    let sourceText = container?.innerText || "";

    // Apply translation if enabled
    if (options?.translate !== false) {
        sourceText = await applyTranslation(sourceText);
    }

    const html = await convertToHtml(sourceText) || await convertToHtml(container?.innerHTML || container?.outerHTML || "");
    const text = html?.trim?.()?.normalize?.()?.trim?.() || html?.trim?.() || html;
    if (text) await writeHTML(text, sourceText || text);
    return text;
}

/** Ensure inline math is wrapped in `$...$` when the source omitted delimiters. */
const $wrap$ = (katex: string) => {
    if (katex?.startsWith?.("$") && katex?.endsWith?.("$")) {
        return katex;
    }
    return "$" + katex + "$";
}

/**
 * Copy MathML/math-rich DOM as LaTeX, falling back through several embedded
 * metadata sources and optional image recognition when necessary.
 */
export const copyAsTeX = async (target: HTMLElement, _options?: CopyOptions) => {
    const math = bySelector(target, "math");
    const mjax = bySelector(target, "[data-mathml]");
    const orig = bySelector(target, "[data-original]");
    const expr = bySelector(target, "[data-expr]");
    const img = bySelector(target, ".mwe-math-fallback-image-inline[alt], .mwe-math-fallback-image-display[alt]");
    const forRecognition: any = bySelector(target, "img:is([src],[srcset]), picture:has(img)");

    let LaTeX = img?.getAttribute("alt") || getSelection()?.toString?.() || "";

    try {
        if (!LaTeX) { const ml = expr?.getAttribute("data-expr") || ""; LaTeX = (ml ? escapeML(ml) : LaTeX) || LaTeX; }
        if (!LaTeX) { const ml = orig?.getAttribute("data-original") || ""; LaTeX = (ml ? escapeML(ml) : LaTeX) || LaTeX; }
        if (!LaTeX) { const ml = mjax?.getAttribute("data-mathml") || ""; LaTeX = (ml ? escapeML(ml) : LaTeX) || LaTeX; }
        if (!LaTeX) {
            const st = math?.innerHTML || math?.outerHTML || "";
            if (!st && math) {
                // @ts-ignore
                const str = serialize(math);
                LaTeX = escapeML(str || st || LaTeX);
            }
            if (st) { LaTeX = escapeML(st || LaTeX); };
            LaTeX = extractFromAnnotation(math) || LaTeX;
        };
    } catch (e) {
        console.warn(e);
    }

    //
    const original = LaTeX?.trim?.();
    try { const MathMLToLaTeX = await getMathMLToLaTeX(); LaTeX = MathMLToLaTeX.convert(LaTeX); } catch (e) { LaTeX = ""; console.warn(e); }
    LaTeX ||= original?.trim?.();

    // try AI recognition if is image with URL in src or srcset
    if (!LaTeX && forRecognition) {
        const baseOrigin = (globalThis as any)?.location?.origin;
        const img = new URL(forRecognition?.currentSrc || forRecognition?.src || forRecognition?.getAttribute?.("src"), baseOrigin)?.href;
        const dataUrl = img ? await deAlphaChannel(img) : null;
        if (dataUrl) {
            const res = await chrome.runtime.sendMessage({
                type: "gpt:recognize",
                input: [{
                    role: "user",
                    content: [{ type: "input_image", image_url: dataUrl, detail: "auto" }]
                }]
            });
            LaTeX = res?.data?.output?.at?.(-1)?.content?.[0]?.text || LaTeX;
        }
    }

    //
    const resultText = $wrap$(LaTeX?.trim?.()?.normalize?.()?.trim?.() || LaTeX?.trim?.());
    if (resultText) await writeText(resultText);
    return resultText?.trim?.();
}

//
function stripMathDelimiters(input) {
    const s = String(input).trim();

    // Alternative for different paired delimiters:
    // 1: $$ ... $$
    // 2: $  ... $
    // 3: \[ ... \]
    // 4: \( ... \)
    // 5: \begin{name} ... \end{name}
    const re = /^\s*(?:\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\\begin\{([^\}]+)\}([\s\S]*?)\\end\{\5\})\s*$/;
    const m = s.match(re); if (!m) return s;
    return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[6] ?? "").trim();
}

// copy mathml DOM as mathml (with optional translation for surrounding text)
// TODO! support AI recognition and conversion (from images)
export const copyAsMathML = async (target: HTMLElement, _options?: CopyOptions) => {
    const math = bySelector(target, "math");
    const mjax = bySelector(target, "[data-mathml]");
    const orig = bySelector(target, "[data-original]");
    const expr = bySelector(target, "[data-expr]");
    const img = bySelector(target, ".mwe-math-fallback-image-inline[alt], .mwe-math-fallback-image-display[alt]");

    //
    let mathML = (img?.getAttribute?.("alt") || "" || "")?.trim?.();

    //
    try {
        if (!mathML) {
            // @ts-ignore
            const st = (math?.innerHTML || math?.outerHTML || "")?.trim?.();
            if (!st && math) {
                // @ts-ignore
                const str = serialize(math);
                mathML = escapeML(str || st || mathML)?.trim?.();
            }
            if (st) { mathML = escapeML(st || mathML)?.trim?.(); };
        }
        if (!mathML) { const ml = mjax?.getAttribute("data-mathml") || ""; mathML = (ml ? escapeML(ml) : mathML) || mathML; }
        if (!mathML) { const ml = expr?.getAttribute("data-expr") || ""; mathML = (ml ? escapeML(ml) : mathML) || mathML; }
        if (!mathML) { const ml = orig?.getAttribute("data-original") || ""; mathML = (ml ? escapeML(ml) : mathML) || mathML; }
    } catch (e) {
        console.warn(e);
    }

    //
    const original = mathML?.trim?.(); // try use KaTeX, and after re-render as MathML
    if (!mathML) { mathML ||= (await copyAsTeX(target))?.trim?.() || original; }

    //
    if (!(mathML?.trim()?.startsWith?.("<") && mathML?.trim()?.endsWith?.(">"))) {
        try {
            const temml = await getTemml();
            mathML = escapeML(temml.renderToString(stripMathDelimiters(mathML), {
                throwOnError: true,
                strict: false,
                trust: true,
                xml: true
            }) || "")?.trim?.() || mathML;
        } catch (e) { mathML = ""; console.warn(e); }
    }

    //
    mathML ||= original?.trim?.();
    const text = mathML?.trim?.()?.normalize?.()?.trim?.() || mathML?.trim?.() || mathML;
    if (text) await writeText(text);
    return text;
}
