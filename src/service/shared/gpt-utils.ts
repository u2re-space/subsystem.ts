import { loadSettings } from "com/config/Settings";
import type { MCPConfig } from "com/config/SettingsTypes";
import { GPTResponses, createGPTInstance } from "../model/GPT-Responses";
import type { AIConfig, OutputFormat } from "./types";

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_API_URL = "https://api.proxyapi.ru/openai/v1";

export { DEFAULT_MODEL, DEFAULT_API_URL };

type MCPConfigInput = Partial<MCPConfig> & {
	id?: unknown;
	serverLabel?: unknown;
	label?: unknown;
	origin?: unknown;
	clientKey?: unknown;
	secretKey?: unknown;
};

const normalizeMcpConfigList = (mcp: unknown): MCPConfig[] => {
	if (!Array.isArray(mcp)) return [];

	const parsed = [] as MCPConfig[];
	for (const item of mcp) {
		const raw = item as MCPConfigInput;
		if (!raw || typeof raw !== "object") continue;

		const origin = String(raw?.origin || "").trim();
		const clientKey = String(raw?.clientKey || "").trim();
		const secretKey = String(raw?.secretKey || "").trim();
		if (!origin || !clientKey || !secretKey) continue;

		const serverLabel = String((raw?.serverLabel || raw?.label || origin)).trim() || origin;
		parsed.push({
			id: String(raw?.id || origin),
			serverLabel,
			origin,
			clientKey,
			secretKey,
		});
	}

	return parsed;
};

const configureMcpTools = async (gpt: GPTResponses, mcpConfigs: unknown): Promise<void> => {
	const normalized = normalizeMcpConfigList(mcpConfigs);
	if (!normalized.length) return;

	for (const item of normalized) {
		await gpt.useMCP(item.serverLabel, item.origin, item.clientKey, item.secretKey);
	}
};

const resolveConfiguredModel = (model?: string, customModel?: string): string => {
	const selected = String(model || "").trim();
	const custom = String(customModel || "").trim();
	if (selected === "custom") return custom || DEFAULT_MODEL;
	return selected || custom || DEFAULT_MODEL;
};

export const getGPTInstance = async (config?: AIConfig): Promise<GPTResponses | null> => {
	const settings = await loadSettings();
	const apiKey = config?.apiKey || settings?.ai?.apiKey;

	if (!apiKey) {
		return null;
	}

	const baseUrl = config?.baseUrl || settings?.ai?.baseUrl || DEFAULT_API_URL;
	const model = resolveConfiguredModel(
		config?.model || settings?.ai?.model,
		config?.customModel || settings?.ai?.customModel
	);

	const gpt = createGPTInstance(apiKey, baseUrl, model);
	await configureMcpTools(gpt, config?.mcp ?? settings?.ai?.mcp);

	return gpt;
};

export function unwrapUnwantedCodeBlocks(content: string): string {
	if (!content) return content;

	const codeBlockRegex = /^```(?:katex|md|markdown|html|xml|json|text)?\n([\s\S]*?)\n```$/;

	const match = content.trim().match(codeBlockRegex);
	if (match) {
		const unwrapped = match[1].trim();
		const lines = unwrapped.split("\n");

		if (lines.length === 1 ||
			unwrapped.includes("<math") ||
			unwrapped.includes('<span class="katex') ||
			unwrapped.includes("<content") ||
			unwrapped.startsWith("<") && unwrapped.endsWith(">") ||
			/^\s*<[^>]+>/.test(unwrapped)) {
			return unwrapped;
		}

		if (lines.length > 3 ||
			lines.some(line => line.match(/^\s{4,}/) || line.includes("function") || line.includes("const ") || line.includes("let "))) {
			return content;
		}

		return unwrapped;
	}

	return content;
}

export function isImageData(data: any): boolean {
	return (data instanceof File && data.type.startsWith("image/")) ||
		(data instanceof Blob && data.type?.startsWith("image/")) ||
		(typeof data === "string" && (data.startsWith("data:image/") || data.startsWith("http") || data.startsWith("https://")));
}

export function getResponseFormat(format: OutputFormat): "json" | "text" {
	const jsonFormats: OutputFormat[] = ["json", "xml", "yaml"];
	return jsonFormats.includes(format) ? "json" : "text";
}

export const pickFirstError = (raw: any): string | undefined => {
	if (!raw) return undefined;
	if (typeof raw.error === "string" && raw.error.trim()) return raw.error;
	if (Array.isArray(raw.errors) && typeof raw.errors[0] === "string" && raw.errors[0].trim()) return raw.errors[0];
	return undefined;
};

export const extractText = (raw: any): string | undefined => {
	if (!raw) return undefined;

	if (typeof raw.data === "string") {
		const t = raw.data.trim();
		if (t) return t;
	}

	if (typeof raw.verbose_data === "string") {
		const t = raw.verbose_data.trim();
		if (t) return t;
	}

	const rd = raw.recognized_data;
	if (typeof rd === "string") {
		const t = rd.trim();
		if (t) return t;
	}

	if (Array.isArray(rd)) {
		const parts: string[] = [];
		for (const item of rd) {
			if (typeof item === "string") {
				if (item.trim()) parts.push(item.trim());
				continue;
			}
			const maybe = (item?.output ?? item?.text ?? item?.content ?? item?.value) as unknown;
			if (typeof maybe === "string" && maybe.trim()) parts.push(maybe.trim());
		}
		const joined = parts.join("\n").trim();
		if (joined) return joined;
	}

	return undefined;
};

export const toCrxResult = (raw: any): { ok: boolean; data?: string; error?: string; raw?: any } => {
	const ok = !!raw?.ok;
	const data = extractText(raw);
	const error = pickFirstError(raw) ?? (ok && !data ? "No data recognized" : undefined);

	return {
		ok: ok && !!data,
		data,
		error,
		raw,
	};
};
