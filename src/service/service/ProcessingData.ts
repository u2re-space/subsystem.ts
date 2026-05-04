export type {
	AIConfig,
	RecognitionMode,
	RecognitionResult,
	BatchRecognitionResult,
	ExtractionRule,
	ExtractionResult,
	RecognizeResult,
	ExtendedRecognizeOptions,
	RecognizeByInstructionsOptions,
	OutputFormat,
	OutputLanguage,
	ProcessDataWithInstructionOptions,
	ProcessDataWithInstructionResult,
	ClipboardResult,
	ImageProcessingOptions,
	PlatformAdapter,
	RecognitionCacheEntry,
} from "../shared/types";

export { getGPTInstance, pickFirstError, extractText, toCrxResult } from "../shared/gpt-utils";

export {
	CORE_IMAGE_INSTRUCTION,
	CORE_DATA_CONVERSION_INSTRUCTION,
	CORE_ENTITY_EXTRACTION_INSTRUCTION,
	DATA_MODIFICATION_INSTRUCTION,
} from "../instructions/core";

export { detectPlatform, getPlatformAdapter } from "../processing/adapters";

export { loadAISettings, getActiveCustomInstruction, getLanguageInstruction, getSvgGraphicsAddon } from "../processing/settings";

export {
	recognizeImageData,
	convertTextualData,
	analyzeRecognizeUnified,
	recognizeWithContext,
	batchRecognize,
} from "../recognition/core";

export { smartRecognize, recognizeAndNormalize, recognizeFromClipboard } from "../recognition/smart";

export { solveAndAnswer, writeCode, extractCSS, solveEquation, answerQuestion } from "../processing/core";

export { extractEntities, modifyEntityData, extractByRules } from "../processing/entities";

export {
	processDataWithInstruction,
	recognizeByInstructions,
	processDataByInstruction,
	UnifiedAIService,
} from "../processing/unified";

export { UnifiedAIService as default } from "../processing/unified";
