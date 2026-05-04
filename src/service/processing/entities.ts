import { detectDataKindFromContent } from "com/service/model/GPT-Config";
import { extractJSONFromAIResponse } from "core/document/AIResponseParser";
import { loadSettings } from "com/config/Settings";
import { getGPTInstance } from "../shared/gpt-utils";
import {
	CORE_ENTITY_EXTRACTION_INSTRUCTION,
	DATA_MODIFICATION_INSTRUCTION,
} from "../instructions/core";
import type { AIConfig, ExtractionRule, ExtractionResult } from "../shared/types";
import type { AIResponse } from "com/service/model/GPT-Responses";

export const extractEntities = async (
	data: File | Blob | string,
	config?: AIConfig,
): Promise<AIResponse<any[]>> => {
	try {
		const gpt = await getGPTInstance(config);
		if (!gpt) {
			return { ok: false, error: "No GPT instance" };
		}

		const dataKind =
			typeof data === "string"
				? detectDataKindFromContent(data)
				: (data instanceof File || data instanceof Blob) && data.type.startsWith("image/")
					? "input_image"
					: "input_text";

		if (Array.isArray(data) && (data?.[0]?.type === "message" || data?.[0]?.["role"])) {
			await gpt?.getPending?.()?.push?.(...data);
		} else {
			await gpt?.attachToRequest?.(data, dataKind);
		}

		await gpt.askToDoAction(CORE_ENTITY_EXTRACTION_INSTRUCTION);

		const raw = await gpt.sendRequest("high", "medium", null, {
			responseFormat: "json",
			temperature: 0.2,
		});

		if (!raw) {
			return { ok: false, error: "No response" };
		}

		const parseResult = extractJSONFromAIResponse<any>(raw);
		if (!parseResult.ok) {
			return { ok: false, error: parseResult.error || "Failed to parse AI response" };
		}

		return {
			ok: true,
			data: parseResult.data?.entities || [],
			responseId: gpt.getResponseId(),
		};
	} catch (e) {
		return { ok: false, error: String(e) };
	}
};

export const modifyEntityData = async (
	existingEntity: any,
	modificationPrompt: string,
	sendResponse?: (result: any) => void,
): Promise<{ ok: boolean; data?: string; error?: string }> => {
	const settings = (await loadSettings())?.ai;
	const token = settings?.apiKey;

	if (!token) {
		const result = { ok: false, error: "No API key" };
		sendResponse?.(result);
		return result;
	}

	const instructions = `
${DATA_MODIFICATION_INSTRUCTION}

Existing entity to modify:
\`\`\`json
${JSON.stringify(existingEntity, null, 2)}
\`\`\`

User modification request: ${modificationPrompt}
`;

	const input = [
		{
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: instructions }],
		},
	];

	const { recognizeByInstructions } = await import("com/service/processing/unified");
	return recognizeByInstructions(input, "", sendResponse);
};

export const extractByRules = async (data: string, rules: ExtractionRule[]): Promise<ExtractionResult[]> => {
	const results: ExtractionResult[] = [];

	try {
		const gpt = await getGPTInstance();
		if (!gpt) {
			return results;
		}

		const rulesDescription = rules
			.map(
				(r) =>
					`- ${r.name} (${r.type}): ${r.pattern ? `pattern: ${r.pattern}` : "auto-detect"}${r.format ? `, format as: ${r.format}` : ""}${r.required ? " [REQUIRED]" : ""}`,
			)
			.join("\n");

		await gpt.giveForRequest(`
Input data:
\`\`\`
${data}
\`\`\`

Extraction rules:
${rulesDescription}
		`);

		await gpt.askToDoAction(`
Extract data according to the rules.
For each rule, find matching content and normalize it.

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations.
Your response must start with { and end with }.

Expected output structure:
{
    "extractions": [
        {
            "field": "rule name",
            "value": "normalized value",
            "confidence": 0.0-1.0,
            "raw": "original text",
            "normalized": "formatted value"
        }
    ],
    "missing_required": ["list of required fields not found"]
}
		`);

		const raw = await gpt.sendRequest("medium", "low", null, {
			responseFormat: "json",
			temperature: 0.1,
		});

		if (!raw) return results;

		const parseResult = extractJSONFromAIResponse<any>(raw);
		if (!parseResult.ok || !parseResult.data) {
			return results;
		}

		return parseResult.data?.extractions || [];
	} catch {
		return results;
	}
};
