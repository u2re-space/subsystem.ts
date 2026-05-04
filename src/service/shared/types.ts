import type { MCPConfig } from "com/config/SettingsTypes";
import type { DataKind, DataContext } from "../model/GPT-Config";

export type { DataKind, DataContext };

export type AIConfig = { apiKey?: string; baseUrl?: string; model?: string; customModel?: string; mcp?: MCPConfig[] };

export type RecognitionMode = "auto" | "image" | "text" | "structured" | "mixed";

export type RecognitionResult = {
	ok: boolean;
	recognized_data: any[];
	keywords_and_tags: string[];
	verbose_data: string;
	suggested_type: string | null;
	confidence: number;
	source_kind: DataKind;
	processing_time_ms: number;
	errors: string[];
	warnings: string[];
};

export type BatchRecognitionResult = {
	ok: boolean;
	results: RecognitionResult[];
	total_processed: number;
	total_successful: number;
	total_failed: number;
	combined_keywords: string[];
	processing_time_ms: number;
};

export type ExtractionRule = {
	name: string;
	pattern?: string;
	type: "phone" | "email" | "url" | "date" | "time" | "number" | "code" | "custom";
	format?: string;
	required?: boolean;
};

export type ExtractionResult = {
	field: string;
	value: any;
	confidence: number;
	raw: string;
	normalized: string;
};

export type RecognizeResult = {
	ok: boolean;
	data?: string;
	error?: string;
	raw?: any;
	responseId?: string;
};

export type ExtendedRecognizeOptions = {
	effort?: "none" | "low" | "medium" | "high";
	verbosity?: "low" | "medium" | "high";
	context?: DataContext;
	extractEntities?: boolean;
	returnJson?: boolean;
	customInstruction?: string;
	useActiveInstruction?: boolean;
};

export type RecognizeByInstructionsOptions = {
	customInstruction?: string;
	useActiveInstruction?: boolean;
	recognitionEffort?: "none" | "low" | "medium" | "high";
	recognitionVerbosity?: "low" | "medium" | "high";
};

export type OutputFormat =
	| "auto"
	| "markdown"
	| "html"
	| "json"
	| "text"
	| "typescript"
	| "javascript"
	| "python"
	| "java"
	| "cpp"
	| "csharp"
	| "php"
	| "ruby"
	| "go"
	| "rust"
	| "xml"
	| "yaml"
	| "css"
	| "scss"
	| "most-suitable"
	| "most-optimized"
	| "most-legibility";

export type OutputLanguage = "auto" | "en" | "ru";

export type ProcessDataWithInstructionOptions = {
	instruction?: string;
	outputFormat?: OutputFormat;
	outputLanguage?: OutputLanguage;
	enableSVGImageGeneration?: boolean | "auto";
	intermediateRecognition?: {
		enabled?: boolean;
		dataPriorityInstruction?: string;
		outputFormat?: OutputFormat;
		cacheResults?: boolean;
		forceRefresh?: boolean;
	};
	processingEffort?: "none" | "low" | "medium" | "high";
	processingVerbosity?: "low" | "medium" | "high";
	customInstruction?: string;
	useActiveInstruction?: boolean;
	includeImageRecognition?: boolean;
	maxProcessingStages?: number;
	dataType?: "auto" | "text" | "markdown" | "image" | "svg" | "json" | "xml" | "code";
	recognitionEffort?: "none" | "low" | "medium" | "high";
	recognitionVerbosity?: "low" | "medium" | "high";
};

export type ProcessDataWithInstructionResult = {
	ok: boolean;
	data?: string;
	error?: string;
	responseId?: string;
	processingStages?: number;
	recognizedImages?: boolean;
	intermediateRecognizedData?: Array<{
		originalData: any;
		recognizedData: string;
		recognizedAs: OutputFormat;
		responseId: string;
	}>;
};

export interface ClipboardResult {
	ok: boolean;
	data?: string;
	error?: string;
	method?: string;
}

export interface ImageProcessingOptions {
	maxWidth?: number;
	maxHeight?: number;
	quality?: number;
	format?: "png" | "jpeg";
}

export interface PlatformAdapter {
	copyToClipboard(data: string): Promise<ClipboardResult>;
	readFromClipboard(): Promise<ClipboardResult>;
	processImage?(dataUrl: string, options?: ImageProcessingOptions): Promise<string>;
	captureScreenshot?(rect?: { x: number; y: number; width: number; height: number }): Promise<string>;
	showNotification?(message: string, options?: { type?: "info" | "success" | "warning" | "error"; duration?: number }): void;
}

export interface RecognitionCacheEntry {
	dataHash: string;
	recognizedData: string;
	recognizedAs: OutputFormat;
	timestamp: number;
	responseId: string;
	metadata?: Record<string, any>;
}
