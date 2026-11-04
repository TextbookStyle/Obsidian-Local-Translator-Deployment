// Free prompt chat modal — ported from the browser extension's chat window
// (content.js chat UI): iterative instructions with full context, streaming
// responses, stop button and "Apply" to write the result into the editor.

import { Editor, Modal, Notice } from "obsidian";
import { I18nKey, t } from "./i18n";
import type { ChatMessage } from "./llm";
import { getEditorSelection } from "./main";
import type LlmTextAssistantPlugin from "./main";
import { DiffConfirmModal } from "./diff-modal";

// Preset prompt chips (v1.1.0, ported from the extension's CHAT_PRESETS).
// One click drops a ready-made instruction into the input field — never
// auto-sends, the user stays in control. Labels AND prompts are localized
// (the extension localizes the labels only).
const CHAT_PRESETS: Array<{ labelKey: I18nKey; promptKey: I18nKey }> = [
	{ labelKey: "chatPresetShorter", promptKey: "chatPresetPromptShorter" },
	{ labelKey: "chatPresetFormal", promptKey: "chatPresetPromptFormal" },
	{ labelKey: "chatPresetEmail", promptKey: "chatPresetPromptEmail" },
	{ labelKey: "chatPresetBullets", promptKey: "chatPresetPromptBullets" },
];

// --- helpers ---

function clipboardWrite(text: string): void {
	// The web Clipboard API is available in Obsidian (desktop and mobile).
	// The execCommand fallback is intentionally omitted: it is deprecated
	// and the plugin guidelines discourage its use.
	void navigator.clipboard.writeText(text).catch(() => {
		new Notice(t("errorPrefix") + t("errorGeneric"));
	});
}

// Bubbles are wrapped so the copy button can float on the assistant bubble.
function wrapAssistantBubble(parent: HTMLElement, bubble: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: "llmta-bubble-wrap" }, (wrapper) => {
		wrapper.appendChild(bubble);
	});
}

function addCopyButton(modal: FreePromptModal, wrapper: HTMLElement, bubble: HTMLElement): void {
	wrapper.createEl("button", { cls: "llmta-copy-btn" }, (btn) => {
		btn.type = "button";
		btn.setText("⧉");
		btn.ariaLabel = "Copy";
		btn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const text = bubble.getText();
			if (!text.trim()) return;
			clipboardWrite(text);
			// Remember as the latest assistant answer for "Apply" / copy-last
			modal.generatedText = text;
			modal.markCopied(btn);
		});
	});
}

export class FreePromptModal extends Modal {
	private plugin: LlmTextAssistantPlugin;
	private editor: Editor;
	private messages: ChatMessage[] = [];
	private abortController: AbortController | null = null;
	// Latest assistant answer — public so the copy-button helper can set it
	// when an older bubble is copied.
	generatedText = "";

	// UI elements (created in onOpen)
	private chatEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private applyBtn!: HTMLButtonElement;
	private copyBtn!: HTMLButtonElement;
	private resetBtn!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private isModalOpen = false;
	// Note context for this chat session (v1.1.0)
	private contextEnabled = false;
	private contextText = "";
	private boundKeydown: ((evt: KeyboardEvent) => void) | null = null;

	constructor(plugin: LlmTextAssistantPlugin, editor: Editor) {
		super(plugin.app);
		this.plugin = plugin;
		this.editor = editor;
	}

