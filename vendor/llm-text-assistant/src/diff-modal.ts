// "Review changes" modal — the Obsidian counterpart of the browser
// extension's diff overlay (showDiffConfirm in content.js, v1.6.0).
//
// Shown when the "Confirm result before replacing" setting is on: the result
// has already been streamed into the editor, so the modal compares the
// original text with the current result and either keeps it (Apply) or
// restores the original text (Discard).

import { App, Modal } from "obsidian";
import { t } from "./i18n";
import { diffWords, isUnchanged } from "./diff";

export interface DiffConfirmOptions {
	onApply: () => void;
	onDiscard: () => void;
}

// Render the word-level diff into `container`. Whitespace-only segments
// collapse to a single space so the diff stays readable instead of showing
// runs of spaces.
export function renderDiff(container: HTMLElement, oldText: string, newText: string): void {
	container.empty();
	const segments = diffWords(oldText, newText);

	if (isUnchanged(segments)) {
		container.createDiv({ cls: "llmta-diff-nochange", text: t("diffNoChange") });
		return;
	}

	for (const segment of segments) {
		const span = container.createSpan({
			text: /^\s+$/.test(segment.text) ? " " : segment.text,
		});
		if (segment.type === "del") span.addClass("llmta-diff-del");
		else if (segment.type === "ins") span.addClass("llmta-diff-ins");
	}
}

export class DiffConfirmModal extends Modal {
	private readonly oldText: string;
	private readonly newText: string;
	private readonly options: DiffConfirmOptions;
	private decided = false;

	constructor(
		app: App,
		oldText: string,
		newText: string,
		options: DiffConfirmOptions
	) {
		super(app);
		this.oldText = oldText;
		this.newText = newText;
		this.options = options;
	}

	onOpen(): void {
		this.setTitle(t("diffTitle"));
		this.contentEl.addClass("llmta-diff-modal");

		const body = this.contentEl.createDiv({ cls: "llmta-diff-body" });
		renderDiff(body, this.oldText, this.newText);

		const footer = this.contentEl.createDiv({ cls: "llmta-diff-footer" });

		const discardBtn = footer.createEl("button", { text: t("diffDiscard") });
		discardBtn.addEventListener("click", () => {
			this.decided = true;
			this.options.onDiscard();
			this.close();
		});

		const applyBtn = footer.createEl("button", {
			text: t("diffApply"),
			cls: "mod-cta",
		});
		applyBtn.addEventListener("click", () => {
			this.decided = true;
			this.options.onApply();
			this.close();
		});
	}

	onClose(): void {
		// Closing via Esc / the ✕ counts as discarding, matching the diff
		// overlay's "never write without a confirmation" contract.
		if (!this.decided) this.options.onDiscard();
	}
}
