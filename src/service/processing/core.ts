import { SOLVE_AND_ANSWER_INSTRUCTION, WRITE_CODE_INSTRUCTION, EXTRACT_CSS_INSTRUCTION } from "../instructions/core";
import { getGPTInstance } from "../shared/gpt-utils";
import { getActiveCustomInstruction, getLanguageInstruction, getSvgGraphicsAddon } from "./settings";
import type { DataKind } from "../model/GPT-Config";
import type { RecognitionResult, RecognizeByInstructionsOptions } from "../shared/types";

const emptyResult = (errors: string[], processingTime: number): RecognitionResult => ({
	ok: false,
	recognized_data: [],
	keywords_and_tags: [],
	verbose_data: "",
	suggested_type: null,
	confidence: 0,
	source_kind: "unknown" as unknown as DataKind,
	processing_time_ms: processingTime,
	errors,
	warnings: [],
});

const runInstructionTask = async (
	input: any,
	instructionConst: string,
	resultTags: string[],
	resultType: string,
	options?: RecognizeByInstructionsOptions,
): Promise<RecognitionResult> => {
	const gpt = await getGPTInstance();
	if (!gpt) return emptyResult(["AI service not available"], 0);

	const startTime = Date.now();

	try {
		const languageInstruction = await getLanguageInstruction();
		const svgAddon = await getSvgGraphicsAddon();
		const instruction = instructionConst + languageInstruction + svgAddon;

		let customInstruction = "";
		if (options?.customInstruction) {
			customInstruction = options.customInstruction;
		} else if (options?.useActiveInstruction) {
			customInstruction = await getActiveCustomInstruction();
		}

		if (customInstruction) {
			await gpt.askToDoAction(customInstruction);
		}

		await gpt.askToDoAction(instruction);
		await gpt.giveForRequest(input);

		const rawResponse = await gpt.sendRequest("high", "medium");
		const processingTime = Date.now() - startTime;

		if (rawResponse) {
			return {
				ok: true,
				recognized_data: [rawResponse],
				keywords_and_tags: resultTags,
				verbose_data: rawResponse,
				suggested_type: resultType,
				confidence: 0.9,
				source_kind: "text" as unknown as DataKind,
				processing_time_ms: processingTime,
				errors: [],
				warnings: [],
			};
		} else {
			return emptyResult([`Failed to get ${resultType} response`], processingTime);
		}
	} catch (e) {
		return emptyResult([String(e)], Date.now() - startTime);
	}
};

export const solveAndAnswer = async (
	input: any,
	options?: RecognizeByInstructionsOptions,
): Promise<RecognitionResult> => {
	return runInstructionTask(input, SOLVE_AND_ANSWER_INSTRUCTION, ["solution", "answer"], "solution", options);
};

export const writeCode = async (
	input: any,
	options?: RecognizeByInstructionsOptions,
): Promise<RecognitionResult> => {
	return runInstructionTask(input, WRITE_CODE_INSTRUCTION, ["code", "programming"], "code", options);
};

export const extractCSS = async (
	input: any,
	options?: RecognizeByInstructionsOptions,
): Promise<RecognitionResult> => {
	return runInstructionTask(input, EXTRACT_CSS_INSTRUCTION, ["css", "styles", "stylesheet"], "css", options);
};

export const solveEquation = solveAndAnswer;
export const answerQuestion = solveAndAnswer;