	onOpen() {
		this.isModalOpen = true;
		this.contentEl.addClass("llmta-chat-modal");
		this.titleEl.setText(t("chatTitle"));

		// Note context (v1.1.0): title, vault path and the text around the
		// selection. Seeded from the setting; the checkbox in the header
		// toggles it for this chat session only (same as the extension).
		this.contextEnabled = this.plugin.settings.contextEnabled === true;
		this.refreshContextText();
		this.addContextToggle();

		// Load the editor selection as initial context (if any)
		const sel = getEditorSelection(this.editor);
		const contextText = sel.text.trim() ? sel.text : "";
		this.messages = this.buildInitialMessages(contextText);

		// --- Chat transcript area ---
		this.chatEl = this.contentEl.createDiv({ cls: "llmta-chat-log" });
		this.addBubble("system", contextText ? t("chatWelcomeWithContext") : t("chatWelcomeNoContext"));

		// --- Status line (streaming indicator) ---
		this.statusEl = this.contentEl.createDiv({ cls: "llmta-chat-status is-hidden" });

		// --- Preset chips ---
		this.contentEl.appendChild(this.createPresets());

		// --- Input row ---
		const inputRow = this.contentEl.createDiv({ cls: "llmta-chat-input-row" });
		this.inputEl = inputRow.createEl("textarea", { cls: "llmta-chat-input" });
		this.inputEl.placeholder = t("chatInputPlaceholder");
		this.inputEl.rows = 2;

		const btnCol = inputRow.createDiv({ cls: "llmta-chat-buttons" });
		this.sendBtn = btnCol.createEl("button", {
			text: t("chatSend"),
			cls: "mod-cta llmta-chat-send",
		});
		this.stopBtn = btnCol.createEl("button", {
			text: t("chatStop"),
			cls: "llmta-chat-stop is-hidden",
		});

		this.sendBtn.addEventListener("click", () => this.handleSend());
		this.stopBtn.addEventListener("click", () => this.stopStreaming());
		this.inputEl.addEventListener("keydown", (evt) => {
			// Enter sends, Shift+Enter inserts a newline (same as the extension)
			if (evt.key === "Enter" && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
				evt.preventDefault();
				this.handleSend();
			}
		});

		// --- Footer with Apply / Copy / Reset ---
		const footer = this.contentEl.createDiv({ cls: "llmta-chat-footer" });
		this.applyBtn = footer.createEl("button", {
			text: t("chatApply"),
			cls: "mod-cta",
		});
		this.applyBtn.addEventListener("click", () => this.handleApply());

		this.copyBtn = footer.createEl("button", { text: t("chatCopyLast") });
		this.copyBtn.addEventListener("click", () => this.copyLatest());

		this.resetBtn = footer.createEl("button", { text: t("chatReset") });
		this.resetBtn.addEventListener("click", () => this.handleReset());

		// Ctrl/Cmd+C inside the chat log copies the latest assistant answer
		// when no text is selected (mirrors the extension's chat copy UX).
		// Modal does not extend Component in the public typings, so the
		// listener is managed manually and removed in onClose.
		this.boundKeydown = (evt: KeyboardEvent) => {
			if (!this.isModalOpen) return;
			if (evt.key !== "c" || !(evt.ctrlKey || evt.metaKey) || evt.shiftKey || evt.altKey) return;
			const active = document.activeElement;
			if (active && (active === this.inputEl || active.tagName === "TEXTAREA" || active.tagName === "INPUT")) return;
			if (this.chatEl && this.chatEl.contains(active)) return;
			const selection = window.getSelection();
			if (selection && selection.toString().trim()) return; // let Obsidian copy the selection
			if (!this.generatedText.trim()) return;
			evt.preventDefault();
			this.copyLatest();
		};
		document.addEventListener("keydown", this.boundKeydown, true);
	}

	onClose() {
		this.isModalOpen = false;
		if (this.boundKeydown) {
			document.removeEventListener("keydown", this.boundKeydown, true);
			this.boundKeydown = null;
		}
		this.stopStreaming();
	}

	// Mirrors buildInitialChatMessages from content.js
	private buildInitialMessages(contextText: string): ChatMessage[] {
		let systemContent = t("freePromptSystem");
		if (contextText) {
			systemContent +=
				"\n\n" + t("freePromptContextIntro") + "\n\n---\n" + contextText + "\n---";
		}
		// Note context is additive and clearly labelled as background
		// information so the model does not treat the note text as the task.
		if (this.contextEnabled && this.contextText.trim()) {
			systemContent +=
				"\n\n" + t("contextIntroLabel") + "\n\n---\n" + this.contextText + "\n---";
		}
		return [{ role: "system", content: systemContent }];
	}

	// Recompute the note context (title, path, surroundings) for the current
	// editor state. Mirrors setChatContextEnabled in content.js: the system
	// message is rebuilt, the visible transcript stays.
	private refreshContextText(): void {
		this.contextText = this.contextEnabled
			? this.plugin.collectContextFor(this.editor)
			: "";
	}

	// Header checkbox — per-session switch, seeded from the setting.
	private addContextToggle(): void {
		const wrap = this.titleEl.createEl("label", { cls: "llmta-chat-context" });
		const toggle = wrap.createEl("input", { type: "checkbox" });
		toggle.checked = this.contextEnabled;
		toggle.addEventListener("change", () => {
			this.contextEnabled = toggle.checked;
			this.refreshContextText();
			const sel = getEditorSelection(this.editor);
			this.messages = this.buildInitialMessages(sel.text.trim() ? sel.text : "");
		});
		wrap.createSpan({ text: t("chatContextToggle") });
	}

