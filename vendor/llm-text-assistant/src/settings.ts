// Settings model for the LLM Text Assistant Obsidian plugin.
// Mirrors the browser extension's DEFAULT_CONFIG (background.js) so users
// can copy their endpoint/model configuration between both tools.

export interface CustomAction {
	emoji: string;
	title: string;
	prompt: string;
}

export interface LlmTextAssistantSettings {
	apiUrl: string;
	apiKey: string;
	model: string;
	temperature: string;
	timeoutSeconds: string;
	targetLanguage: string;
	promptTranslate: string;
	promptExpand: string;
	promptSummarize: string;
	promptGrammar: string;
	customActions: CustomAction[];
	freePromptEnabled: boolean;
	// v1.1.0 — mirrors the browser extension's v1.6.0 settings.
	// Note context: title/path/surroundings for the free-prompt chat.
	contextEnabled: boolean;
	contextChars: string;
	// Show an old→new diff after every action and only write on confirmation.
	confirmBeforeReplace: boolean;
}

export const DEFAULT_SETTINGS: LlmTextAssistantSettings = {
	apiUrl: "https://api.openai.com/v1/chat/completions",
	apiKey: "",
	model: "gpt-3.5-turbo",
	temperature: "0.3",
	timeoutSeconds: "60",
	targetLanguage: "", // resolved at runtime via i18n (locale-dependent default)
	promptTranslate: "", // locale-dependent defaults resolved at runtime
	promptExpand: "",
	promptSummarize: "",
	promptGrammar: "",
	customActions: [],
	freePromptEnabled: true,
	contextEnabled: false,
	contextChars: "600",
	confirmBeforeReplace: false,
};