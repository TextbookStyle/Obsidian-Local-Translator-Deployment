// LLM Text Assistant for Obsidian
// Ported from the browser extension "LLM Text Assistent" (Chrome/Firefox/
// Thunderbird) by s1t5 — same actions, prompts and streaming behaviour,
// adapted to the Obsidian editor API.
//
// Copyright (C) s1t5 — GPL-3.0-or-later (see LICENSE)

import { App, Editor, Menu, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem, TFile, moment } from "obsidian";
import { initI18n, isGerman, t } from "./i18n";
import {
	CustomAction,
	DEFAULT_SETTINGS,
	LlmTextAssistantSettings,
} from "./settings";
import { ChatMessage, LlmClient, fetchModelList } from "./llm";
import { collectNoteContext } from "./note-context";
import { FreePromptModal } from "./chat-modal";
import { DiffConfirmModal } from "./diff-modal";
import { ActionMenuModal } from "./menu-modal";

export const BUILTIN_ACTION_IDS = ["translate", "expand", "summarize", "grammar"] as const;
export type BuiltinActionId = (typeof BUILTIN_ACTION_IDS)[number];

export function getActionTitle(actionId: string, settings: LlmTextAssistantSettings): string {
	if (actionId.startsWith("custom_")) {
		const idx = parseInt(actionId.replace("custom_", ""), 10);
		const custom = settings.customActions[idx];
		if (!custom) return actionId;
		return `${custom.emoji || "⚡"} ${custom.title}`;
	}
	switch (actionId) {
		case "translate":
			return t("actionTranslate", { TARGET_LANGUAGE: settings.targetLanguage || t("defaultTargetLanguage") });
		case "expand":
			return t("actionExpand");
		case "summarize":
			return t("actionSummarize");
		case "grammar":
			return t("actionGrammar");
		default:
			return actionId;
	}
}

// --- Prompt assembly (ported from background.js buildPromptParts) ---

function resolveSystemPrompt(action: string, settings: LlmTextAssistantSettings): string {
	const targetLanguage = settings.targetLanguage || t("defaultTargetLanguage");

	if (action.startsWith("custom_")) {
		const idx = parseInt(action.replace("custom_", ""), 10);
		const custom = settings.customActions[idx];
		const prompt = custom?.prompt || "";
		if (!prompt.trim()) {
			throw new Error(
				isGerman()
					? "Benutzerdefinierte Aktion hat keinen Prompt definiert."
					: "Custom action has no prompt defined."
			);
		}
		return prompt;
	}

	const builtinPrompts: Record<string, string> = {
		translate: settings.promptTranslate || t("defaultPromptTranslate", { TARGET_LANGUAGE: targetLanguage }),
		expand: settings.promptExpand || t("defaultPromptExpand"),
		summarize: settings.promptSummarize || t("defaultPromptSummarize"),
		grammar: settings.promptGrammar || t("defaultPromptGrammar"),
	};

	let systemPrompt = builtinPrompts[action] || "";
	// Substitute the {TARGET_LANGUAGE} placeholder at runtime
	if (action === "translate") {
		systemPrompt = systemPrompt.split("{TARGET_LANGUAGE}").join(targetLanguage);
	}
	return systemPrompt;
}

export function buildPromptParts(
	action: string,
	text: string,
	settings: LlmTextAssistantSettings
): ChatMessage[] {
	const systemPrompt = resolveSystemPrompt(action, settings);

	// Embed the text inside a system-level instruction so the LLM treats it
	// as input material rather than a conversational user message.
	const german = isGerman();
	const fullSystemPrompt = german
		? `${systemPrompt}

--- ZU VERARBEITENDER TEXT (keine Chat-Nachricht!) ---
${text}
--- ENDE TEXT ---

Verarbeite den obigen Text strikt gemäß der obigen Anweisung. Gib NUR das Ergebnis aus, ohne Einleitung, Erklärung oder sonstige Zusätze.`
		: `${systemPrompt}

--- TEXT TO PROCESS (not a chat message!) ---
${text}
--- END TEXT ---

Process the text above strictly according to the instruction above. Output ONLY the result, without introduction, explanation or other additions.`;

	const userMessage = german ? "Verarbeite den Text." : "Process the text.";

	return [
		{ role: "system", content: fullSystemPrompt },
		{ role: "user", content: userMessage },
	];
}

