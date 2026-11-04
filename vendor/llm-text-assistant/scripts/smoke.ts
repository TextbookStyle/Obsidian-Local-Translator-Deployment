// Smoke test for the plugin's core logic (no Obsidian runtime required).
// Run with: npm run smoke
// Covers: i18n strings/placeholders, buffered SSE parsing, JSON fallback,
// retry on 429, immediate failure on 401, user abort.
//
// The "obsidian" module is a typings-only package, so this test registers a
// Node loader hook that mocks requestUrl before src/llm.ts is imported.

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

register(pathToFileURL(path.join(process.cwd(), "scripts", "smoke-hook.mjs")).href);

// Node has no `window` global — llm.ts uses window.setTimeout/clearTimeout
// for popout-window compatibility. Provide a minimal shim before importing.
// biome-ignore lint/suspicious/noExplicitAny: test scaffold
(globalThis as any).window = {
	setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
	clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

// --- shared request handler the hook delegates to ---
// biome-ignore lint/suspicious/noExplicitAny: test scaffold
(globalThis as any).__smokeHandler = null;

const { initI18n, t, isGerman } = await import("../src/i18n.ts");
// Must be a dynamic import: static imports are resolved before register()
// above runs, which would bypass the obsidian mock.
const { LlmClient, modelsUrlFromApiUrl, fetchModelList } = await import("../src/llm.ts");
const { diffWords, isUnchanged } = await import("../src/diff.ts");
const { collectNoteContext } = await import("../src/note-context.ts");

let failures = 0;
function assert(cond: boolean, label: string): void {
	if (cond) {
		console.log(`  ✓ ${label}`);
	} else {
		console.error(`  ✗ ${label}`);
		failures++;
	}
}

// --- 1. i18n ---
console.log("[1] i18n");
initI18n("de");
assert(t("extensionName") === "LLM Text Assistent", "de: extensionName");
assert(isGerman() === true, "de: isGerman()");
assert(
	t("actionTranslate", { TARGET_LANGUAGE: "Englisch" }) === "🌐 Ins Englisch übersetzen",
	"de: placeholder substitution"
);
assert(t("chatPresetShorter") === "Kürzer", "de: preset label (v1.1.0)");
initI18n("en");
assert(t("extensionName") === "LLM Text Assistant", "en: extensionName");
assert(isGerman() === false, "en: isGerman()");
assert(
	t("settingsModelsLoaded", { COUNT: "3" }) === "3 models found",
	"en: $COUNT$ substitution (v1.1.0)"
);
assert(
	t("chatPresetPromptShorter").length > 0 && t("diffTitle") === "Review changes",
	"en: v1.1.0 keys present"
);

// --- helpers ---

function makeClient(timeoutSeconds = 60): InstanceType<typeof LlmClient> {
	return new LlmClient({
		apiUrl: "http://llm.test/v1/chat/completions",
		apiKey: "test-key",
		model: "test-model",
		temperature: "0.3",
		timeoutSeconds: String(timeoutSeconds),
	});
}

interface Collected {
	tokens: string[];
	fullText: string | null;
	error: string | null;
	aborted: boolean;
}

function makeCallbacks(): { cb: Collected; cbs: Record<string, (v: unknown) => void> } {
	const cb: Collected = { tokens: [], fullText: null, error: null, aborted: false };
	return {
		cb,
		cbs: {
			onToken: (token: unknown) => cb.tokens.push(String(token)),
			onDone: (fullText: unknown) => (cb.fullText = String(fullText)),
			onError: (message: unknown) => (cb.error = String(message)),
			onAborted: () => (cb.aborted = true),
		},
	};
}

// Installs a handler that receives (body, callCount, meta) and returns a
// synthetic response: { status, contentType, text } — mirroring requestUrl's
// buffered result. `meta` carries url/method/headers for GET requests.
// biome-ignore lint/suspicious/noExplicitAny: test scaffold
function mockResponse(
	handler: (
		body: Record<string, unknown>,
		n: number,
		meta: { url: string; method: string; headers: Record<string, string> }
	) => any
) {
	let n = 0;
	// biome-ignore lint/suspicious/noExplicitAny: test scaffold
	(globalThis as any).__smokeHandler = (
		body: Record<string, unknown>,
		meta: { url: string; method: string; headers: Record<string, string> }
	) => {
		n++;
		return handler(body, n, meta);
	};
	return () => {
		// biome-ignore lint/suspicious/noExplicitAny: test scaffold
		(globalThis as any).__smokeHandler = null;
	};
}

// --- 2. Buffered SSE parsing ---
console.log("[2] SSE parsing (buffered via requestUrl)");
{
	const restore = mockResponse(() => ({
		status: 200,
		contentType: "text/event-stream",
		text: 'data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n' +
			'data: {"choices":[{"delta":{"content":" "}}]}\n\n' +
			'data: {"choices":[{"delta":{"content":"Welt"}}]}\n\n' +
			"data: [DONE]\n\n",
	}));
	const { cb, cbs } = makeCallbacks();
	await makeClient().streamChat([{ role: "user", content: "hi" }], new AbortController().signal, cbs);
	assert(cb.error === null, "no error");
	assert(cb.tokens.join("") === "Hallo Welt", "tokens delivered in order");
	assert(cb.fullText === "Hallo Welt", "onDone returns full text");
	restore();
}

// --- 3. Non-SSE JSON response (endpoint ignored stream:true) ---
console.log("[3] non-streaming fallback (plain JSON)");
{
	const restore = mockResponse(() => ({
		status: 200,
		contentType: "application/json",
		text: JSON.stringify({ choices: [{ message: { content: "Plain result" } }] }),
	}));
	const { cb, cbs } = makeCallbacks();
	await makeClient().streamChat([{ role: "user", content: "hi" }], new AbortController().signal, cbs);
	assert(cb.error === null, "no error");
	assert(cb.fullText === "Plain result", "JSON fallback parsed");
	restore();
}

// --- 4. Retry on 429, success on 3rd attempt ---
console.log("[4] retry on 429");
{
	const restore = mockResponse((_body, n) =>
		n < 3
			? { status: 429, contentType: "application/json", text: JSON.stringify({ error: { message: "slow down" } }) }
			: {
					status: 200,
					contentType: "application/json",
					text: JSON.stringify({ choices: [{ message: { content: "After retries" } }] }),
				}
	);
	const { cb, cbs } = makeCallbacks(10);
	await makeClient(10).streamChat([{ role: "user", content: "hi" }], new AbortController().signal, cbs);
	assert(cb.error === null, "no error after retries");
	assert(cb.fullText === "After retries", "success on 3rd attempt");
	restore();
}

// --- 5. Immediate failure on 401 (no retry) ---
console.log("[5] 401 → no retry");
{
	const restore = mockResponse(() => ({
		status: 401,
		contentType: "application/json",
		text: JSON.stringify({ error: { message: "bad key" } }),
	}));
	const { cb, cbs } = makeCallbacks();
	const started = Date.now();
	await makeClient().streamChat([{ role: "user", content: "hi" }], new AbortController().signal, cbs);
	assert(cb.error !== null && /401|API key|API-Key/.test(cb.error as string), `error surfaced: ${cb.error}`);
	assert(Date.now() - started < 2000, "failed fast (no 1s/3s backoff)");
	restore();
}

// --- 6. User abort before the request completes ---
console.log("[6] user abort → onAborted");
{
	const restore = mockResponse(
		() =>
			new Promise(() => {
				// never resolves — the abort signal must fire onAborted
			}) as unknown as { status: number; contentType: string; text: string },
	);
	const { cb, cbs } = makeCallbacks();
	const controller = new AbortController();
	const promise = makeClient().streamChat([{ role: "user", content: "hi" }], controller.signal, cbs);
	setTimeout(() => controller.abort(), 100);
	await promise;
	assert(cb.aborted === true, "onAborted fired");
	assert(cb.fullText === null, "no text applied");
	restore();
}

// --- 7. Model-list URL derivation ---
console.log("[7] modelsUrlFromApiUrl");
{
	assert(
		modelsUrlFromApiUrl("https://api.openai.com/v1/chat/completions") ===
			"https://api.openai.com/v1/models",
		"chat/completions → /models"
	);
	assert(
		modelsUrlFromApiUrl("http://localhost:11434/v1/chat/completions") ===
			"http://localhost:11434/v1/models",
		"local endpoint"
	);
	assert(
		modelsUrlFromApiUrl("https://api.example.com/v1/chat/completions/") ===
			"https://api.example.com/v1/models",
		"trailing slash"
	);
	assert(
		modelsUrlFromApiUrl("https://api.example.com/v1/completions") ===
			"https://api.example.com/v1/models",
		"completions → /models"
	);
	assert(
		modelsUrlFromApiUrl("https://api.example.com/v1/") === "https://api.example.com/v1/models",
		"other path keeps its base"
	);
	assert(modelsUrlFromApiUrl("") === "", "empty URL → empty");
}

// --- 8. fetchModelList ---
console.log("[8] fetchModelList");
{
	let seenUrl = "";
	let seenMethod = "";
	const restore = mockResponse((_body, _n, meta) => {
		seenUrl = meta.url;
		seenMethod = meta.method;
		return {
			status: 200,
			contentType: "application/json",
			text: JSON.stringify({
				data: [{ id: "gpt-4o" }, { id: "llama3.1" }, { id: "gpt-4o" }],
			}),
		};
	});
	const models = await fetchModelList({
		apiUrl: "https://api.example.com/v1/chat/completions",
		apiKey: "test-key",
	});
	assert(seenUrl === "https://api.example.com/v1/models", `GET url derived: ${seenUrl}`);
	assert(seenMethod === "GET", "GET method used");
	assert(models.join(",") === "gpt-4o,llama3.1", `sorted + de-duplicated: ${models.join(",")}`);
	restore();
}
{
	const restore = mockResponse(() => ({
		status: 200,
		contentType: "application/json",
		text: JSON.stringify({ models: [{ name: "m2" }, "m1"] }),
	}));
	const models = await fetchModelList({ apiUrl: "https://api.example.com/v1", apiKey: "" });
	assert(models.join(",") === "m1,m2", `{models:[…]} / string entries: ${models.join(",")}`);
	restore();
}
{
	const restore = mockResponse(() => ({ status: 500, contentType: "application/json", text: "{}" }));
	let message = "";
	try {
		await fetchModelList({ apiUrl: "https://api.example.com/v1", apiKey: "" });
	} catch (err) {
		message = (err as Error).message;
	}
	assert(/500/.test(message), `HTTP error surfaced: ${message}`);
	restore();
}
{
	let message = "";
	try {
		await fetchModelList({ apiUrl: "   ", apiKey: "" });
	} catch (err) {
		message = (err as Error).message;
	}
	assert(message === t("settingsModelsNeedUrl"), `missing URL rejected: ${message}`);
}

// --- 9. diffWords ---
console.log("[9] diffWords");
{
	assert(isUnchanged(diffWords("Hallo Welt", "Hallo Welt")), "identical text → unchanged");
	assert(
		diffWords("Hallo Welt", "Hallo du Welt").some(
			(segment) => segment.type === "ins" && segment.text.includes("du")
		),
		"insertion detected"
	);
	const segments = diffWords("Zeile eins\nZeile zwei", "Zeile eins\nZeile 2");
	assert(
		segments
			.filter((segment) => segment.type !== "ins")
			.map((segment) => segment.text)
			.join("") === "Zeile eins\nZeile zwei",
		"kept + removed segments reconstruct the old text"
	);
	assert(
		segments
			.filter((segment) => segment.type !== "del")
			.map((segment) => segment.text)
			.join("") === "Zeile eins\nZeile 2",
		"kept + inserted segments reconstruct the new text"
	);
	const oversized = "w ".repeat(1300).trim();
	const fallback = diffWords(oversized, `${oversized} extra`);
	assert(
		fallback.length === 2 && fallback[0].type === "del" && fallback[1].type === "ins",
		"oversized input falls back to del + ins"
	);
}

// --- 10. collectNoteContext ---
console.log("[10] collectNoteContext");
{
	const content = "Zeile1\nZeile2\nZiel\nZeile4\nZeile5";
	const start = content.indexOf("Ziel");
	const meta = { title: "Notiz", path: "Ordner/Notiz.md" };
	const selection = { startOffset: start, endOffset: start + 4 };

	const context = collectNoteContext(content, meta, selection, "600");
	assert(context.startsWith("TITLE: Notiz\nPATH: Ordner/Notiz.md\n"), "head carries title + path");
	assert(context.includes("Zeile2") && context.includes("Zeile4"), "surroundings included");
	assert(context.length <= 600, "respects the cap");
	assert(collectNoteContext(content, meta, selection, "0") === "", "0 = off");
	assert(collectNoteContext(content, meta, selection, "") === "", "empty cap = off");
	const small = collectNoteContext(content, meta, selection, "30");
	assert(small.length <= 30, `small cap honoured (${small.length})`);
	const noMeta = collectNoteContext(content, { title: "", path: "" }, selection, "600");
	assert(!noMeta.startsWith("\n") && noMeta.includes("Zeile2"), "no title/path → body only");
}

// --- summary ---
if (failures > 0) {
	console.error(`\n${failures} assertion(s) FAILED`);
	process.exit(1);
}
console.log("\nAll smoke tests passed");