	// Preset chips: one click drops a ready-made instruction into the input.
	private createPresets(): HTMLElement {
		const wrap = this.contentEl.createDiv({ cls: "llmta-chat-presets" });
		wrap.createSpan({ cls: "llmta-chat-presets-label", text: t("chatPresetsLabel") });
		for (const preset of CHAT_PRESETS) {
			const chip = wrap.createEl("button", {
				cls: "llmta-chat-preset",
				text: t(preset.labelKey),
			});
			chip.type = "button";
			chip.addEventListener("click", (evt) => {
				evt.preventDefault();
				// Drop the instruction into the input; the user reviews and sends.
				this.inputEl.value = t(preset.promptKey);
				this.inputEl.focus();
			});
		}
		return wrap;
	}

	private addBubble(role: "user" | "system" | "assistant", text: string): HTMLElement {
		const bubble = this.chatEl.createDiv({ cls: `llmta-bubble llmta-bubble-${role}` });
		bubble.setText(text);
		return bubble;
	}

	// Assistant bubbles get a floating copy button (wrapped for positioning).
	private addAssistantBubble(): HTMLElement {
		const holder = this.chatEl.createDiv({ cls: "llmta-bubble-holder" });
		const bubble = holder.createDiv({ cls: "llmta-bubble llmta-bubble-assistant" });
		const wrapper = wrapAssistantBubble(holder, bubble);
		addCopyButton(this, wrapper, bubble);
		return bubble;
	}

	copyLatest(): void {
		if (!this.generatedText.trim()) {
			new Notice(t("errorPrefix") + t("errorNoResult"));
			return;
		}
		clipboardWrite(this.generatedText);
		new Notice(t("chatCopied"));
	}

	markCopied(btn: HTMLButtonElement): void {
		const prev = btn.getText();
		btn.setText("✓");
		window.setTimeout(() => btn.setText(prev), 1500);
	}

	private setGenerating(generating: boolean) {
		this.sendBtn.toggleClass("is-hidden", generating);
		this.stopBtn.toggleClass("is-hidden", !generating);
		this.statusEl.toggleClass("is-hidden", !generating);
		if (generating) {
			this.statusEl.setText(t("chatGenerating"));
		}
	}

	private handleSend() {
		const instruction = this.inputEl.value.trim();
		if (!instruction) return;
		if (this.abortController) return; // already streaming

		this.addBubble("user", instruction);
		this.messages.push({ role: "user", content: instruction });
		this.inputEl.value = "";

		this.setGenerating(true);
		const bubble = this.addAssistantBubble();
		let first = true;

		this.abortController = new AbortController();
		const client = this.plugin.getClient();

		void client.streamChat(this.messages, this.abortController.signal, {
			onToken: (token) => {
				if (first) {
					bubble.setText(token);
					first = false;
				} else {
					bubble.setText(bubble.getText() + token);
				}
			},
			onDone: (fullText) => {
				this.generatedText = fullText;
				this.messages.push({ role: "assistant", content: fullText });
				this.abortController = null;
				this.setGenerating(false);
			},
			onError: (message) => {
				bubble.setText(t("errorPrefix") + message);
				this.abortController = null;
				this.setGenerating(false);
			},
			onAborted: () => {
				// Keep already-received text (same as the extension's cancel)
				this.generatedText = bubble.getText();
				if (this.generatedText.trim()) {
					this.messages.push({ role: "assistant", content: this.generatedText });
				}
				this.abortController = null;
				this.setGenerating(false);
			},
		});
	}

	private stopStreaming() {
		if (this.abortController) {
			this.abortController.abort();
		}
	}

	private handleApply() {
		if (!this.generatedText.trim()) {
			new Notice(t("errorPrefix") + t("errorNoResult"));
			return;
		}
		const sel = getEditorSelection(this.editor);
		const write = () => {
			if (sel.isSelection) {
				this.editor.replaceRange(this.generatedText, sel.from, sel.to);
			} else {
				this.editor.replaceRange(this.generatedText, sel.from, sel.from);
			}
			this.close();
		};

		// "Confirm result before replacing": show the old→new comparison and
		// only write after the user applies it. Discarding leaves the editor
		// untouched and the chat window open.
		if (this.plugin.settings.confirmBeforeReplace) {
			new DiffConfirmModal(this.app, sel.isSelection ? sel.text : "", this.generatedText, {
				onApply: write,
				onDiscard: () => {},
			}).open();
			return;
		}
		write();
	}

	private handleReset() {
		this.stopStreaming();
		this.messages = this.buildInitialMessages("");
		const sel = getEditorSelection(this.editor);
		if (sel.text.trim()) {
			this.messages = this.buildInitialMessages(sel.text);
			this.addBubble("system", t("chatResetWithContext"));
		} else {
			this.addBubble("system", t("chatResetNoContext"));
		}
		this.generatedText = "";
	}
}