// OpenAI-compatible Chat Completions client with streaming, timeout and retry.
// Ported from the browser extension's background.js (fetchWithRetry/streamResponse):
//   - per-attempt timeout linked to a user-facing abort signal
//   - 3 attempts total, backoff 1s / 3s
//   - non-retryable: 400/401/403/404 and other 4xx (except 408/429)
//   - retryable: 408, 429, 5xx, network failures, timeouts
//   - SSE parsing with fallback when the endpoint ignores stream:true
//
// Network layer uses Obsidian's requestUrl (no CORS restrictions); streaming
// is emulated over the buffered response, with true fetch() streaming used
// only when available for lower first-token latency.

import { requestUrl } from "obsidian";
import { isGerman, t } from "./i18n.ts";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export class AbortError extends Error {
	constructor() {
		super("Aborted");
		this.name = "AbortError";
	}
}

export class UserAbortError extends Error {
	constructor() {
		super("UserAbort");
		this.name = "UserAbortError";
	}
}

interface RequestFailure extends Error {
	status?: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mapApiError(status: number, detail: string): string {
	const german = isGerman();
	if (status === 401 || status === 403) {
		return german
			? `API: Authentifizierung fehlgeschlagen (HTTP ${status}). Prüfe den API-Key.`
			: `API: authentication failed (HTTP ${status}). Check the API key.`;
	}
	if (status === 404) {
		return german
			? `API: Endpunkt oder Modell nicht gefunden (HTTP 404). Prüfe URL und Modellname.`
			: `API: endpoint or model not found (HTTP 404). Check the URL and model name.`;
	}
	if (status === 429) {
		return german
			? `API: Rate-Limit erreicht (HTTP 429). Bitte später erneut versuchen.`
			: `API: rate limit reached (HTTP 429). Please try again later.`;
	}
	return german
		? `API Fehler ${status}${detail ? ": " + detail : ""}`
		: `API error ${status}${detail ? ": " + detail : ""}`;
}

// Extract a provider error message from an error response body.
function extractApiDetail(errorText: string): string {
	try {
		const parsed: unknown = JSON.parse(errorText);
		if (
			parsed &&
			typeof parsed === "object" &&
			"error" in parsed &&
			parsed.error &&
			typeof parsed.error === "object" &&
			"message" in parsed.error &&
			typeof parsed.error.message === "string"
		) {
			return parsed.error.message;
		}
	} catch {
		/* ignore */
	}
	return "";
}

function timeoutMessage(seconds: number): string {
	return isGerman()
		? `Zeitüberschreitung nach ${seconds}s. Läuft der Server bzw. ist der Endpunkt erreichbar?`
		: `Timeout after ${seconds}s. Is the server running / the endpoint reachable?`;
}

function networkErrorMessage(): string {
	return isGerman()
		? "Netzwerkfehler: Der API-Endpunkt ist nicht erreichbar."
		: "Network error: the API endpoint is unreachable.";
}

// --- Model list (ported from the extension's background.js) ---

// Derive the model-list endpoint from a chat-completions URL.
// "…/v1/chat/completions" → "…/v1/models"; any other path keeps its base and
// gets "/models" appended, so Ollama/LM Studio/llama.cpp all work.
export function modelsUrlFromApiUrl(apiUrl: string): string {
	const url = String(apiUrl || "").trim();
	if (!url) return "";
	if (/\/chat\/completions\/?$/i.test(url)) {
		return url.replace(/\/chat\/completions\/?$/i, "/models");
	}
	if (/\/completions\/?$/i.test(url)) {
		return url.replace(/\/completions\/?$/i, "/models");
	}
	return url.replace(/\/+$/, "") + "/models";
}

// GET <endpoint>/models and return the sorted, de-duplicated model ids.
// Mirrors fetchModelList in the extension's background.js. requestUrl has no
// timeout of its own, so the request races a 15s timer.
export async function fetchModelList(
	config: Pick<LlmRequestConfig, "apiUrl" | "apiKey">
): Promise<string[]> {
	const url = modelsUrlFromApiUrl(config.apiUrl);
	if (!url) throw new Error(t("settingsModelsNeedUrl"));

	const headers: Record<string, string> = { Accept: "application/json" };
	if (config.apiKey) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}

	let timeoutId = 0;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = window.setTimeout(
			() => reject(new Error(t("settingsModelsError") + "timeout")),
			15000
		);
	});

	let response: { status: number; text: string };
	try {
		response = await Promise.race([
			requestUrl({ url, method: "GET", headers, throw: false }),
			timeout,
		]);
	} catch (err) {
		if (err instanceof Error && err.message.endsWith("timeout")) throw err;
		// requestUrl throws on network-level failures (unreachable host, DNS,
		// TLS) before any status exists.
		throw new Error(t("settingsModelsError") + "network (" + url + ")");
	} finally {
		window.clearTimeout(timeoutId);
	}

	if (response.status >= 400) {
		throw new Error(t("settingsModelsError") + "HTTP " + response.status);
	}

	let data: unknown;
	try {
		data = JSON.parse(response.text);
	} catch {
		throw new Error(t("settingsModelsError") + "invalid JSON");
	}

	// OpenAI shape: { data: [{ id }] } — Ollama's /v1/models matches. Some
	// servers answer { models: [...] } or a bare array; accept all three.
	const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	const raw = Array.isArray(data)
		? data
		: asArray(record.data).length
			? asArray(record.data)
			: asArray(record.models);

	const ids = raw
		.map((entry) =>
			typeof entry === "string"
				? entry
				: entry && typeof entry === "object"
					? String(
							(entry as { id?: unknown }).id ??
								(entry as { name?: unknown }).name ??
								""
						)
					: ""
		)
		.map((id) => id.trim())
		.filter((id) => id.length > 0);

	return Array.from(new Set(ids)).sort();
}

