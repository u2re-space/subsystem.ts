import { getUsableData } from "com/service/model/GPT-Responses";
import { detectDataKindFromContent, type DataContext, type DataKind } from "com/service/model/GPT-Config";
import { extractJSONFromAIResponse } from "core/document/AIResponseParser";
import { getGPTInstance } from "com/service/shared/gpt-utils";
import { CORE_IMAGE_INSTRUCTION, CORE_DATA_CONVERSION_INSTRUCTION, CORE_ENTITY_EXTRACTION_INSTRUCTION } from "com/service/instructions/core";
import type {
	AIConfig,
	RecognitionMode,
	RecognitionResult,
	BatchRecognitionResult,
	RecognizeByInstructionsOptions,
} from "com/service/shared/types";

export const recognizeImageData = async (
	input: any,
	sendResponse?: (result: any) => void,
	config?: AIConfig,
	options?: RecognizeByInstructionsOptions,
): Promise<{ ok: boolean; data?: string; text?: string; arrayBuffer?: ArrayBuffer; error?: string }> => {
	const { recognizeByInstructions } = await import("com/service/processing/unified");
	return recognizeByInstructions(input, CORE_IMAGE_INSTRUCTION, sendResponse, config, options);
};

export const convertTextualData = async (
	input: any,
	sendResponse?: (result: any) => void,
	config?: AIConfig,
	options?: RecognizeByInstructionsOptions,
): Promise<{ ok: boolean; data?: string; error?: string }> => {
	const { recognizeByInstructions } = await import("com/service/processing/unified");
	return recognizeByInstructions(input, CORE_DATA_CONVERSION_INSTRUCTION, sendResponse, config, options);
};

export const analyzeRecognizeUnified = async (
	rawData: File | Blob | string,
	sendResponse?: (result: any) => void,
	config?: AIConfig,
	options?: RecognizeByInstructionsOptions,
): Promise<{ ok: boolean; data?: string; error?: string }> => {
	const content = await getUsableData({ dataSource: rawData });
	const input = [
		{
			type: "message",
			role: "user",
			content: [content],
		},
	];
	return (content?.[0]?.type === "input_image" || content?.type === "input_image")
		? recognizeImageData(input, sendResponse, config, options)
		: convertTextualData(input, sendResponse, config, options);
};

export const recognizeWithContext = async (
	data: File | Blob | string,
	context?: DataContext,
	mode: RecognitionMode = "auto",
	config?: AIConfig,
): Promise<RecognitionResult> => {
	const startTime = performance.now();

	const result: RecognitionResult = {
		ok: false,
		recognized_data: [],
		keywords_and_tags: [],
		verbose_data: "",
		suggested_type: null,
		confidence: 0,
		source_kind: "input_text",
		processing_time_ms: 0,
		errors: [],
		warnings: [],
	};

	try {
		const gpt = await getGPTInstance(config);
		if (!gpt) {
			result.errors.push("No GPT instance available");
			return result;
		}

		gpt.setContext(context || null);

		let dataKind: DataKind = "input_text";
		if (data instanceof File || data instanceof Blob) {
			if (data.type.startsWith("image/")) {
				dataKind = "input_image";
			} else if (data.type.includes("json")) {
				dataKind = "json";
			}
		} else if (typeof data === "string") {
			dataKind = detectDataKindFromContent(data);
		}
		result.source_kind = dataKind;

		if (mode === "image") dataKind = "input_image";
		else if (mode === "text") dataKind = "input_text";
		else if (mode === "structured") dataKind = "json";

		if (Array.isArray(data) && (data?.[0]?.type === "message" || data?.[0]?.["role"])) {
			await gpt?.getPending?.()?.push?.(...data);
		} else {
			await gpt?.attachToRequest?.(data, dataKind);
		}

		const instruction =
			dataKind === "input_image" ? CORE_IMAGE_INSTRUCTION : CORE_DATA_CONVERSION_INSTRUCTION;

		const contextAddition = context?.entityType ? `\n\nExpected entity type context: ${context?.entityType}` : "";
		const searchAddition = context?.searchTerms?.length
			? `\n\nFocus on finding: ${context?.searchTerms?.join?.(", ")}`
			: "";

		await gpt.askToDoAction(instruction + contextAddition + searchAddition);

		const raw = await gpt.sendRequest(context?.priority === "high" ? "high" : "medium", "medium", null, {
			responseFormat: "json",
			temperature: 0.3,
		});

		if (!raw) {
			result.errors.push("No response from AI");
			return result;
		}

		const parseResult = extractJSONFromAIResponse<any>(raw);
		if (!parseResult.ok) {
			result.errors.push(parseResult.error || "Failed to parse AI response");
			result.verbose_data = raw;
			return result;
		}

		const parsed = parseResult.data;
		result.ok = true;
		result.recognized_data = parsed?.recognized_data || [parsed?.verbose_data || raw];
		result.keywords_and_tags = parsed?.keywords_and_tags || parsed?.keywords || [];
		result.verbose_data = parsed?.verbose_data || "";
		result.suggested_type = parsed?.document_type || parsed?.source_format || null;
		result.confidence = parsed?.confidence || 0.7;
	} catch (e) {
		result.errors.push(String(e));
	}

	result.processing_time_ms = performance.now() - startTime;
	return result;
};

export const batchRecognize = async (
	items: (File | Blob | string)[],
	context?: DataContext,
	concurrency: number = 3,
	config?: AIConfig,
): Promise<BatchRecognitionResult> => {
	const startTime = performance.now();

	const result: BatchRecognitionResult = {
		ok: true,
		results: [],
		total_processed: items.length,
		total_successful: 0,
		total_failed: 0,
		combined_keywords: [],
		processing_time_ms: 0,
	};

	const keywordSet = new Set<string>();

	for (let i = 0; i < items.length; i += concurrency) {
		const batch = items.slice(i, i + concurrency);

		const promises = batch.map((item) => recognizeWithContext(item, context || {}, "auto", config));

		const batchResults = await Promise.all(promises);

		for (const r of batchResults) {
			result.results.push(r);

			if (r.ok) {
				result.total_successful++;
				r.keywords_and_tags.forEach((k) => keywordSet.add(k));
			} else {
				result.total_failed++;
			}
		}
	}

	result.ok = result.total_failed === 0;
	result.combined_keywords = Array.from(keywordSet);
	result.processing_time_ms = performance.now() - startTime;

	return result;
};