// --- Editor helpers ---

export interface EditorSelection {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	text: string;
	isSelection: boolean;
}

export function getEditorSelection(editor: Editor): EditorSelection {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	const isSelection = from.line !== to.line || from.ch !== to.ch;
	if (isSelection) {
		return { from, to, text: editor.getRange(from, to), isSelection };
	}
	// No selection: fall back to the whole note (mirrors the extension's
	// behaviour of processing the full input field content).
	return { from, to, text: editor.getValue(), isSelection: false };
}

export interface ReplaceHandle {
	editor: Editor;
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	originalText: string;
	insertOffset: number;
	firstToken: boolean;
}

function editorEnd(editor: Editor): { line: number; ch: number } {
	const lastLine = editor.lastLine();
	return { line: lastLine, ch: editor.getLine(lastLine).length };
}

// Prepare live replacement: nothing is deleted yet; the first streamed token
// replaces the selection (or the whole note when nothing is selected), later
// tokens are appended at the cursor-following offset.
export function beginReplace(editor: Editor, sel: EditorSelection): ReplaceHandle {
	let from = { line: sel.from.line, ch: sel.from.ch };
	let to = { line: sel.to.line, ch: sel.to.ch };
	let originalText = sel.text;

	if (!sel.isSelection) {
		// Whole-note mode: range spans the entire document
		from = { line: 0, ch: 0 };
		to = editorEnd(editor);
		originalText = editor.getValue();
	}

	return {
		editor,
		from,
		to,
		originalText,
		insertOffset: editor.posToOffset(from),
		firstToken: true,
	};
}

export function applyStreamToken(handle: ReplaceHandle, token: string): void {
	const { editor } = handle;
	const pos = editor.offsetToPos(handle.insertOffset);
	if (handle.firstToken) {
		// Replace the original range with the first chunk
		editor.replaceRange(token, handle.from, handle.to);
		handle.firstToken = false;
	} else {
		editor.replaceRange(token, pos, pos);
	}
	handle.insertOffset += token.length;
}

// Undo toast (ported from the extension's undo toast): shows a Notice with an
// Undo button that restores the original text for 8 seconds.
export function showUndoToast(handle: ReplaceHandle): void {
	const { editor, from, originalText, insertOffset } = handle;
	const finalTo = editor.offsetToPos(insertOffset);
	const originalFrom = from;

	const notice = new Notice("", 8000);
	const el = notice.messageEl;
	el.empty();
	el.addClass("llmta-undo-toast");
	el.createSpan({ text: t("undoReplaced") });
	const btn = el.createEl("button", { text: t("undoButton") });
	btn.addEventListener("click", () => {
		try {
			editor.replaceRange(originalText, originalFrom, finalTo);
		} catch {
			// Editor state may have changed; fall back to a native undo step.
			editor.undo();
		}
		notice.hide();
	});
}

// --- Plugin ---

export default class LlmTextAssistantPlugin extends Plugin {
	settings!: LlmTextAssistantSettings;
	private runningNotice: Notice | null = null;
	// Command ids already registered for custom actions (v1.1.0) — re-adding an
	// id would throw, and indices shift when an action is deleted.
	private registeredCustomCommandIds = new Set<string>();

