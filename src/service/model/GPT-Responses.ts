import { encode } from "@toon-format/toon";
import {
    actionWithDataType,
    getDataKindByMIMEType,
    typesForKind,
    detectDataKindFromContent,
    buildModificationPrompt,
    DATA_MODIFICATION_PROMPT,
    DATA_SELECTION_PROMPT,
    ENTITY_MERGE_PROMPT,
    type DataInput,
    type DataKind,
    type DataContext,
    type DataFilter,
    type ModificationInstruction
} from "./GPT-Config";
import { JSOX } from "jsox";
import {
    extractJSONFromAIResponse,
    STRICT_JSON_INSTRUCTIONS
} from "core/document/AIResponseParser";
import { canParseURL } from "core/utils/Runtime";

const hasFile = () => typeof (globalThis as any).File !== "undefined";
const hasBlob = () => typeof (globalThis as any).Blob !== "undefined";

// Standardized file size limits across the service layer
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for file processing
export const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB for base64 encoding

// Default request timeout configurations based on effort level (in milliseconds)
export const DEFAULT_REQUEST_TIMEOUTS = {
    low: 60 * 1000,      // 1 minute
    medium: 5 * 60 * 1000, // 5 minutes
    high: 15 * 60 * 1000   // 15 minutes
} as const;

export const DEFAULT_MAX_RETRIES = 2;
export const RETRY_DELAY = 2000; // 2 seconds

const getRuntimeAiSettings = (): Record<string, any> => {
    return ((globalThis as any).runtimeSettings as any)?.ai || {};
};

const normalizeDurationMs = (value: unknown, fallback: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    // Backward-compatible: treat small values as seconds.
    if (value < 1000) return value * 1000;
    return value;
};

/**
 * Get timeout configuration from settings or use defaults
 */
function getTimeoutConfig(effort: "none" | "low" | "medium" | "high"): { timeout: number; maxRetries: number } {
    const settings = getRuntimeAiSettings();
    const timeoutSettings = settings?.requestTimeout;
    const maxRetries = typeof settings?.maxRetries === "number"
        ? Math.max(0, Math.floor(settings.maxRetries))
        : DEFAULT_MAX_RETRIES;

    const timeout = normalizeDurationMs(timeoutSettings?.[effort], DEFAULT_REQUEST_TIMEOUTS[effort]);
    return { timeout, maxRetries };
}

// Optimized base64 encoding with memory safety
export const toBase64 = (bytes: Uint8Array): string => {
    // Node.js environment
    if (typeof (globalThis as any).Buffer !== "undefined") {
        return (globalThis as any).Buffer.from(bytes).toString("base64");
    }

    // Browser environment - use chunked processing for large files
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks to avoid memory issues
    if (bytes.length > CHUNK_SIZE) {
        let result = "";
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.slice(i, i + CHUNK_SIZE);
            let binary = "";
            for (let j = 0; j < chunk.length; j++) {
                binary += String.fromCharCode(chunk[j]);
            }
            result += (typeof btoa === "function" ? btoa(binary) : "");
        }
        return result;
    }

    // Small files - direct processing
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    // @ts-ignore
    return typeof btoa === "function" ? btoa(binary) : "";
};

//
export type RequestOptions = {
    effort?: "none" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    responseFormat?: "json" | "text" | "markdown";
}

export type AIResponse<T = unknown> = {
    ok: boolean;
    data?: T;
    error?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    responseId?: string | null;
}

