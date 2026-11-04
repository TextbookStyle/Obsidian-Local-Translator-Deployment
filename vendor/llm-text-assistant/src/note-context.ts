// Note context for the free-prompt chat — the Obsidian analogue of the
// browser extension's collectPageContext() (content.js, v1.6.0).
//
// The extension feeds the page title, URL and the paragraphs around the input
// field into the chat's system message. Obsidian has no page, so the
// equivalents are the note title, the vault path and the text surrounding the
// processed selection (nearest lines first, capped by the setting).
//
// Pure function (content + offsets + metadata) so it can be smoke-tested
// without an Obsidian runtime.

export interface NoteContextMeta {
	title: string;
	path: string;
}

export interface NoteContextSelection {
	startOffset: number;
	endOffset: number;
}

// Keep the LAST `max` characters, starting at a line boundary (the text
// immediately before the selection reads top-down).
function tailLines(text: string, max: number): string {
	if (max <= 0) return "";
	if (text.length <= max) return text.trim();
	const slice = text.slice(text.length - max);
	const newline = slice.indexOf("\n");
	return (newline >= 0 ? slice.slice(newline + 1) : slice).trim();
}

// Keep the FIRST `max` characters, ending at a line boundary.
function headLines(text: string, max: number): string {
	if (max <= 0) return "";
	if (text.length <= max) return text.trim();
	const slice = text.slice(0, max);
	const newline = slice.lastIndexOf("\n");
	return (newline >= 0 ? slice.slice(0, newline) : slice).trim();
}

export function collectNoteContext(
	content: string,
	meta: NoteContextMeta,
	selection: NoteContextSelection,
	maxChars: string
): string {
	const limit = parseInt(maxChars, 10);
	if (!limit || limit <= 0) return "";

	const parts: string[] = [];
	if (meta.title && meta.title.trim()) parts.push("TITLE: " + meta.title.trim());
	if (meta.path && meta.path.trim()) parts.push("PATH: " + meta.path.trim());
	const head = parts.join("\n");

	const start = Math.max(0, Math.min(selection.startOffset, content.length));
	const end = Math.max(start, Math.min(selection.endOffset, content.length));
	const half = Math.max(0, Math.floor(limit / 2));
	const body = [
		tailLines(content.slice(0, start), half),
		headLines(content.slice(end), half),
	]
		.filter((part) => part.length > 0)
		.join("\n");

	// Reserve room for title/path; if the cap is tiny, drop the surroundings
	// first (same policy as collectPageContext).
	if (head.length >= limit) return head.slice(0, limit);
	const room = limit - head.length - 1;
	const bodyText = body.slice(0, Math.max(0, room));
	if (!bodyText) return head;
	return head ? head + "\n" + bodyText : bodyText;
}
