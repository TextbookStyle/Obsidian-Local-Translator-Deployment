// Word-level diff between two strings — ported verbatim from the browser
// extension's diffWords() (content.js, v1.6.0). LCS over word tokens
// (whitespace preserved by splitting on boundaries) keeps it dependency-free
// and fast for the text sizes an editor selection holds.

export interface DiffSegment {
	type: "eq" | "del" | "ins";
	text: string;
}

// Guard against pathological sizes: the DP table is (tokens+1)² entries.
const MAX_TOKENS = 1200;

export function diffWords(oldText: string, newText: string): DiffSegment[] {
	const tokenize = (value: string): string[] => String(value).match(/\s+|[^\s]+/g) || [];
	const a = tokenize(oldText);
	const b = tokenize(newText);

	if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
		return [
			{ type: "del", text: String(oldText) },
			{ type: "ins", text: String(newText) },
		];
	}

	const n = a.length;
	const m = b.length;
	const dp: Uint32Array[] = [];
	for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] =
				a[i] === b[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const out: DiffSegment[] = [];
	const push = (type: DiffSegment["type"], text: string): void => {
		if (!text) return;
		const last = out[out.length - 1];
		if (last && last.type === type) last.text += text;
		else out.push({ type, text });
	};

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			push("eq", a[i]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push("del", a[i]);
			i++;
		} else {
			push("ins", b[j]);
			j++;
		}
	}
	while (i < n) {
		push("del", a[i]);
		i++;
	}
	while (j < m) {
		push("ins", b[j]);
		j++;
	}
	return out;
}

// True when the two texts are token-identical (nothing was changed).
export function isUnchanged(segments: DiffSegment[]): boolean {
	return segments.every((segment) => segment.type === "eq");
}