//
export const getUsableData = async (data: DataInput) => {
    const FileCtor = hasFile() ? (globalThis as any).File : undefined;
    const BlobCtor = hasBlob() ? (globalThis as any).Blob : undefined;
    const isFileOrBlob =
        (BlobCtor && data?.dataSource instanceof BlobCtor) ||
        (FileCtor && data?.dataSource instanceof FileCtor);

    if (isFileOrBlob) {
        const fileSize = data?.dataSource?.size || 0;
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

        // Check file size limit
        if (fileSize > MAX_FILE_SIZE) {
            console.warn(`[GPT-Responses] File too large: ${fileSize} bytes > ${MAX_FILE_SIZE} bytes`);
            return {
                "type": "input_text",
                "text": `[File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB. Maximum allowed: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)}MB]`
            };
        }

        if (typesForKind?.[data?.dataKind || "input_text"] === "input_image" || (data?.dataSource?.type?.startsWith?.("image/"))) {
            try {
                const BASE64URL = `data:${data?.dataSource?.type};base64,`;
                const arrayBuffer = await data?.dataSource?.arrayBuffer();
                if (!arrayBuffer) {
                    throw new Error("Failed to read file as ArrayBuffer");
                }
                const bytes = new Uint8Array(arrayBuffer);
                const URL = BASE64URL + toBase64(bytes);
                return {
                    "type": "input_image",
                    "detail": "auto",
                    "image_url": URL
                };
            } catch (error) {
                console.error("[GPT-Responses] Failed to process image file:", error);
                return {
                    "type": "input_text",
                    "text": `[Failed to process image file: ${error}]`
                };
            }
        }

        // Handle other file types as text
        try {
            const text = await data?.dataSource?.text?.();
            if (text) {
                return {
                    "type": "input_text",
                    "text": text
                };
            }
        } catch (error) {
            console.error("[GPT-Responses] Failed to read text file:", error);
            return {
                "type": "input_text",
                "text": `[Failed to read text file: ${error}]`
            };
        }
    } else if (typeof data?.dataSource == "string") {
        // Auto-detect data kind if not specified
        const effectiveKind = data?.dataKind || detectDataKindFromContent(data.dataSource);

        // Only treat as image if explicitly detected as input_image kind
        if (typesForKind?.[effectiveKind] == "input_image") {
            // Validate that it's actually a proper data URL or regular URL
            const content = data?.dataSource?.trim?.() || "";
            if (content.startsWith("data:image/") && content.includes(";base64,")) {
                // Validate data URL format
                try {
                    const url = new URL(content);
                    if (url.protocol === "data:" && url.pathname.startsWith("image/")) {
                        return {
                            "type": "input_image",
                            "image_url": content,
                            "detail": "auto"
                        };
                    }
                } catch {
                    // Invalid data URL, treat as text
                }
            } else if (canParseURL(content)) {
                // Valid regular URL
                return {
                    "type": "input_image",
                    "image_url": content,
                    "detail": "auto"
                };
            }
        }

        // anyways returns Promise<string>
        return {
            "type": "input_text",
            "text": data?.dataSource
        }
    }

    // is not Blob or File, so it's (may be) string (if not string, try to parse it as JSON)
    let result = data?.dataSource;
    try {
        result = (typeof data?.dataSource != "object") ? data?.dataSource : encode(data?.dataSource);
    } catch (e) {
        console.warn(e);
    }

    //
    return {
        "type": typesForKind?.[data?.dataKind || "input_text"] || "text",
        "text": result
    }
}

//
export class GPTResponses {
    private apiKey: string;
    private apiSecret: string;
    private apiUrl: string = "https://api.proxyapi.ru/openai/v1";
    private model: string = "gpt-5.6-luna";
    private responseId?: string | null = null;

    protected pending: any[] = [];
    protected messages: any[] = [];
    protected tools: Map<string, any> = new Map();
    protected context: DataContext | null = null;
    protected responseMap: Map<string, any> = new Map();

    //
    constructor(apiKey: string, apiUrl: string, apiSecret: string, model: string) {
        this.apiKey = apiKey || "";
        this.apiUrl = apiUrl || this.apiUrl;
        this.apiSecret = apiSecret || "";
        this.model = model || this.model;
    }

    //
    setContext(context: DataContext | null) {
        this.context = context;
        return this;
    }

    //
    async useMCP(serverLabel: string, origin: string, clientKey: string, secretKey: string) {
        this.tools.set(origin?.trim?.(), {
            "type": "mcp",
            "server_label": serverLabel,
            "server_url": origin,
            "headers": {
                "authorization": `Bearer ${clientKey}:${secretKey}`
            },
            "require_approval": "never"
        })
        return this.tools.get(origin?.trim?.());
    }

