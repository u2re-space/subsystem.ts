import { extractJSONFromAIResponse } from "core/document/AIResponseParser";
import { getGPTInstance } from "com/service/shared/gpt-utils";
import { recognizeWithContext } from "./core";
import type { AIConfig, RecognitionResult } from "com/service/shared/types";

const waitForClipboardFrame = (): Promise<void> =>
	new Promise((resolve) => {
		if (typeof globalThis.requestAnimationFrame === "function") {
			globalThis.requestAnimationFrame(() => resolve());
			return;
		}
		if (typeof MessageChannel !== "undefined") {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => resolve();
			channel.port2.postMessage(undefined);
			return;
		}
		if (typeof setTimeout === "function") {
			setTimeout(() => resolve(), 16);
			return;
		}
		if (typeof queueMicrotask === "function") {
			queueMicrotask(() => resolve());
			return;
		}
		resolve();
	});

export const smartRecognize = async (
	data: File | Blob | string,
	hints?: {
		expectedType?: string;
		language?: string;
		domain?: string;
		extractEntities?: boolean;
	},
	config?: AIConfig,
): Promise<RecognitionResult & { entities?: any[] }> => {
	const { extractEntities } = await import("com/service/processing/entities");

	const baseResult = await recognizeWithContext(
		data,
		{
			entityType: hints?.expectedType,
			searchTerms: hints?.domain ? [hints.domain] : undefined,
		},
		"auto",
		config,
	);

	if (!baseResult.ok) {
		return baseResult;
	}

	if (hints?.extractEntities) {
		const entityResult = await extractEntities(data, config);
		return {
			...baseResult,
			entities: entityResult.ok ? entityResult.data : undefined,
		};
	}

	return baseResult;
};

export const recognizeAndNormalize = async (
	data: File | Blob | string,
	normalizations: {
		phones?: boolean;
		emails?: boolean;
		urls?: boolean;
		dates?: boolean;
		addresses?: boolean;
	} = {},
): Promise<RecognitionResult & { normalized: Record<string, any[]> }> => {
	const baseResult = await recognizeWithContext(data, {});

	const normalized: Record<string, any[]> = {
		phones: [],
		emails: [],
		urls: [],
		dates: [],
		addresses: [],
	};

	if (!baseResult.ok) {
		return { ...baseResult, normalized };
	}

	try {
		const gpt = await getGPTInstance();
		if (!gpt) {
			return { ...baseResult, normalized };
		}

		const enabledNormalizations = Object.entries(normalizations)
			.filter(([_, v]) => v)
			.map(([k]) => k);

		if (enabledNormalizations.length === 0) {
			return { ...baseResult, normalized };
		}

		await gpt.giveForRequest(`
Recognized data:
\`\`\`
${baseResult.verbose_data || baseResult.recognized_data.join("\n")}
\`\`\`
		`);

		await gpt.askToDoAction(`
Extract and normalize the following types: ${enabledNormalizations.join(", ")}

Normalization rules:
- phones: E.164 format or local format with country code
- emails: lowercase, trimmed
- urls: full URL with protocol
- dates: ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
- addresses: structured with street, city, country if detectable

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown code blocks, no explanations.
Your response must start with { and end with }.

Expected output structure:
{
    "phones": ["..."],
    "emails": ["..."],
    "urls": ["..."],
    "dates": ["..."],
    "addresses": [{ "raw": "...", "structured": {...} }]
}
		`);

		const raw = await gpt.sendRequest("medium", "low", null, {
			responseFormat: "json",
			temperature: 0.1,
		});

		if (raw) {
			const parseResult = extractJSONFromAIResponse<any>(raw);
			if (parseResult.ok && parseResult.data) {
				Object.assign(normalized, parseResult.data);
			} else {
				baseResult.warnings.push("Normalization JSON parsing partially failed");
			}
		}
	} catch {
		baseResult.warnings.push("Normalization partially failed");
	}

	return { ...baseResult, normalized };
};

export const recognizeFromClipboard = async (): Promise<RecognitionResult | null> => {
	try {
		await waitForClipboardFrame();
		const clipboardItems = await navigator.clipboard.read().catch(() => null);

		if (clipboardItems) {
			for (const item of clipboardItems) {
				for (const type of item.types) {
					if (type.startsWith("image/")) {
						const blob = await item.getType(type);
						return recognizeWithContext(blob, {});
					}
				}
			}
		}

		await waitForClipboardFrame();
		const text = await navigator.clipboard.readText().catch(() => null);
		if (text) {
			return recognizeWithContext(text, {});
		}

		return null;
	} catch {
		return null;
	}
};
