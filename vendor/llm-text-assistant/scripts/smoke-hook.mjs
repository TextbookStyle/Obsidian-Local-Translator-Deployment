// Node loader hook for the smoke test: mocks the typings-only "obsidian"
// package by answering requestUrl() calls through the handler installed in
// scripts/smoke.ts (globalThis.__smokeHandler).

const OBSIDIAN_SPECIFIER = "obsidian";

export async function resolve(specifier, context, nextResolve) {
	if (specifier === OBSIDIAN_SPECIFIER) {
		return {
			shortCircuit: true,
			url: "data:text/javascript,export default undefined;",
		};
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url.startsWith("file:") && url.endsWith("llm.ts")) {
		// Rewrite the obsidian import into the mock module before TypeScript
		// stripping happens. The mock lives next to this hook file.
		const { readFile } = await import("node:fs/promises");
		const { pathToFileURL } = await import("node:url");
		const { fileURLToPath } = await import("node:url");
		const mockUrl = pathToFileURL(
			new URL("obsidian-mock.ts", import.meta.url).pathname
		).href;
		const filePath = fileURLToPath(url);
		let source = await readFile(filePath, "utf8");
		source = source.replace(
			/import \{ requestUrl \} from "obsidian";/,
			`import { requestUrl } from "${mockUrl}";`
		);
		return {
			shortCircuit: true,
			format: "module-typescript",
			source,
		};
	}
	return nextLoad(url, context);
}