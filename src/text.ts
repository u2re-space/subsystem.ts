/**
 * `core/text` path target: document snippets + time formatting used by markdown/doc parsers.
 */
export { sanitizeDocSnippet, truncateDocSnippet } from "../../fl.ui/src/misc/Action.ts";
export {
    formatDateTime,
    formatAsDate,
    formatAsTime,
} from "./time.ts";