    //
    async convertPlainToInput(
        dataSource: (string | Blob | File | any),
        dataKind: DataKind | null = null,
        additionalAction: string | null = null
    ): Promise<any> {
        dataKind ??= getDataKindByMIMEType(dataSource?.type) || "input_text";

        const dataInput: DataInput = { dataSource, dataKind, context: this.context };
        const usableData = await getUsableData(dataInput);

        return {
            type: "message",
            role: "user",
            content: [
                { type: "input_text", text: "What to do: " + actionWithDataType(dataInput) },
                additionalAction ? { type: "text", text: "Additional request data: " + additionalAction } : null,
                { type: "input_text", text: "\n === BEGIN:ATTACHED_DATA === \n" },
                { ...usableData },
                { type: "input_text", text: "\n === END:ATTACHED_DATA === \n" },
            ]?.filter?.((item) => item !== null)
        };
    }

    //
    async attachToRequest(
        dataSource: (string | Blob | File | any),
        dataKind: DataKind | null = null,
        firstAction: string | null = null
    ) {
        this.pending.push(await this.convertPlainToInput(
            dataSource,
            dataKind ??= getDataKindByMIMEType(dataSource?.type) || "input_text"
        ));
        if (firstAction) {
            this.pending.push(await this.askToDoAction(firstAction));
        }
        return this.pending[this.pending.length - 1];
    }

    //
    async attachExistingData(existingData: any, entityType?: string) {
        this.context = {
            ...this.context,
            existingData,
            entityType: entityType || this.context?.entityType
        };

        await this.giveForRequest(`existing_data: \`${encode(existingData)}\`\n`);
        return this;
    }

    //
    async giveForRequest(whatIsIt: any) {
        // If the caller passes non-string input (File/Blob/object), we must NOT put it into input_text.text.
        // Convert it into a proper content item via getUsableData() (e.g. {type:"input_image", image_url:"data:..."}).
        if (typeof whatIsIt !== "string") {
            try {
                const dataKind = getDataKindByMIMEType(whatIsIt?.type) || "input_text";
                const usable = await getUsableData({ dataSource: whatIsIt, dataKind, context: this.context });
                this?.pending?.push?.({
                    type: "message",
                    role: "user",
                    content: [
                        { type: "input_text", text: "Additional data for request:" },
                        { type: "input_text", text: "\n === BEGIN:ATTACHED_DATA === \n" },
                        { ...usable },
                        { type: "input_text", text: "\n === END:ATTACHED_DATA === \n" },
                    ]
                });
                return this?.pending?.[this?.pending?.length - 1];
            } catch (e) {
                // Fall back to string coercion (still must be string)
                whatIsIt = String(whatIsIt);
            }
        }

        this?.pending?.push?.({
            type: "message",
            role: "user",
            content: [
                { type: "input_text", text: "Additional data for request:" },
                { type: "input_text", text: String(whatIsIt) }
            ]
        });
        return this?.pending?.[this?.pending?.length - 1];
    }

