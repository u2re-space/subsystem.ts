import { loadSettings } from "com/config/Settings";
import { buildInstructionPrompt, getOutputFormatInstruction, getIntermediateRecognitionInstruction } from "com/service/instructions/utils";
import { DEFAULT_API_URL, DEFAULT_MODEL, getGPTInstance, isImageData, unwrapUnwantedCodeBlocks, getResponseFormat } from "com/service/shared/gpt-utils";
import { loadAISettings, getActiveCustomInstruction, getLanguageInstruction, getSvgGraphicsAddon } from "com/service/processing/settings";
import { RecognitionCache } from "com/service/recognition/cache";
import { detectPlatform, getPlatformAdapter } from "com/service/processing/adapters";
import { solveAndAnswer, writeCode, extractCSS } from "com/service/processing/core";
import { extractEntities } from "com/service/processing/entities";
import { smartRecognize } from "com/service/recognition/smart";
import type {
	AIConfig,
	ProcessDataWithInstructionOptions,
	ProcessDataWithInstructionResult,
	RecognizeByInstructionsOptions,
} from "com/service/shared/types";

const recognitionCache = new RecognitionCache();

export const processDataWithInstruction = async (
	input: any,
	options: ProcessDataWithInstructionOptions = {},
	sendResponse?: (result: ProcessDataWithInstructionResult) => void,
): Promise<ProcessDataWithInstructionResult> => {
	const settings = (await loadSettings())?.ai;

	const {
		instruction = "",
		outputFormat = "auto",
		outputLanguage = "auto",
		enableSVGImageGeneration = "auto",
		intermediateRecognition,
		processingEffort = "low",
		processingVerbosity = "low",
		customInstruction,
		useActiveInstruction = false,
		includeImageRecognition,
		dataType,
	} = options;

	const token = settings?.apiKey;
	if (!token) {
		const result: ProcessDataWithInstructionResult = { ok: false, error: "No API key available" };
		sendResponse?.(result);
		return result;
	}

	if (!input) {
		const result: ProcessDataWithInstructionResult = { ok: false, error: "No input provided" };
		sendResponse?.(result);
		return result;
	}

	let finalInstruction = instruction;

	if (customInstruction) {
		finalInstruction = buildInstructionPrompt(finalInstruction, customInstruction);
	} else if (useActiveInstruction) {
		const activeInstruction = await getActiveCustomInstruction();
		if (activeInstruction) {
			finalInstruction = buildInstructionPrompt(finalInstruction, activeInstruction);
		}
	}

	const languageInstruction = await getLanguageInstruction();
	if (languageInstruction) {
		finalInstruction += languageInstruction;
	}

	const shouldEnableSVG =
		enableSVGImageGeneration === true || (enableSVGImageGeneration === "auto" && outputFormat === "html");
	if (shouldEnableSVG) {
		const svgAddon = await getSvgGraphicsAddon();
		if (svgAddon) {
			finalInstruction += svgAddon;
		}
	}

	if (outputFormat !== "auto") {
		const formatInstruction = getOutputFormatInstruction(outputFormat);
		if (formatInstruction) {
			finalInstruction += formatInstruction;
		}
	}

	const gpt = await getGPTInstance({
		apiKey: token,
		baseUrl: settings?.baseUrl,
		model: settings?.model,
		mcp: settings?.mcp,
	});
	if (!gpt) {
		const result: ProcessDataWithInstructionResult = { ok: false, error: "AI initialization failed" };
		sendResponse?.(result);
		return result;
	}
	gpt.clearPending();

	let processingStages = 1;
	let recognizedImages = false;
	const intermediateRecognizedData: ProcessDataWithInstructionResult["intermediateRecognizedData"] = [];

	if (Array.isArray(input) && (input?.[0]?.type === "message" || input?.[0]?.["role"])) {
		await gpt.getPending()?.push(...input);
	} else {
		const inputData = Array.isArray(input) ? input : [input];

		for (const item of inputData) {
			let processedItem = item;

			if (
				(typeof item === "string" && dataType === "svg") ||
				(typeof item === "string" && item.trim().startsWith("<svg"))
			) {
				processedItem = item;
			} else if (isImageData(item)) {
				recognizedImages = true;

				const useIntermediateRecognition =
					intermediateRecognition?.enabled !== false &&
					(intermediateRecognition?.enabled || includeImageRecognition);

				if (useIntermediateRecognition) {
					processingStages = 2;

					const cachedResult = !intermediateRecognition?.forceRefresh
						? recognitionCache.get(item, intermediateRecognition?.outputFormat)
						: null;

					let recognizedContent: string;
					let recognitionResponseId: string;

					if (cachedResult) {
						recognizedContent = cachedResult.recognizedData;
						recognitionResponseId = cachedResult.responseId;
					} else {
						const recognitionInstruction =
							intermediateRecognition?.dataPriorityInstruction ||
							getIntermediateRecognitionInstruction(intermediateRecognition?.outputFormat || "markdown");

						const recognitionResult = await recognizeByInstructions(
							item,
							recognitionInstruction,
							undefined,
							{ apiKey: token, baseUrl: settings?.baseUrl, model: settings?.model, mcp: settings?.mcp },
							{ customInstruction: undefined, useActiveInstruction: false },
						);

						if (!recognitionResult.ok || !recognitionResult.data) {
							recognizedContent = "";
							recognitionResponseId = "";
						} else {
							recognizedContent = recognitionResult.data;
							recognitionResponseId = recognitionResult.responseId || "";

							if (intermediateRecognition?.cacheResults !== false) {
								const recognizedAs = intermediateRecognition?.outputFormat || "markdown";
								recognitionCache.set(item, recognizedContent, recognizedAs, recognitionResponseId);
							}
						}
					}

					intermediateRecognizedData.push({
						originalData: item,
						recognizedData: recognizedContent,
						recognizedAs: intermediateRecognition?.outputFormat || "markdown",
						responseId: recognitionResponseId,
					});

					if (recognizedContent) {
						processedItem = recognizedContent;
					}
				}
			}

			if (processedItem !== null && processedItem !== undefined) {
				await gpt?.attachToRequest?.(processedItem);
			}
		}
	}

	await gpt.askToDoAction(finalInstruction);

	let response: any;
	let error: string | undefined;
	try {
		response = await gpt?.sendRequest?.(processingEffort, processingVerbosity, null, {
			responseFormat: getResponseFormat(outputFormat),
			temperature: 0.3,
		});
	} catch (e) {
		error = String(e);
	}

	let parsedResponse = response;
	if (typeof response === "string") {
		try {
			parsedResponse = JSON.parse(response);
		} catch {
			parsedResponse = null;
		}
	}

	const responseContent = parsedResponse?.choices?.[0]?.message?.content;
	let cleanedResponse = responseContent ? unwrapUnwantedCodeBlocks(responseContent.trim()) : null;

	let finalData = cleanedResponse;
	if (cleanedResponse && instruction?.includes("Recognize data from image")) {
		try {
			const parsedJson = JSON.parse(cleanedResponse);
			if (parsedJson?.recognized_data) {
				if (Array.isArray(parsedJson.recognized_data)) {
					finalData = parsedJson.recognized_data.join("\n");
				} else if (typeof parsedJson.recognized_data === "string") {
					finalData = parsedJson.recognized_data;
				} else {
					finalData = JSON.stringify(parsedJson.recognized_data);
				}
			} else if (parsedJson?.ok === false) {
				finalData = null;
			} else {
				finalData = cleanedResponse;
			}
		} catch {
			finalData = cleanedResponse;
		}
	}

	const result: ProcessDataWithInstructionResult = {
		ok: !!finalData && !error,
		data: finalData || undefined,
		error: error || (!finalData ? "No data recognized" : undefined),
		responseId: parsedResponse?.id || gpt?.getResponseId?.(),
		processingStages,
		recognizedImages,
		intermediateRecognizedData: intermediateRecognizedData.length > 0 ? intermediateRecognizedData : undefined,
	};

	sendResponse?.(result);
	return result;
};

