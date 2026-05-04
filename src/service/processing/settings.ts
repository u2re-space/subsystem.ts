import { getRuntimeSettings } from "com/config/RuntimeSettings";
import { loadSettings } from "com/config/Settings";
import type { ResponseLanguage } from "com/config/SettingsTypes";
import { detectPlatform } from "./adapters";
import { SVG_GRAPHICS_ADDON, LANGUAGE_INSTRUCTIONS, TRANSLATE_INSTRUCTION } from "../instructions/utils";

export const loadAISettings = async () => {
	const platform = detectPlatform();

	try {
		if (platform === "crx") {
			return await loadSettings();
		} else {
			return await getRuntimeSettings();
		}
	} catch (e) {
		console.error(`[AI-Service] Failed to load settings for platform ${platform}:`, e);
		return null;
	}
};

export const getActiveCustomInstruction = async (): Promise<string> => {
	try {
		const { getActiveInstructionText } = await import("../instructions/CustomInstructions");
		return await getActiveInstructionText();
	} catch {
		return "";
	}
};

export const getLanguageInstruction = async (): Promise<string> => {
	try {
		const settings = await loadAISettings();
		const lang = (settings?.ai?.responseLanguage || "auto") as ResponseLanguage;
		const translate = settings?.ai?.translateResults || false;

		let instruction = LANGUAGE_INSTRUCTIONS[lang] || "";
		if (translate && lang !== "auto" && lang !== "follow") {
			instruction += TRANSLATE_INSTRUCTION;
		}
		return instruction;
	} catch {
		return "";
	}
};

export const getSvgGraphicsAddon = async (): Promise<string> => {
	try {
		const settings = await loadAISettings();
		return settings?.ai?.generateSvgGraphics ? SVG_GRAPHICS_ADDON : "";
	} catch {
		return "";
	}
};