export interface LlmRequestConfig {
	apiUrl: string;
	apiKey: string;
	model: string;
	temperature: string;
	timeoutSeconds: string;
}

interface CompletedResponse {
	text: string;
	status: number;
	contentType: string;
}

async function fetchWithRetry(
	config: LlmRequestConfig,
	requestBody: Record<string, unknown>,
	signal: AbortSignal
): Promise<CompletedResponse> {
	const timeoutMs =
		Math.max(5, parseInt(config.timeoutSeconds || "60", 10) || 60) * 1000;

	const maxAttempts = 3; // initial try + 2 retries
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (signal.aborted) {
			throw new UserAbortError();
		}

		// Per-attempt timeout, linked to the user-facing abort signal
		const attemptController = new AbortController();
		const timeoutId = window.setTimeout(() => attemptController.abort(), timeoutMs);
		const onUserAbort = () => attemptController.abort();
		signal.addEventListener("abort", onUserAbort);

		try {
			const response = await performRequest(
				config,
				JSON.stringify(requestBody),
				attemptController.signal
			);
			window.clearTimeout(timeoutId);
			signal.removeEventListener("abort", onUserAbort);
			return response;
		} catch (err) {
			window.clearTimeout(timeoutId);
			signal.removeEventListener("abort", onUserAbort);

			if (signal.aborted) {
				throw new UserAbortError();
			}

			if (err instanceof UserAbortError) throw err;

			if (err instanceof Error && err.name === "AbortError") {
				// Per-attempt timeout fired
				lastError = new Error(timeoutMessage(timeoutMs / 1000));
			} else {
				const failure = err as RequestFailure;
				if (failure instanceof Error && typeof failure.status === "number") {
					const detail = extractApiDetail(failure.message || "");
					// Non-retryable: client/config errors
					if (
						[400, 401, 403, 404].includes(failure.status) ||
						(failure.status >= 400 &&
							failure.status < 500 &&
							failure.status !== 408 &&
							failure.status !== 429)
					) {
						throw new Error(mapApiError(failure.status, detail));
					}
					// Retryable: 408, 429, 5xx
					lastError = new Error(mapApiError(failure.status, detail));
				} else {
					// Network failure
					lastError = new Error(networkErrorMessage());
				}
			}
		}

		// Backoff before retry: 1s, then 3s
		if (attempt < maxAttempts - 1) {
			await sleep(attempt === 0 ? 1000 : 3000);
		}
	}

	throw lastError || new Error(isGerman() ? "Unbekannter Fehler" : "Unknown error");
}

