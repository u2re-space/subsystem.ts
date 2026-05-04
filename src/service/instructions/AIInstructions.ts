export {
	IMAGE_INSTRUCTION_JSON,
	DATA_CONVERSION_INSTRUCTION_JSON,
	ENTITY_EXTRACTION_INSTRUCTION_JSON,
	DATA_MODIFICATION_INSTRUCTION,
	IMAGE_INSTRUCTION,
	DATA_CONVERSION_INSTRUCTION,
	ENTITY_EXTRACTION_INSTRUCTION,
	CORE_IMAGE_INSTRUCTION,
	CORE_DATA_CONVERSION_INSTRUCTION,
	CORE_ENTITY_EXTRACTION_INSTRUCTION,
	AI_INSTRUCTIONS,
	SOLVE_AND_ANSWER_INSTRUCTION,
	WRITE_CODE_INSTRUCTION,
	EXTRACT_CSS_INSTRUCTION,
	RECOGNIZE_CONTENT_INSTRUCTION,
	CONVERT_DATA_INSTRUCTION,
	EXTRACT_ENTITIES_INSTRUCTION,
	TRANSLATE_TO_LANGUAGE_INSTRUCTION,
	GENERAL_PROCESSING_INSTRUCTION,
	CRX_SOLVE_AND_ANSWER_INSTRUCTION,
	CRX_WRITE_CODE_INSTRUCTION,
	CRX_EXTRACT_CSS_INSTRUCTION,
	EQUATION_SOLVE_INSTRUCTION,
	ANSWER_QUESTION_INSTRUCTION,
} from "./core";

export {
	buildInstructionPrompt,
	buildInstructionWithGraphics,
	SVG_GRAPHICS_ADDON,
	generateInstructionId,
	getOutputFormatInstruction,
	getIntermediateRecognitionInstruction,
	LANGUAGE_INSTRUCTIONS,
	type CustomInstruction,
} from "./utils";

export {
	DEFAULT_TEMPLATES,
	BUILT_IN_AI_ACTIONS,
	DEFAULT_INSTRUCTION_TEMPLATES,
	type BuiltInAIAction,
} from "./templates";

export const IMAGE_INSTRUCTION_LEGACY_MD = `
Recognize data from image, also preferred to orient by fonts in image.

In recognition result, do not include image itself.

In recognized from image data (what you seen in image), do:
- If textual content, format as Markdown string (multiline).
- If math (expression, equation, formula), format as $KaTeX$
- If table (or looks alike table), format as | table |
- If image, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as JSON string.
- If phone number, format as as correct phone number (in normalized format).
  - If phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Trim spaces from phone numbers, emails, URLs, dates, times, codes, etc.
  - Remove brackets, parentheses, spaces or other symbols from phone numbers.
- If email, format as as correct email (in normalized format).
- If URL, format as as correct URL (in normalized format).
- If date, format as as correct date (in normalized format).
- If time, format as as correct time (in normalized format).
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

If nothing found, return "No data recognized".

By default, return data in Markdown string format.
`;

export const DATA_CONVERSION_INSTRUCTION_LEGACY_MD = `
Here may be HTML, Regular Text, LaTeX, etc input formats.

Needs to convert or reformat presented data to target format (Markdown string).

- If textual content, format as Markdown string (multiline).
- If math (expression, equation, formula), format as $KaTeX$
- If table (or looks alike table), format as | table |
- If image, format as [$image$]($image$)
- If code, format as \`\`\`$code$\`\`\` (multiline) or \`$code$\` (single-line)
- If JSON, format as JSON string.
- If phone number, format as as correct phone number (in normalized format).
  - If phone numbers (for example starts with +7, format as 8), replace to correct regional code.
  - Trim spaces from phone numbers, emails, URLs, dates, times, codes, etc.
  - Remove brackets, parentheses, spaces or other symbols from phone numbers.
- If email, format as as correct email (in normalized format).
- If URL, format as as correct URL (in normalized format).
- If date, format as as correct date (in normalized format).
- If time, format as as correct time (in normalized format).
- If other, format as $text$.
- If seen alike list, format as list (in markdown format).

Return handled data as Markdown string, without any additional comments.
`;

export const ENTITY_EXTRACTION_INSTRUCTION_LEGACY = `
Extract structured entities from the provided content.

For each entity found, extract:
- type: entity type (task, event, person, place, service, item, factor, bonus)
- id: suggested unique identifier
- name: machine-readable name
- title: human-readable title
- kind: specific subtype
- properties: relevant attributes
- description: markdown description

Return in JSON format:
\`\`\`json
{
    "entities": [...],
    "keywords": [...],
    "short_description": "markdown summary"
}
\`\`\`
`;