    //
    async askToDoAction(action: string) {
        this?.pending?.push?.({
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: action }]
        });
        return this?.pending?.[this?.pending?.length - 1];
    }

    //
    beginFromResponseId(responseId: string | null = null) {
        this.responseId = (this.responseId = (responseId || this.responseId));
        return this;
    }

    //
    async sendRequest(
        effort: "none" | "low" | "medium" | "high" = "low",
        verbosity: "low" | "medium" | "high" = "low",
        prevResponseId: string | null = null,
        options: RequestOptions = {}
    ): Promise<string | null> {
        effort ??= "low";
        verbosity ??= "low";

        // De-duplicate pending items
        const uniquePending = new Map();
        for (const item of this.pending) {
            if (!item) continue;
            try {
                const key = typeof item === 'object' ? JSOX.stringify(item) : String(item);
                if (!uniquePending.has(key)) {
                    uniquePending.set(key, item);
                }
            } catch (e) {
                uniquePending.set(Math.random().toString(), item);
            }
        }
        const filteredInput = Array.from(uniquePending.values());

        // Build strict JSON instructions for json response format
        // Following OpenAI Responses API best practices
        const jsonInstructions = options?.responseFormat === "json"
            ? STRICT_JSON_INSTRUCTIONS
            : undefined;

        const runtimeAi = getRuntimeAiSettings();
        const configuredMaxTokens = typeof runtimeAi?.maxOutputTokens === "number" && Number.isFinite(runtimeAi.maxOutputTokens)
            ? Math.max(1, Math.floor(runtimeAi.maxOutputTokens))
            : undefined;

        const requestBody: any = {
            model: this.model,
            tools: Array.from(this?.tools?.values?.() || [])?.filter?.((tool: any) => !!tool),
            input: filteredInput,
            reasoning: { "effort": effort },
            text: { verbosity: verbosity },
            max_output_tokens: options?.maxTokens || configuredMaxTokens || 400000,
            previous_response_id: (this.responseId = (prevResponseId || this?.responseId)),
            instructions: jsonInstructions
        };

        if (runtimeAi?.contextTruncation === "auto" || runtimeAi?.contextTruncation === "disabled") {
            requestBody.truncation = runtimeAi.contextTruncation;
        }
        if (runtimeAi?.promptCacheRetention === "in-memory" || runtimeAi?.promptCacheRetention === "24h") {
            requestBody.prompt_cache_retention = runtimeAi.promptCacheRetention;
        }
        if (typeof runtimeAi?.maxToolCalls === "number" && Number.isFinite(runtimeAi.maxToolCalls)) {
            requestBody.max_tool_calls = Math.max(1, Math.floor(runtimeAi.maxToolCalls));
        }
        if (typeof runtimeAi?.parallelToolCalls === "boolean") {
            requestBody.parallel_tool_calls = runtimeAi.parallelToolCalls;
        }

        // Add temperature if specified
        /*if (options?.temperature !== undefined) {
            requestBody.temperature = options.temperature;
        }*/

        // Execute request with retry logic and timeout
        const { timeout: timeoutMs, maxRetries } = getTimeoutConfig(effort);
        console.log("[GPT] Making request to:", `${this?.apiUrl}/responses`);
        console.log("[GPT] API key present:", !!this?.apiKey);
        console.log("[GPT] Request timeout:", `${timeoutMs}ms (${timeoutMs/1000}s) (${effort} effort)`);
        console.log("[GPT] Max retries:", maxRetries);
        console.log("[GPT] Request body size:", JSON.stringify(requestBody).length, "characters");
        console.log("[GPT] Request input count:", filteredInput.length, "items");

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                console.log(`[GPT] Retry attempt ${attempt}/${maxRetries} after ${RETRY_DELAY}ms delay`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    console.warn(`[GPT] Request timeout after ${timeoutMs}ms (attempt ${attempt + 1}) - aborting request`);
                    controller.abort('timeout');
                }, timeoutMs);

                console.log(`[GPT] Sending request (attempt ${attempt + 1})...`);
                const response = await fetch(`${this?.apiUrl}/responses`, {
                    method: "POST",
                    priority: 'auto',
                    // Remove keepalive for better timeout control
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        ...(this?.apiKey ? { "Authorization": `Bearer ${this?.apiKey}` } : {})
                    },
                    body: JSON.stringify(requestBody),
                });
                console.log(`[GPT] Request sent successfully (attempt ${attempt + 1})`);

                clearTimeout(timeoutId);

                // Handle the response
                console.log("[GPT] Response status:", response.status, `(attempt ${attempt + 1})`);

                if (response.status !== 200) {
                    const error = await response?.json?.()?.catch?.((e) => {
                        console.error("[GPT] Failed to parse error response:", e);
                        return null;
                    });
                    const errorMessage = error?.error?.message || error?.message || `HTTP ${response.status}`;
                    lastError = new Error(`API error (${response.status}): ${errorMessage}`);
                    console.error("[GPT] API error:", errorMessage);

                    // Don't retry on client errors (4xx)
                    if (response.status >= 400 && response.status < 500) {
                        throw lastError;
                    }

                    // Continue to retry on server errors (5xx) or network issues
                    continue;
                }

                // Success - process the response
                return await this.processSuccessfulResponse(response);

            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                console.error(`[GPT] Request failed (attempt ${attempt + 1}):`, lastError.message);

                // Don't retry on abort (timeout) or client errors
                if (lastError.name === 'AbortError' || (lastError.message.includes('HTTP 4'))) {
                    break;
                }

                // Continue to next retry attempt
            }
        }

        // All retries failed
        const errorMessage = lastError ? lastError.message : 'Unknown error after all retries';
        console.error("[GPT] All retry attempts failed:", errorMessage);
        throw new Error(`Request failed after ${maxRetries + 1} attempts: ${errorMessage}`);
    }

    /**
     * Process a successful response from the API
     */
    private async processSuccessfulResponse(response: Response): Promise<string | null> {

        const resp = await response?.json?.()?.catch?.((e) => {
            console.warn("[GPT] Failed to parse successful response:", e);
            return null;
        });
        if (!resp) return null;

        console.log("[GPT] Raw API response structure:", {
            type: typeof resp,
            isArray: Array.isArray(resp),
            keys: Object.keys(resp).slice(0, 10),
            keysLength: Object.keys(resp).length,
            sample: JSON.stringify(resp).substring(0, 300)
        });

        //
        this.responseMap.set((this.responseId = (resp?.id || resp?.response_id || this.responseId)), resp);
        this?.messages?.push?.(...(this?.pending || []));
        this?.pending?.splice?.(0, this?.pending?.length);
        this.messages.push(...(resp?.output || []));

        // Try best-effort extraction of textual content
        const extractText = (r: any): string | null => {
            try {
                if (!r) return null;
                if (typeof r === "string") {
                    // Check if the string looks like JSON (starts and ends with quotes and contains escaped content)
                    if (r.startsWith('"') && r.endsWith('"') && r.includes('\\n')) {
                        try {
                            // Try to parse as JSON string
                            const parsed = JSON.parse(r);
                            console.log("[GPT] Parsed JSON string response:", typeof parsed, parsed?.substring?.(0, 100) || 'object');
                            if (typeof parsed === "string") {
                                return parsed;
                            } else if (typeof parsed === "object") {
                                // If it's an object, try to extract text from it
                                return extractText(parsed);
                            }
                        } catch (e) {
                            console.log("[GPT] Failed to parse JSON string, treating as plain text");
                        }
                    }
                    return r;
                }

                // Handle array responses (like when response has numeric keys)
                if (Array.isArray(r)) {
                    console.log("[GPT] Response is array with", r.length, "items");
                    console.log("[GPT] First few array items:", r.slice(0, 3).map(item => ({
                        type: typeof item,
                        keys: typeof item === 'object' ? Object.keys(item || {}) : 'N/A',
                        sample: typeof item === 'string' ? item.substring(0, 50) : JSON.stringify(item).substring(0, 100)
                    })));
                    const texts: string[] = [];
                    for (const item of r) {
                        if (typeof item === "string") texts.push(item);
                        else if (item?.text) texts.push(item.text);
                        else if (item?.content) texts.push(item.content);
                        else if (item?.message?.content) texts.push(item.message.content);
                    }
                    if (texts.length) return texts.join("\n\n");
                }

                // Handle object with numeric keys (array-like)
                if (typeof r === "object" && Object.keys(r).every(key => !isNaN(Number(key)))) {
                    console.log("[GPT] Response looks like array with", Object.keys(r).length, "numeric keys");
                    const texts: string[] = [];
                    for (const key of Object.keys(r).sort((a, b) => Number(a) - Number(b))) {
                        const item = r[key];
                        if (typeof item === "string") texts.push(item);
                        else if (item?.text) texts.push(item.text);
                        else if (item?.content) texts.push(item.content);
                        else if (item?.message?.content) texts.push(item.message.content);
                    }
                    if (texts.length) return texts.join("\n\n");
                }

                if (r.output_text && Array.isArray(r.output_text) && r.output_text.length) {
                    return r.output_text.join("\n\n");
                }
                const outputs = r.output || r.choices || [];
                const texts: string[] = [];
                for (const msg of outputs) {
                    const content = msg?.content || msg?.message?.content || [];
                    if (!content) continue;
                    if (typeof content === "string") {
                        texts.push(content);
                    } else if (Array.isArray(content)) {
                        for (const part of content) {
                            if (typeof part?.text === "string") texts.push(part.text);
                            else if (part?.text?.value) texts.push(part.text.value);
                        }
                    }
                }
                if (texts.length) return texts.join("\n\n");
            } catch (e) {
                console.warn("[GPT] Error extracting text:", e);
            }
            return null;
        };

        const text = extractText(resp);
        console.log("[GPT] Extracted text result:", text ? `"${text.substring(0, 100)}..."` : "null");
        if (text != null) {
            // Return in the expected OpenAI format for compatibility
            return JSON.stringify({
                choices: [{
                    message: {
                        content: text
                    }
                }],
                usage: resp?.usage || {},
                id: this.responseId,
                object: "chat.completion"
            });
        }

        // Fallback: return last message content as JSON string
        try {
            const fallbackText = JSOX.parse(resp?.output ?? resp) as any;
            if (fallbackText) {
                return JSON.stringify({
                    choices: [{
                        message: {
                            content: typeof fallbackText === 'string' ? fallbackText : JSON.stringify(fallbackText)
                        }
                    }],
                    usage: resp?.usage || {},
                    id: this.responseId,
                    object: "chat.completion"
                });
            }
        } catch { /* noop */ }
        return JSON.stringify({
            choices: [{
                message: {
                    content: "No text content available"
                }
            }],
            usage: {},
            id: this.responseId,
            object: "chat.completion"
        });
    }

    // === NEW METHODS FOR DATA MODIFICATION ===

    //
    async modifyExistingData(
        existingData: any,
        modificationPrompt: string,
        instructions: ModificationInstruction[] = []
    ): Promise<AIResponse<any>> {
        try {
            this.setContext({
                operation: "modify",
                existingData
            });

            await this.giveForRequest(DATA_MODIFICATION_PROMPT);
            await this.giveForRequest(`existing_entity: \`${encode(existingData)}\`\n`);

            if (instructions.length) {
                await this.giveForRequest(buildModificationPrompt(instructions));
            }

            await this.askToDoAction(modificationPrompt);

            const raw = await this.sendRequest("high", "medium", null, {
                responseFormat: "json",
                temperature: 0.2
            });


            // Use robust JSON extraction to handle markdown-wrapped responses
            const parseResult = extractJSONFromAIResponse<any>(raw);
            if (!parseResult.ok) {
                console.warn("JSON extraction failed:", parseResult.error, "Raw:", parseResult.raw);
                return { ok: false, error: parseResult.error || "Failed to parse AI response" };
            }

            return {
                ok: true,
                data: parseResult.data?.modified_entity || parseResult.data,
                responseId: this.responseId
            };
        } catch (e) {
            console.error("Error in modifyExistingData:", e);
            return { ok: false, error: String(e) };
        }
    }

    //
    async selectAndFilterData(
        dataSet: any[],
        filters: DataFilter[],
        searchTerms: string[] = []
    ): Promise<AIResponse<any[]>> {
        try {
            this.setContext({
                operation: "extract",
                filters,
                searchTerms
            });

            await this.giveForRequest(DATA_SELECTION_PROMPT);
            await this.giveForRequest(`data_set: \`${encode(dataSet)}\`\n`);

            const filterDesc = filters.map(f =>
                `Filter: ${f.field} ${f.operator} ${JSON.stringify(f.value)}`
            ).join("\n");

            await this.askToDoAction(`
Select items from the provided data set matching these criteria:
${filterDesc}
${searchTerms.length ? `\nSearch terms: ${searchTerms.join(", ")}` : ""}

Return matching items with relevance scores.
            `);

            const raw = await this.sendRequest("medium", "low", null, {
                responseFormat: "json",
                temperature: 0.1
            });


            // Use robust JSON extraction to handle markdown-wrapped responses
            const parseResult = extractJSONFromAIResponse<any>(raw);
            if (!parseResult.ok) {
                console.warn("JSON extraction failed:", parseResult.error, "Raw:", parseResult.raw);
                return { ok: false, error: parseResult.error || "Failed to parse AI response" };
            }

            return {
                ok: true,
                data: parseResult.data?.selected_items || parseResult.data,
                responseId: this.responseId
            };
        } catch (e) {
            console.error("Error in selectAndFilterData:", e);
            return { ok: false, error: String(e) };
        }
    }

    //
    async mergeEntities(
        primary: any,
        secondary: any | any[],
        mergeStrategy: "prefer_primary" | "prefer_secondary" | "prefer_newer" | "merge_all" = "prefer_primary"
    ): Promise<AIResponse<any>> {
        try {
            this.setContext({
                operation: "merge",
                existingData: primary
            });

            await this.giveForRequest(ENTITY_MERGE_PROMPT);
            await this.giveForRequest(`primary_entity: \`${encode(primary)}\`\n`);
            await this.giveForRequest(`secondary_data: \`${encode(secondary)}\`\n`);

            await this.askToDoAction(`
Merge the secondary data into the primary entity using "${mergeStrategy}" strategy:
- prefer_primary: Keep primary values when conflicts occur
- prefer_secondary: Use secondary values when conflicts occur
- prefer_newer: Compare timestamps and use newer values
- merge_all: Combine all unique values (arrays concatenated, objects deeply merged)

Return the merged entity with conflict resolution details.
            `);

            const raw = await this.sendRequest("high", "medium", null, {
                responseFormat: "json",
                temperature: 0.2
            });


            // Use robust JSON extraction to handle markdown-wrapped responses
            const parseResult = extractJSONFromAIResponse<any>(raw);
            if (!parseResult.ok) {
                console.warn("JSON extraction failed:", parseResult.error, "Raw:", parseResult.raw);
                return { ok: false, error: parseResult.error || "Failed to parse AI response" };
            }

            return {
                ok: true,
                data: parseResult.data?.merged_entity || parseResult.data,
                responseId: this.responseId
            };
        } catch (e) {
            console.error("Error in mergeEntities:", e);
            return { ok: false, error: String(e) };
        }
    }

    //
    async searchSimilar(
        referenceEntity: any,
        candidateSet: any[],
        similarityThreshold: number = 0.7
    ): Promise<AIResponse<{ item: any; similarity: number }[]>> {
        try {
            this.setContext({
                operation: "analyze"
            });

            await this.giveForRequest(`reference_entity: \`${encode(referenceEntity)}\`\n`);
            await this.giveForRequest(`candidate_set: \`${encode(candidateSet)}\`\n`);

            // Note: We still show expected format in prompt but ask for raw JSON output
            await this.askToDoAction(`
Find items in the candidate set that are similar to the reference entity.
Consider semantic similarity, not just exact matches.
Compare:
- Names/titles (fuzzy match)
- Types/kinds
- Properties overlap
- Relationships

Return items with similarity score >= ${similarityThreshold}

Expected output structure:
{
    "similar_items": [
        { "item": {...}, "similarity": 0.85, "match_reasons": [...] }
    ],
    "potential_duplicates": [...],
    "related_but_different": [...]
}
            `);

            const raw = await this.sendRequest("medium", "medium", null, {
                responseFormat: "json",
                temperature: 0.3
            });


            // Use robust JSON extraction to handle markdown-wrapped responses
            const parseResult = extractJSONFromAIResponse<any>(raw);
            if (!parseResult.ok) {
                console.warn("JSON extraction failed:", parseResult.error, "Raw:", parseResult.raw);
                return { ok: false, error: parseResult.error || "Failed to parse AI response" };
            }

            return {
                ok: true,
                data: parseResult.data?.similar_items || [],
                responseId: this.responseId
            };
        } catch (e) {
            console.error("Error in searchSimilar:", e);
            return { ok: false, error: String(e) };
        }
    }

    //
    async batchProcess(
        items: any[],
        operation: string,
        batchSize: number = 10
    ): Promise<AIResponse<any[]>> {
        const results: any[] = [];
        const errors: string[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            await this.giveForRequest(`batch_items: \`${encode(batch)}\`\n`);
            // Note: We show expected format but ask for raw JSON
            await this.askToDoAction(`
Process this batch of ${batch.length} items:
${operation}

Return processed items in same order.
Expected output: { "processed": [...], "failed": [...] }
            `);

            const raw = await this.sendRequest("medium", "low", null, {
                responseFormat: "json"
            });

            if (raw) {
                // Use robust JSON extraction to handle markdown-wrapped responses
                const parseResult = extractJSONFromAIResponse<any>(raw);
                if (parseResult.ok && parseResult.data) {
                    results.push(...(parseResult.data?.processed || []));
                    if (parseResult.data?.failed?.length) {
                        errors.push(...parseResult.data.failed.map((f: any) => f?.error || "Unknown error"));
                    }
                } else {
                    console.warn("Batch parsing failed:", parseResult.error);
                }
            }
        }

        return {
            ok: errors.length === 0,
            data: results,
            error: errors.length ? errors.join("; ") : undefined,
            responseId: this.responseId
        };
    }

    //
    clearPending() {
        this.pending.splice(0, this.pending.length);
        return this;
    }

    //
    getResponseId() { return this?.responseId; }
    getMessages() { return this?.messages; }
    getPending() { return this?.pending; }
    getContext() { return this?.context; }

    //
    getResponse(responseId: string) { return this?.responseMap?.get?.(responseId); }
}

