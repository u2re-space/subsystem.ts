import type { OutputFormat, RecognitionCacheEntry } from "com/service/shared/types";

export class RecognitionCache {
	private cache = new Map<string, RecognitionCacheEntry>();
	private maxEntries = 100;
	private ttl = 24 * 60 * 60 * 1000;

	private generateDataHash(data: any): string {
		if (data instanceof File) {
			return `${data.name}-${data.size}-${data.lastModified}`;
		}
		if (typeof data === "string") {
			return btoa(data).substring(0, 32);
		}
		return JSON.stringify(data).substring(0, 32);
	}

	get(data: any, format?: OutputFormat): RecognitionCacheEntry | null {
		const hash = this.generateDataHash(data);
		const entry = this.cache.get(hash);

		if (!entry) return null;

		if (Date.now() - entry.timestamp > this.ttl) {
			this.cache.delete(hash);
			return null;
		}

		if (format && entry.recognizedAs !== format) {
			return null;
		}

		return entry;
	}

	set(
		data: any,
		recognizedData: string,
		recognizedAs: OutputFormat,
		responseId: string,
		metadata?: Record<string, any>,
	): void {
		const hash = this.generateDataHash(data);

		if (this.cache.size >= this.maxEntries) {
			const oldestKey = Array.from(this.cache.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp)[0][0];
			this.cache.delete(oldestKey);
		}

		this.cache.set(hash, {
			dataHash: hash,
			recognizedData,
			recognizedAs,
			timestamp: Date.now(),
			responseId,
			metadata,
		});
	}

	clear(): void {
		this.cache.clear();
	}

	getStats() {
		return {
			entries: this.cache.size,
			maxEntries: this.maxEntries,
			ttl: this.ttl,
		};
	}
}