	async onload() {
		initI18n(moment.locale());
		await this.loadSettings();

		this.addSettingTab(new LlmTextAssistantSettingTab(this.app, this));

		// Ribbon icon opens the action menu
		this.addRibbonIcon("sparkles", t("extensionName"), () => {
			this.openActionMenu();
		});

		// Command palette entries
		this.addCommand({
			id: "open-menu",
			name: t("commandName"),
			editorCallback: () => this.openActionMenu(),
		});

		const builtinCommands: Record<string, string> = {
			translate: t("commandNameTranslate"),
			expand: t("commandNameExpand"),
			summarize: t("commandNameSummarize"),
			grammar: t("commandNameGrammar"),
		};
		for (const [actionId, name] of Object.entries(builtinCommands)) {
			this.addCommand({
				id: actionId,
				name,
				editorCallback: (editor) => this.runAction(editor, actionId),
			});
		}

		if (this.settings.freePromptEnabled) {
			this.addCommand({
				id: "free-prompt",
				name: `${t("menuFreePrompt")} (${t("commandName")})`,
				editorCallback: (editor) => this.openFreePrompt(editor),
			});
		}

		// Custom actions get their own commands so Obsidian hotkeys can be
		// assigned to them — parity with the extension, where every action
		// (built-in, custom, free prompt) can carry a shortcut.
		this.registerCustomActionCommands();

		// Editor context menu (right-click), mirroring the browser context menu
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				this.addActionsToMenu(menu, editor);
			})
		);
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<LlmTextAssistantSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
		if (!Array.isArray(this.settings.customActions)) {
			this.settings.customActions = [];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getClient(): LlmClient {
		return new LlmClient({
			apiUrl: this.settings.apiUrl,
			apiKey: this.settings.apiKey,
			model: this.settings.model,
			temperature: this.settings.temperature,
			timeoutSeconds: this.settings.timeoutSeconds,
		});
	}

	getActiveEditor(): Editor | null {
		const editor = this.app.workspace.activeEditor?.editor;
		if (editor) return editor;
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (leaf && leaf.view.getViewType() === "markdown") {
			const mdView = leaf.view as unknown as { editor?: Editor };
			if (mdView.editor) return mdView.editor;
		}
		return null;
	}

	// Register one command per custom action so Obsidian's hotkey settings can
	// bind them (parity with the extension's per-action shortcuts). Called on
	// load and whenever the custom-action list changes; ids that are already
	// registered are skipped, because addCommand throws on duplicates.
	// Known limitation: deleting an action leaves its command (and a hotkey
	// bound to it) registered until the next reload — command ids follow the
	// list index, so removing an entry shifts the indices.
	registerCustomActionCommands(): void {
		this.settings.customActions.forEach((action, idx) => {
			if (!action.title || !action.title.trim()) return;
			const id = `custom-action-${idx}`;
			if (this.registeredCustomCommandIds.has(id)) return;
			this.registeredCustomCommandIds.add(id);
			this.addCommand({
				id,
				name: `${action.emoji || "⚡"} ${action.title}`,
				editorCallback: (editor) => this.runAction(editor, `custom_${idx}`),
			});
		});
	}

	// Note context for the free-prompt chat (v1.1.0) — the Obsidian analogue
	// of the extension's page context: note title, vault path and the text
	// surrounding the current selection/cursor, capped by the setting.
	collectContextFor(editor: Editor): string {
		const file: TFile | null = this.app.workspace.getActiveFile();
		const sel = getEditorSelection(editor);
		return collectNoteContext(
			editor.getValue(),
			{ title: file?.basename ?? "", path: file?.path ?? "" },
			{
				startOffset: editor.posToOffset(sel.from),
				endOffset: editor.posToOffset(sel.to),
			},
			this.settings.contextChars
		);
	}

	addActionsToMenu(menu: Menu, editor: Editor) {
		// Flat menu entries (MenuItem.submenu is not part of the public typings)
		menu.addSeparator();
		for (const actionId of BUILTIN_ACTION_IDS) {
			menu.addItem((item) =>
				item.setTitle(getActionTitle(actionId, this.settings)).setIcon("sparkles").onClick(() => {
					void this.runAction(editor, actionId);
				})
			);
		}
		this.settings.customActions.forEach((action, idx) => {
			if (action.title && action.title.trim()) {
				menu.addItem((item) =>
					item.setTitle(getActionTitle(`custom_${idx}`, this.settings)).onClick(() => {
						void this.runAction(editor, `custom_${idx}`);
					})
				);
			}
		});
		if (this.settings.freePromptEnabled) {
			menu.addItem((item) =>
				item.setTitle(t("menuFreePrompt")).onClick(() => {
					this.openFreePrompt(editor);
				})
			);
		}
	}

	openActionMenu() {
		const editor = this.getActiveEditor();
		if (!editor) {
			new Notice(t("errorPrefix") + t("errorNoText"));
			return;
		}
		new ActionMenuModal(this, editor).open();
	}

	openFreePrompt(editor: Editor) {
		new FreePromptModal(this, editor).open();
	}

	// Run a built-in or custom action on the current selection (or the whole
	// note when nothing is selected) with live streaming replacement.
	async runAction(editor: Editor, actionId: string) {
		const sel = getEditorSelection(editor);
		if (!sel.text.trim()) {
			new Notice(t("errorPrefix") + t("errorNoText"));
			return;
		}

		let messages: ChatMessage[];
		try {
			messages = buildPromptParts(actionId, sel.text, this.settings);
		} catch (err) {
			new Notice(t("errorPrefix") + ((err as Error).message || t("errorGeneric")));
			return;
		}

		const controller = new AbortController();
		this.showProcessingNotice(controller);

		const handle = beginReplace(editor, sel);
		const client = this.getClient();

		await client.streamChat(messages, controller.signal, {
			onToken: (token) => applyStreamToken(handle, token),
			onDone: () => {
				this.hideProcessingNotice();
				// Read the streamed result back out of the editor so the
				// confirmation compares exactly what was written.
				const resultText = editor.getRange(
					handle.from,
					editor.offsetToPos(handle.insertOffset)
				);
				// "Confirm result before replacing": the result has already
				// been streamed into the note, so the diff modal either keeps
				// it (Apply → undo toast) or restores the original text
				// (Discard / Esc). Same contract as the extension's overlay.
				if (this.settings.confirmBeforeReplace) {
					const finalTo = editor.offsetToPos(handle.insertOffset);
					new DiffConfirmModal(this.app, handle.originalText, resultText, {
						onApply: () => showUndoToast(handle),
						onDiscard: () =>
							editor.replaceRange(handle.originalText, handle.from, finalTo),
					}).open();
					return;
				}
				showUndoToast(handle);
			},
			onError: (message) => {
				this.hideProcessingNotice();
				new Notice(t("errorPrefix") + message, 8000);
			},
			onAborted: () => {
				this.hideProcessingNotice();
				new Notice(t("requestCancelled"));
			},
		});
	}

	// "Processing… Click to cancel" toast, ported from the extension's
	// floating loading icon.
	private showProcessingNotice(controller: AbortController) {
		const notice = new Notice(t("iconTooltipProcessing"), 0);
		notice.messageEl.addEventListener("click", () => {
			controller.abort();
			this.hideProcessingNotice();
		});
		this.runningNotice = notice;
	}

	private hideProcessingNotice() {
		if (this.runningNotice) {
			this.runningNotice.hide();
			this.runningNotice = null;
		}
	}
}