export const recognizeByInstructions = async (
	input: any,
	instructions: string,
	sendResponse?: (result: any) => void,
	config?: AIConfig,
	options?: RecognizeByInstructionsOptions,
): Promise<{ ok: boolean; data?: string; error?: string; responseId?: string }> => {
	const result = await processDataWithInstruction(input, {
		instruction: instructions,
		customInstruction: options?.customInstruction,
		useActiveInstruction: options?.useActiveInstruction,
		processingEffort: options?.recognitionEffort || "low",
		processingVerbosity: options?.recognitionVerbosity || "low",
		outputFormat: "auto",
		outputLanguage: "auto",
		enableSVGImageGeneration: "auto",
	});

	const legacyResult = {
		ok: result.ok,
		data: result.data,
		error: result.error,
		responseId: result.responseId,
	};

	sendResponse?.(legacyResult);
	return legacyResult;
};

export const processDataByInstruction = async (
	input: any,
	instructions: string,
	sendResponse?: (result: any) => void,
	config?: AIConfig,
	options?: ProcessDataWithInstructionOptions,
): Promise<{
	ok: boolean;
	data?: string;
	error?: string;
	responseId?: string;
	processingStages?: number;
	recognizedImages?: boolean;
}> => {
	const result = await processDataWithInstruction(input, {
		instruction: instructions,
		...options,
		outputFormat: options?.outputFormat || "auto",
		outputLanguage: options?.outputLanguage || "auto",
		enableSVGImageGeneration: options?.enableSVGImageGeneration || "auto",
	});

	const legacyResult = {
		ok: result.ok,
		data: result.data,
		error: result.error,
		responseId: result.responseId,
		processingStages: result.processingStages,
		recognizedImages: result.recognizedImages,
	};

	sendResponse?.(legacyResult);
	return legacyResult;
};

export const UnifiedAIService = {
	detectPlatform,
	getPlatformAdapter,
	loadAISettings,
	getLanguageInstruction,
	getSvgGraphicsAddon,
	getActiveCustomInstruction,
	processDataWithInstruction,
	clearRecognitionCache: () => recognitionCache.clear(),
	getRecognitionCacheStats: () => recognitionCache.getStats(),
	recognizeByInstructions,
	processDataByInstruction,
	solveAndAnswer,
	writeCode,
	extractCSS,
	extractEntities,
	smartRecognize,
};

export default UnifiedAIService;
