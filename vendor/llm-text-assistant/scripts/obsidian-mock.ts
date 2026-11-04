// Mock of the Obsidian requestUrl API used by the smoke test.
// Delegates to the handler installed in smoke.ts (globalThis.__smokeHandler).
// The handler is read at CALL time, not import time — tests install their
// handlers after this module has been loaded.

interface MockResponse {
	status: number;
	contentType: string;
	text: string;
}

// biome-ignore lint/suspicious/noExplicitAny: test scaffold
type Handler = (
	body: Record<string, unknown>,
	meta: { url: string; method: string; headers: Record<string, string> }
) => MockResponse | Promise<MockResponse>;

function getHandler(): Handler | null {
	// biome-ignore lint/suspicious/noExplicitAny: test scaffold
	return (globalThis as any).__smokeHandler as Handler | null;
}

export function requestUrl(param: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
}): Promise<{
	status: number;
	headers: Record<string, string>;
	text: string;
}> {
	const handler = getHandler();
	if (!handler) {
		return Promise.reject(new Error("no smoke handler installed"));
	}
	let body: Record<string, unknown> = {};
	try {
		body = JSON.parse(String(param.body ?? "{}"));
	} catch {
		body = {};
	}
	const result = handler(body, {
		url: param.url,
		method: param.method || "GET",
		headers: param.headers || {},
	});
	const response = result instanceof Promise ? result : Promise.resolve(result);
	return response.then((res) => ({
		status: res.status,
		headers: { "content-type": res.contentType },
		text: res.text,
	}));
}