// --- Settings tab (ported from options.html/options.js) ---

type PromptKey = "promptTranslate" | "promptExpand" | "promptSummarize" | "promptGrammar";

// Id of the <datalist> that backs the model field's autocomplete.
const MODEL_LIST_ID = "llmta-model-list";

class LlmTextAssistantSettingTab extends PluginSettingTab {
	plugin: LlmTextAssistantPlugin;
	// <datalist> element of the model field (v1.1.0) — filled by loadModels().
	private modelListEl: HTMLDataListElement | null = null;

	constructor(app: App, plugin: LlmTextAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Fetch the endpoint's model list and offer it as autocomplete for the
	// model field. Ported from the extension's options page.
	private async loadModels(): Promise<void> {
		const notice = new Notice(t("settingsModelsLoading"), 0);
		try {
			const models = await fetchModelList({
				apiUrl: this.plugin.settings.apiUrl,
				apiKey: this.plugin.settings.apiKey,
			});
			if (this.modelListEl) {
				this.modelListEl.empty();
				for (const model of models) {
					this.modelListEl.createEl("option", { value: model });
				}
			}
			notice.hide();
			new Notice(t("settingsModelsLoaded", { COUNT: String(models.length) }));
		} catch (err) {
			notice.hide();
			new Notice(
				t("errorPrefix") + ((err as Error).message || t("errorGeneric")),
				8000
			);
		}
	}

	// Declarative settings for Obsidian's settings search (1.13.0+).
	// Mirrors the imperative display() tab; the fallback rendering below stays
	// authoritative for users on older app versions.
	getSettingDefinitions(): SettingDefinitionItem[] {
		const german = isGerman();
		const s = this.plugin.settings;
		const text = (
			key: keyof LlmTextAssistantSettings,
			name: string,
			desc: string,
			placeholder?: string
		): SettingGroupItem => ({
			name,
			desc,
			control: { type: "text", key, defaultValue: String(s[key] ?? ""), placeholder },
		});
		const textArea = (
			key: keyof LlmTextAssistantSettings,
			name: string,
			desc: string
		): SettingGroupItem => ({
			name,
			desc,
			control: { type: "textarea", key, defaultValue: String(s[key] ?? "") },
		});

		return [
			{
				type: "group",
				heading: t("settingsHeading"),
				items: [
					text("apiUrl", t("settingsApiUrl"),
						german
							? "z. B. OpenAI, Ollama (http://localhost:11434/v1/chat/completions) oder LM Studio"
							: "e.g. OpenAI, Ollama (http://localhost:11434/v1/chat/completions) or LM Studio",
						"https://api.openai.com/v1/chat/completions"),
					text("apiKey", t("settingsApiKey"),
						german ? "Bei lokalen Endpunkten leer lassen" : "Leave empty for local endpoints",
						"sk-..."),
					text("model", t("settingsModel"),
						german ? "z. B. gpt-4, llama3.1, mistral" : "e.g. gpt-4, llama3.1, mistral",
						"gpt-3.5-turbo"),
					text("temperature", t("settingsTemperature"),
						german
							? "0 = deterministisch, 2 = sehr kreativ (Standard: 0.3)"
							: "0 = deterministic, 2 = very creative (default: 0.3)",
						"0.3"),
					text("timeoutSeconds", t("settingsTimeout"),
						german
							? "Maximale Wartezeit pro Anfrage (Standard: 60)"
							: "Maximum wait time per request (default: 60)",
						"60"),
					text("targetLanguage", t("settingsTargetLanguage"),
						german
							? "Sprache, in die übersetzt wird, z. B. Englisch, Deutsch, Französisch"
							: "Language to translate into, e.g. English, German, French",
						t("defaultTargetLanguage")),
				],
			},
			{
				type: "group",
				heading: t("settingsPrompts"),
				items: [
					textArea("promptTranslate", t("actionTranslate", { TARGET_LANGUAGE: s.targetLanguage || t("defaultTargetLanguage") }),
						german
							? "Platzhalter {TARGET_LANGUAGE} wird zur Laufzeit durch die Zielsprache ersetzt. Feld leeren = Standard-Prompt."
							: "The {TARGET_LANGUAGE} placeholder is replaced with the target language at runtime. Empty field = default prompt."),
					textArea("promptExpand", t("actionExpand"),
						german ? "Feld leeren = Standard-Prompt." : "Empty field = default prompt."),
					textArea("promptSummarize", t("actionSummarize"),
						german ? "Feld leeren = Standard-Prompt." : "Empty field = default prompt."),
					textArea("promptGrammar", t("actionGrammar"),
						german ? "Feld leeren = Standard-Prompt." : "Empty field = default prompt."),
				],
			},
			{
				type: "group",
				heading: t("settingsCustomActions"),
				items: [
					{
						name: t("settingsCustomActions"),
						desc: german
							? "Definiere eigene Aktionen mit Emoji, Titel und Prompt. Diese erscheinen im Menü und im Kontextmenü des Editors."
							: "Define your own actions with emoji, title and prompt. They appear in the menu and the editor context menu.",
						render: (setting: Setting) => {
							// Custom actions are managed with dedicated UI in display()
							setting.setDesc(
								german
									? "Verwalte die eigenen Aktionen auf der Plugin-Einstellungsseite."
									: "Manage custom actions on the plugin settings page."
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settingsFreePrompt"),
				items: [
					{
						name: german ? "Freien Prompt im Menü anzeigen" : "Show free prompt in the menu",
						desc: t("settingsFreePrompt"),
						control: { type: "toggle", key: "freePromptEnabled", defaultValue: true },
					},
				],
			},
			{
				type: "group",
				heading: t("settingsContextToggle"),
				items: [
					{
						name: t("settingsContextToggle"),
						desc: t("settingsContextDesc"),
						control: { type: "toggle", key: "contextEnabled", defaultValue: false },
					},
					text("contextChars", t("settingsContextChars"), t("settingsContextCharsHint")),
					{
						name: t("settingsConfirmToggle"),
						desc: t("settingsConfirmDesc"),
						control: { type: "toggle", key: "confirmBeforeReplace", defaultValue: false },
					},
					{
						name: t("settingsModelLoad"),
						desc: german
							? "Lädt die Modelle des Endpunkts (GET /models) als Vorschläge für das Modell-Feld."
							: "Loads the endpoint's models (GET /models) as suggestions for the model field.",
						render: (setting: Setting) => {
							setting.addButton((btn) => {
								btn.setButtonText(t("settingsModelLoad")).onClick(() => void this.loadModels());
							});
						},
					},
				],
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName(t("settingsHeading")).setHeading();

		// --- API configuration ---
		new Setting(containerEl).setName(t("settingsApiUrl")).setDesc(
			isGerman()
				? "z. B. OpenAI (https://api.openai.com/v1/chat/completions), Ollama (http://localhost:11434/v1/chat/completions) oder LM Studio"
				: "e.g. OpenAI (https://api.openai.com/v1/chat/completions), Ollama (http://localhost:11434/v1/chat/completions) or LM Studio"
		).addText((text) => {
			text.setValue(this.plugin.settings.apiUrl).onChange(async (value) => {
				this.plugin.settings.apiUrl = value;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(t("settingsApiKey")).setDesc(
			isGerman() ? "Bei lokalen Endpunkten leer lassen" : "Leave empty for local endpoints"
		).addText((text) => {
			text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
				this.plugin.settings.apiKey = value;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(t("settingsModel")).setDesc(
			isGerman()
				? "z. B. gpt-4, llama3.1, mistral. „Modelle laden“ holt die Modelle des Endpunkts als Vorschläge."
				: "e.g. gpt-4, llama3.1, mistral. \"Load models\" fetches the endpoint's models as suggestions."
		).addText((text) => {
			text.setValue(this.plugin.settings.model).onChange(async (value) => {
				this.plugin.settings.model = value;
				await this.plugin.saveSettings();
			});
			text.inputEl.setAttribute("list", MODEL_LIST_ID);
		}).addButton((btn) => {
			btn.setButtonText(t("settingsModelLoad")).onClick(() => void this.loadModels());
		});

		// Backs the model field's autocomplete (native <input list=…>).
		this.modelListEl = containerEl.createEl("datalist");
		this.modelListEl.id = MODEL_LIST_ID;

		new Setting(containerEl).setName(t("settingsTemperature")).setDesc(
			isGerman()
				? "0 = deterministisch, 2 = sehr kreativ (Standard: 0.3)"
				: "0 = deterministic, 2 = very creative (default: 0.3)"
		).addText((text) => {
			text.setValue(this.plugin.settings.temperature).onChange(async (value) => {
				this.plugin.settings.temperature = value;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(t("settingsTimeout")).setDesc(
			isGerman()
				? "Maximale Wartezeit pro Anfrage (Standard: 60)"
				: "Maximum wait time per request (default: 60)"
		).addText((text) => {
			text.setValue(this.plugin.settings.timeoutSeconds).onChange(async (value) => {
				this.plugin.settings.timeoutSeconds = value;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName(t("settingsTargetLanguage")).setDesc(
			isGerman()
				? "Sprache, in die übersetzt wird, z. B. Englisch, Deutsch, Französisch"
				: "Language to translate into, e.g. English, German, French"
		).addText((text) => {
			text.setValue(this.plugin.settings.targetLanguage || t("defaultTargetLanguage")).onChange(async (value) => {
				this.plugin.settings.targetLanguage = value;
				await this.plugin.saveSettings();
			});
		});

		// --- System prompts ---
		new Setting(containerEl).setName(t("settingsPrompts")).setHeading();
		// The settings model keeps the prompt fields empty by default so the
		// localized defaults stay locale-aware. The UI therefore shows the
		// effective prompt: the stored value, or the localized default.
		const promptFields: Array<{ key: PromptKey; name: string; fallback: string }> = [
			{
				key: "promptTranslate",
				name: t("actionTranslate", { TARGET_LANGUAGE: this.plugin.settings.targetLanguage || t("defaultTargetLanguage") }),
				fallback: t("defaultPromptTranslate", { TARGET_LANGUAGE: "{TARGET_LANGUAGE}" }),
			},
			{ key: "promptExpand", name: t("actionExpand"), fallback: t("defaultPromptExpand") },
			{ key: "promptSummarize", name: t("actionSummarize"), fallback: t("defaultPromptSummarize") },
			{ key: "promptGrammar", name: t("actionGrammar"), fallback: t("defaultPromptGrammar") },
		];
		for (const { key, name, fallback } of promptFields) {
			const setting = new Setting(containerEl).setName(name);
			if (key === "promptTranslate") {
				setting.setDesc(
					isGerman()
						? "Platzhalter {TARGET_LANGUAGE} wird zur Laufzeit durch die Zielsprache ersetzt. Feld leeren = Standard-Prompt."
						: "The {TARGET_LANGUAGE} placeholder is replaced with the target language at runtime. Empty field = default prompt."
				);
			}
			setting.addTextArea((text) => {
				text.setValue(this.plugin.settings[key] || fallback).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.rows = 4;
				text.inputEl.addClass("llmta-settings-textarea");
			});
		}

		// --- Custom actions ---
		new Setting(containerEl).setName(t("settingsCustomActions")).setHeading();
		new Setting(containerEl).setDesc(
			isGerman()
				? "Definiere eigene Aktionen mit Emoji, Titel und Prompt. Diese erscheinen im Menü und im Kontextmenü des Editors."
				: "Define your own actions with emoji, title and prompt. They appear in the menu and the editor context menu."
		);

		const renderCustomActions = () => {
			listEl.empty();
			this.plugin.settings.customActions.forEach((action: CustomAction, idx: number) => {
				const wrapper = listEl.createDiv({ cls: "llmta-custom-action" });
				const row = wrapper.createDiv({ cls: "llmta-custom-action-row" });
				const emojiInput = row.createEl("input", { type: "text", cls: "llmta-emoji-input" });
				emojiInput.value = action.emoji || "⚡";
				const titleInput = row.createEl("input", {
					type: "text",
					placeholder: isGerman() ? "Aktionstitel" : "Action title",
				});
				titleInput.value = action.title || "";

				const promptArea = wrapper.createEl("textarea", {
					cls: "llmta-prompt-textarea",
				});
				promptArea.placeholder = isGerman()
					? "System-Prompt für diese Aktion..."
					: "System prompt for this action...";
				promptArea.rows = 2;
				promptArea.value = action.prompt || "";

				const removeBtn = row.createEl("button", {
					text: isGerman() ? "🗑 Entfernen" : "🗑 Remove",
					cls: "llmta-remove-btn",
				});

				const update = () => {
					this.plugin.settings.customActions[idx] = {
						emoji: emojiInput.value,
						title: titleInput.value,
						prompt: promptArea.value,
					};
					void this.plugin.saveSettings();
				};
				emojiInput.addEventListener("change", update);
				titleInput.addEventListener("change", update);
				promptArea.addEventListener("change", update);
				removeBtn.addEventListener("click", () => {
					this.plugin.settings.customActions.splice(idx, 1);
					void this.plugin.saveSettings();
					// Give newly created / re-indexed actions their commands
					// (existing ids are skipped inside the plugin).
					this.plugin.registerCustomActionCommands();
					renderCustomActions();
				});
			});
		};

		const listEl = containerEl.createDiv();
		renderCustomActions();

		new Setting(containerEl).addButton((btn) => {
			btn.setButtonText(isGerman() ? "＋ Neue Aktion hinzufügen" : "＋ Add new action").onClick(() => {
				this.plugin.settings.customActions.push({ emoji: "⚡", title: "", prompt: "" });
				void this.plugin.saveSettings();
				this.plugin.registerCustomActionCommands();
				renderCustomActions();
			});
		});

		// --- Free prompt ---
		new Setting(containerEl).setName(t("settingsFreePrompt")).setHeading();
		new Setting(containerEl).setName(
			isGerman() ? "Freien Prompt im Menü anzeigen" : "Show free prompt in the menu"
		).addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.freePromptEnabled).onChange(async (value) => {
				this.plugin.settings.freePromptEnabled = value;
				await this.plugin.saveSettings();
			});
		});

		// --- Note context for the free prompt (v1.1.0) ---
		new Setting(containerEl).setName(t("settingsContextToggle")).setDesc(t("settingsContextDesc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.contextEnabled).onChange(async (value) => {
					this.plugin.settings.contextEnabled = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(t("settingsContextChars")).setDesc(t("settingsContextCharsHint"))
			.addText((text) => {
				text.setValue(this.plugin.settings.contextChars).onChange(async (value) => {
					this.plugin.settings.contextChars = value;
					await this.plugin.saveSettings();
				});
			});

		// --- Replacement behaviour (v1.1.0) ---
		new Setting(containerEl).setName(t("settingsConfirmToggle")).setDesc(t("settingsConfirmDesc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.confirmBeforeReplace).onChange(async (value) => {
					this.plugin.settings.confirmBeforeReplace = value;
					await this.plugin.saveSettings();
				});
			});
	}
}