// === HELPER FUNCTIONS ===

//
export const createGPTInstance = (
    apiKey: string,
    apiUrl?: string,
    model?: string
): GPTResponses => {
    return new GPTResponses(
        apiKey,
        apiUrl || "https://api.proxyapi.ru/openai/v1",
        "",
        model || "gpt-5.6-luna"
    );
}

//
export const quickRecognize = async (
    apiKey: string,
    data: string | Blob | File,
    apiUrl?: string,
    options: RequestOptions & { timeoutOverride?: number } = {}
): Promise<AIResponse<any>> => {
    const gpt = createGPTInstance(apiKey, apiUrl);
    await gpt.attachToRequest(data);

    let raw;
    try {
        // Use timeout override if provided, otherwise use default medium effort timeout
        const timeoutOptions = options.timeoutOverride
            ? { ...options, maxTokens: options.maxTokens }
            : options;

        raw = await gpt.sendRequest("medium", "medium", null, timeoutOptions);
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("[quickRecognize] Request failed:", errorMessage);
        return { ok: false, error: errorMessage };
    }

    if (!raw) {
        return { ok: false, error: "No response from AI service" };
    }

    // Use robust JSON extraction to handle markdown-wrapped responses
    const parseResult = extractJSONFromAIResponse<any>(raw);
    if (parseResult.ok) {
        return { ok: true, data: parseResult.data };
    }

    // Fallback to raw text if JSON extraction fails
    console.warn("[quickRecognize] JSON extraction failed, using raw text");
    return { ok: true, data: raw };
}

//
export const quickModify = async (
    apiKey: string,
    existingData: any,
    modificationPrompt: string,
    apiUrl?: string
): Promise<AIResponse<any>> => {
    const gpt = createGPTInstance(apiKey, apiUrl);
    return gpt.modifyExistingData(existingData, modificationPrompt);
}
