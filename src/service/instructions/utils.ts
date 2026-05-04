import type { ResponseLanguage } from "com/config/SettingsTypes";
import type { CustomInstruction } from "com/config/SettingsTypes";
import type { OutputFormat } from "../shared/types";

export type { CustomInstruction };

export const buildInstructionPrompt = (baseInstruction: string, customInstruction: string): string => {
	if (!customInstruction?.trim()) return baseInstruction;

	return `${baseInstruction}

---

USER CUSTOM INSTRUCTIONS:
${customInstruction.trim()}

---

Apply the user's custom instructions above when processing the data. Prioritize user instructions when they conflict with default behavior.
`;
};

export const SVG_GRAPHICS_ADDON = `
---

GRAPHICS GENERATION (when applicable):
When the problem involves functions, graphs, geometric shapes, diagrams, or data that can be visualized:

Generate inline SVG as Markdown image with data URI:
![<title>](data:image/svg+xml,<encodeURIComponent_encoded_svg>)

SVG Requirements:
- Use encodeURIComponent() encoding for the entire SVG string
- viewBox="0 0 400 300" (or appropriate dimensions)
- Colors: #3b82f6 (blue), #10b981 (green), #f59e0b (orange), #ef4444 (red)
- Include axis labels, tick marks, and legends
- Use <text> elements for annotations
- Keep SVG minimal but informative

Apply to:
• Function graphs: f(x), parametric, polar
• Geometric constructions and proofs
• Data visualizations and charts
• Diagrams and flowcharts
• Coordinate systems and number lines

Always include both the mathematical solution AND the visualization.
`;

export const buildInstructionWithGraphics = (
	baseInstruction: string,
	customInstruction: string,
	includeSvgGraphics: boolean,
): string => {
	let result = buildInstructionPrompt(baseInstruction, customInstruction);

	if (includeSvgGraphics) {
		result += SVG_GRAPHICS_ADDON;
	}

	return result;
};

export const generateInstructionId = (): string => {
	return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const LANGUAGE_INSTRUCTIONS: Record<ResponseLanguage, string> = {
	auto: "",
	follow: "\n\nIMPORTANT: Follow the language of the source/context data. Preserve the original language unless explicitly asked to translate or change language.",
	en: "\n\nIMPORTANT: Respond in English. All explanations, answers, and comments must be in English.",
	ru: "\n\nВАЖНО: Отвечай на русском языке. Все объяснения, ответы и комментарии должны быть на русском языке.",
};

export const TRANSLATE_INSTRUCTION =
	"\n\nAdditionally, translate the recognized content to the response language if it differs from the source.";

export function getOutputFormatInstruction(format: OutputFormat): string {
	if (format === "auto" || format === undefined) return "";

	const instructions: Record<OutputFormat, string> = {
		auto: "",
		markdown: `\n\nOutput the result in GitHub-compatible Markdown.

Markdown structure:
- Use headings for structure:
  - Main sections: start from ### (H3) minimum
  - Subsections: #### / ##### when needed
- Avoid long paragraphs: prefer lists and sub-lists.

KaTeX / math:
- Prefer inline formulas: $...$
- Avoid $$...$$ blocks; only use block math if strictly necessary.
  - Prefer block math as \\[ ... \\] instead of $$...$$.
- Inside KaTeX, write a vertical bar as \\| (example: $A \\| B$).

Tables:
- Use strict GitHub Markdown table syntax.
- Inside table cells:
  - Use <br> for line breaks (no real newlines inside cells).
  - If source data uses ';' as a separator, replace ';' with <br>.

Colon formatting:
- For "key: value" style lines, make the part before ':' bold:
  - **Key**: value`,
		html: "\n\nOutput the result in HTML format.",
		json: "\n\nOutput the result as valid JSON.",
		text: "\n\nOutput the result as plain text.",
		typescript: "\n\nOutput the result as TypeScript code.",
		javascript: "\n\nOutput the result as JavaScript code.",
		python: "\n\nOutput the result as Python code.",
		java: "\n\nOutput the result as Java code.",
		cpp: "\n\nOutput the result as C++ code.",
		csharp: "\n\nOutput the result as C# code.",
		php: "\n\nOutput the result as PHP code.",
		ruby: "\n\nOutput the result as Ruby code.",
		go: "\n\nOutput the result as Go code.",
		rust: "\n\nOutput the result as Rust code.",
		xml: "\n\nOutput the result as XML.",
		yaml: "\n\nOutput the result as YAML.",
		css: "\n\nOutput the result as CSS.",
		scss: "\n\nOutput the result as SCSS.",
		"most-suitable": "\n\nChoose the most suitable output format for the content and task.",
		"most-optimized": "\n\nChoose the most optimized output format for clarity and usability.",
		"most-legibility": "\n\nChoose the most legible output format for human readability.",
	};

	return instructions[format] || "";
}

export function getIntermediateRecognitionInstruction(format: OutputFormat): string {
	const baseInstruction =
		"Extract all readable text, equations, and data from this image. Focus on accuracy and completeness.";

	if (format === "markdown") {
		return baseInstruction + " Format the extracted content as clean Markdown.";
	} else if (format === "html") {
		return baseInstruction + " Format the extracted content as semantic HTML.";
	} else if (format === "text") {
		return baseInstruction + " Extract as plain text only.";
	} else if (format === "most-suitable") {
		return "Analyze this image and extract all readable content in the most appropriate format for further processing.";
	} else if (format === "most-optimized") {
		return "Extract content from this image in the most efficient format for token usage and processing.";
	} else if (format === "most-legibility") {
		return "Extract content from this image with maximum legibility and human readability.";
	}

	return baseInstruction + " Format appropriately for the content type.";
}