// Issue a POST via requestUrl; resolves with the buffered response text.
// Non-2xx statuses are thrown as RequestFailure carrying the response text
// in `message` (like the extension's fetch wrapper).
async function performRequest(
	config: LlmRequestConfig,
	body: string,
	signal: AbortSignal
): Promise<CompletedResponse> {
	if (signal.aborted) {
		throw new UserAbortError();
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (config.apiKey) {
		headers["Authorization"] = `Bearer ${config.apiKey}`;
	}

	// requestUrl has no abort support, so race the request against the
	// user-facing abort signal; losing the race rejects immediately.
	const abortPromise = new Promise<never>((_, reject) => {
		const onAbort = () => reject(new UserAbortError());
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
	const doRequest = async (): Promise<CompletedResponse> => {
		try {
			const response = await requestUrl({
				url: config.apiUrl,
				method: "POST",
				headers,
				body,
				throw: false,
			});

			if (response.status >= 400) {
				const failure = new Error(response.text || "") as RequestFailure;
				failure.status = response.status;
				throw failure;
			}

			return {
				text: response.text,
				status: response.status,
				contentType:
					response.headers["content-type"] || response.headers["Content-Type"] || "",
			};
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			// requestUrl can throw on network-level failures (unreachable host,
			// TLS problems) before a status is available.
			if (err instanceof Error && typeof (err as RequestFailure).status !== "number") {
				throw new Error(networkErrorMessage());
			}
			throw err;
		}
	};

	try {
		return await Promise.race([doRequest(), abortPromise]);
	} finally {
		// Best-effort: { once: true } already removes the listener on abort;
		// nothing further to clean up when the request won the race.
	}
}

// An SSE stream consumed in chunks. Each chunk delivers zero or more tokens.
interface StreamChunk {
	text: string;
	done: boolean;
}

// Parse an OpenAI-style SSE stream. Returns the concatenated text.
// `nextChunk` may be null when only a fully buffered response is available
// (requestUrl); in that case the whole payload is parsed at once.
async function streamResponse(
	completed: CompletedResponse,
	nextChunk: (() => Promise<StreamChunk | null>) | null,
	onToken: (token: string) => void,
	signal: AbortSignal
): Promise<string> {
	// Non-SSE response: the endpoint ignored stream:true and returned JSON.
	if (!completed.contentType.includes("text/event-stream")) {
		const content = extractMessageContent(completed.text);
		if (content === null) {
			throw new Error(isGerman() ? "Ungültige API-Antwort" : "Invalid API response");
		}
		if (content) onToken(content);
		return content;
	}

	let buffer = "";
	let fullText = "";

	const processLine = (line: string): boolean => {
		// Returns true when the [DONE] sentinel was seen.
		if (!line.startsWith("data:")) return false;
		const payload = line.slice(5).trim();
		if (payload === "[DONE]") return true;
		const delta = extractDeltaContent(payload);
		if (typeof delta === "string" && delta.length > 0) {
			fullText += delta;
			onToken(delta);
		}
		return false;
	};

	if (nextChunk) {
		// True streaming path (fetch + ReadableStream reader).
		let done = false;
		while (!done) {
			if (signal.aborted) {
				throw new UserAbortError();
			}
			const chunk = await nextChunk();
			if (!chunk || chunk.done) break;
			buffer += chunk.text;
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
				let line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				line = line.replace(/\r$/, "");
				if (processLine(line)) {
					return fullText;
				}
			}
		}
		return fullText;
	}

	// Buffered path (requestUrl): parse the whole SSE payload at once.
	buffer = completed.text;
	let newlineIndex: number;
	while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
		let line = buffer.slice(0, newlineIndex);
		buffer = buffer.slice(newlineIndex + 1);
		line = line.replace(/\r$/, "");
		if (processLine(line)) {
			return fullText;
		}
	}
	return fullText;
}

// OpenAI-compatible JSON payload shapes (kept minimal and validated).
interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

interface ChatCompletionChunk {
	choices?: Array<{ delta?: { content?: string } }>;
}

function extractMessageContent(text: string): string | null {
	try {
		const data = JSON.parse(text) as ChatCompletionResponse;
		const content = data?.choices?.[0]?.message?.content;
		return typeof content === "string" ? content : null;
	} catch {
		return null;
	}
}

function extractDeltaContent(payload: string): string | null {
	try {
		const json = JSON.parse(payload) as ChatCompletionChunk;
		const delta = json?.choices?.[0]?.delta?.content;
		return typeof delta === "string" ? delta : null;
	} catch {
		// Ignore malformed keep-alive lines
		return null;
	}
}

function isStreamUnsupported(err: unknown): boolean {
	// Some endpoints don't support streaming and may return 400 or HTML error pages
	return err instanceof Error && /stream/i.test(err.message || "");
}

export interface StreamCallbacks {
	onToken: (token: string) => void;
	onDone: (fullText: string) => void;
	onError: (message: string) => void;
	onAborted?: () => void;
}

export class LlmClient {
	private config: LlmRequestConfig;

	constructor(config: LlmRequestConfig) {
		this.config = config;
	}

	createAbortController(): AbortController {
		return new AbortController();
	}

	// Streaming chat completion with non-streaming fallback.
	// Mirrors processTextStreaming/processFreePromptStreaming from background.js.
	async streamChat(
		messages: ChatMessage[],
		signal: AbortSignal,
		callbacks: StreamCallbacks
	): Promise<void> {
		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			messages,
			temperature: parseFloat(this.config.temperature || "0.3"),
			stream: true,
		};

		try {
			const response = await fetchWithRetry(this.config, requestBody, signal);
			const fullText = await streamResponse(
				response,
				null,
				callbacks.onToken,
				signal
			);
			callbacks.onDone(fullText);
		} catch (err) {
			if (isStreamUnsupported(err)) {
				// Fallback to non-streaming
				try {
					const body = { ...requestBody };
					delete body.stream;
					const response = await fetchWithRetry(this.config, body, signal);
					const content = extractMessageContent(response.text);
					if (typeof content !== "string" || !content) {
						throw new Error(isGerman() ? "Ungültige API-Antwort" : "Invalid API response");
					}
					callbacks.onDone(content);
				} catch (fallbackErr) {
					this.dispatchError(fallbackErr, signal, callbacks);
				}
			} else {
				this.dispatchError(err, signal, callbacks);
			}
		}
	}

	private dispatchError(err: unknown, signal: AbortSignal, callbacks: StreamCallbacks): void {
		if (signal.aborted || (err instanceof Error && err.name === "UserAbortError")) {
			callbacks.onAborted?.();
			return;
		}
		const message =
			err instanceof Error && err.message
				? err.message
				: isGerman()
					? "Unbekannter Fehler"
					: "Unknown error";
		callbacks.onError(message);
	}
}