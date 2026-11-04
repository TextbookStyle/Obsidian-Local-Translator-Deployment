// i18n for the LLM Text Assistant Obsidian plugin.
// Ported from the browser extension's _locales/{de,en}/messages.json —
// UI strings and default system prompts, de/en, selected by Obsidian locale.

export type I18nKey =
	| "extensionName"
	| "commandName"
	| "commandNameTranslate"
	| "commandNameExpand"
	| "commandNameSummarize"
	| "commandNameGrammar"
	| "actionTranslate"
	| "actionExpand"
	| "actionSummarize"
	| "actionGrammar"
	| "menuFreePrompt"
	| "chatTitle"
	| "chatWelcomeWithContext"
	| "chatWelcomeNoContext"
	| "chatInputPlaceholder"
	| "chatSend"
	| "chatStop"
	| "chatApply"
	| "chatCopyLast"
	| "chatCopied"
	| "chatReset"
	| "chatResetWithContext"
	| "chatResetNoContext"
	| "chatGenerating"
	| "errorPrefix"
	| "errorNoText"
	| "errorNoSelection"
	| "errorNoResult"
	| "errorGeneric"
	| "requestCancelled"
	| "undoReplaced"
	| "undoButton"
	| "iconTooltipProcessing"
	| "defaultTargetLanguage"
	| "defaultPromptTranslate"
	| "defaultPromptExpand"
	| "defaultPromptSummarize"
	| "defaultPromptGrammar"
	| "freePromptSystem"
	| "freePromptContextIntro"
	| "settingsHeading"
	| "settingsApiUrl"
	| "settingsApiKey"
	| "settingsModel"
	| "settingsTemperature"
	| "settingsTimeout"
	| "settingsTargetLanguage"
	| "settingsPrompts"
	| "settingsCustomActions"
	| "settingsFreePrompt"
	| "settingsModelLoad"
	| "settingsModelsLoading"
	| "settingsModelsLoaded"
	| "settingsModelsError"
	| "settingsModelsNeedUrl"
	| "settingsContextToggle"
	| "settingsContextDesc"
	| "settingsContextChars"
	| "settingsContextCharsHint"
	| "settingsConfirmToggle"
	| "settingsConfirmDesc"
	| "chatContextToggle"
	| "chatPresetsLabel"
	| "chatPresetShorter"
	| "chatPresetFormal"
	| "chatPresetEmail"
	| "chatPresetBullets"
	| "chatPresetPromptShorter"
	| "chatPresetPromptFormal"
	| "chatPresetPromptEmail"
	| "chatPresetPromptBullets"
	| "contextIntroLabel"
	| "diffTitle"
	| "diffApply"
	| "diffDiscard"
	| "diffNoChange"
	| "toastErrorPrefix";

// Full texts are taken verbatim from the reference extension so behaviour
// and wording stay identical across both projects.
const messages: Record<string, Record<I18nKey, string>> = {
	de: {
		extensionName: "LLM Text Assistent",
		commandName: "LLM Text Assistent: Menü öffnen",
		commandNameTranslate: "LLM Text Assistent: Übersetzen",
		commandNameExpand: "LLM Text Assistent: Ausformulieren",
		commandNameSummarize: "LLM Text Assistent: Zusammenfassen",
		commandNameGrammar: "LLM Text Assistent: Rechtschreibung & Grammatik",
		actionTranslate: "🌐 Ins $TARGET_LANGUAGE$ übersetzen",
		actionExpand: "✍️ Ausformulieren",
		actionSummarize: "📋 Zusammenfassen",
		actionGrammar: "✅ Rechtschreibung & Grammatik",
		menuFreePrompt: "💬 Freier Prompt",
		chatTitle: "💬 Freier Prompt",
		chatWelcomeWithContext:
			"Text aus dem Editor wurde als Kontext geladen. Du kannst jetzt Anweisungen geben, z.B. \"Verbessere den Text\" oder \"Übersetze ins Englische\".",
		chatWelcomeNoContext:
			"Beschreibe, was mit deinem Text passieren soll. Du kannst mehrere Anweisungen nacheinander senden. Klicke auf **Übernehmen**, um das Ergebnis in den Editor einzufügen.",
		chatInputPlaceholder: "Anweisung eingeben...",
		chatSend: "Senden",
		chatStop: "⏹ Stopp",
		chatApply: "✓ Übernehmen",
		chatCopyLast: "⧉ Letzte Antwort kopieren",
		chatCopied: "✓ In die Zwischenablage kopiert",
		chatReset: "↺ Zurücksetzen",
		chatResetWithContext:
			"Chat zurückgesetzt. Text aus dem Editor wurde neu als Kontext geladen. Was möchtest du damit machen?",
		chatResetNoContext: "Chat zurückgesetzt. Was möchtest du mit deinem Text machen?",
		chatGenerating: "Generiere Antwort...",
		errorPrefix: "LLM Text Assistent: ",
		errorNoText: "Kein Text im Editor vorhanden",
		errorNoSelection: "Keine Auswahl im Editor",
		errorNoResult: "Kein generierter Text zum Übernehmen vorhanden.",
		errorGeneric: "Unbekannter Fehler",
		requestCancelled: "Anfrage abgebrochen.",
		undoReplaced: "✓ Text ersetzt",
		undoButton: "Rückgängig",
		iconTooltipProcessing: "Verarbeite… Klicken zum Abbrechen",
		defaultTargetLanguage: "Englisch",
		defaultPromptTranslate:
			"Du bist ein Übersetzungs-Werkzeug. Übersetze den unterhalb markierten Text ins $TARGET_LANGUAGE$. Behalte die Formatierung, Absätze und Zeilenumbrüche genau bei. Gib NUR die Übersetzung aus – keine Einleitung, keine Erklärung, keine Meta-Kommentare.",
		defaultPromptExpand:
			"Du bist ein Text-Werkzeug. Formuliere die unterhalb markierten Stichpunkte oder Satzfragmente zu einem vollständigen, flüssigen Text aus. Behalte die Formatierung, Absätze und Zeilenumbrüche bei. Gib NUR den ausformulierten Text aus – keine Einleitung, keine Erklärung, keine Meta-Kommentare.",
		defaultPromptSummarize:
			"Du bist ein Zusammenfassungs-Werkzeug. Fasse den unterhalb markierten Text kurz und prägnant zusammen. Behalte die Formatierung, Absätze und Zeilenumbrüche bei. Gib NUR die Zusammenfassung aus – keine Einleitung, keine Erklärung, keine Meta-Kommentare.",
		defaultPromptGrammar:
			"Du bist ein Korrektur-Werkzeug. Korrigiere Rechtschreibung, Grammatik und Zeichensetzung im unterhalb markierten Text. Behalte die Formatierung, Absätze und Zeilenumbrüche bei. Gib NUR den korrigierten Text aus – keine Einleitung, keine Erklärung, keine Meta-Kommentare.",
		freePromptSystem:
			"Du bist ein hilfreicher Text-Assistent. Bearbeite und formuliere Text anhand der Anweisungen des Nutzers. Antworte nur mit dem verarbeiteten Text, ohne zusätzliche Erklärungen, es sei denn, der Nutzer bittet darum.",
		freePromptContextIntro:
			"Der Nutzer hat folgenden Text aus dem Editor als Kontext geladen. Beziehe dich bei allen Anweisungen auf diesen Text:",
		settingsHeading: "LLM Text Assistent",
		settingsApiUrl: "API URL",
		settingsApiKey: "API Key",
		settingsModel: "Modell",
		settingsTemperature: "Temperature",
		settingsTimeout: "Timeout (Sekunden)",
		settingsTargetLanguage: "Zielsprache (Übersetzen)",
		settingsPrompts: "📝 System-Prompts",
		settingsCustomActions: "⚡ Benutzerdefinierte Aktionen",
		settingsFreePrompt: "💬 Freier Prompt (Chat-Modus)",
		settingsModelLoad: "Modelle laden",
		settingsModelsLoading: "Modelle werden geladen…",
		settingsModelsLoaded: "$COUNT$ Modelle gefunden",
		settingsModelsError: "Modelle konnten nicht geladen werden: ",
		settingsModelsNeedUrl: "Bitte zuerst eine API-URL eintragen.",
		settingsContextToggle: "Notizkontext an den Chat übergeben",
		settingsContextDesc:
			"Gibt dem freien Prompt zusätzlich Notiztitel, Pfad und den umliegenden Text mit. Der Schalter im Chat-Fenster lässt sich pro Sitzung umlegen.",
		settingsContextChars: "Max. Zeichen Notizkontext",
		settingsContextCharsHint:
			"0 = kein Kontext. Höhere Werte geben dem Modell mehr Umgebung, kosten aber Kontextfenster.",
		settingsConfirmToggle: "Ergebnis vor dem Ersetzen bestätigen",
		settingsConfirmDesc:
			"Zeigt nach jeder Aktion einen Vergleich (alt → neu) und ersetzt den Text erst nach Klick auf \"Übernehmen\". Standardmäßig aus: das Ergebnis wird direkt eingesetzt und kann über den Undo-Toast zurückgenommen werden.",
		chatContextToggle: "Notizkontext",
		chatPresetsLabel: "Vorlagen",
		chatPresetShorter: "Kürzer",
		chatPresetFormal: "Formeller",
		chatPresetEmail: "Als E-Mail",
		chatPresetBullets: "Bullet-Liste",
		chatPresetPromptShorter: "Mach den Text kürzer, ohne Inhalt zu verlieren.",
		chatPresetPromptFormal: "Schreibe den Text formeller und höflicher.",
		chatPresetPromptEmail: "Formuliere den Text als vollständige E-Mail mit Anrede und Grußformel.",
		chatPresetPromptBullets: "Fasse den Text als Bullet-Liste zusammen.",
		contextIntroLabel: "Notizkontext (nur Hintergrundinfo, nicht Teil der Aufgabe):",
		diffTitle: "Änderungen prüfen",
		diffApply: "Übernehmen",
		diffDiscard: "Verwerfen",
		diffNoChange: "Keine Änderungen — Text bleibt unverändert.",
		toastErrorPrefix: "Fehler: ",
	},
	en: {
		extensionName: "LLM Text Assistant",
		commandName: "LLM Text Assistant: Open menu",
		commandNameTranslate: "LLM Text Assistant: Translate",
		commandNameExpand: "LLM Text Assistant: Expand",
		commandNameSummarize: "LLM Text Assistant: Summarize",
		commandNameGrammar: "LLM Text Assistant: Spelling & grammar",
		actionTranslate: "🌐 Translate into $TARGET_LANGUAGE$",
		actionExpand: "✍️ Expand text",
		actionSummarize: "📋 Summarize",
		actionGrammar: "✅ Spelling & grammar",
		menuFreePrompt: "💬 Free prompt",
		chatTitle: "💬 Free Prompt",
		chatWelcomeWithContext:
			"The text from the editor has been loaded as context. You can now give instructions, e.g. \"Improve the text\" or \"Translate into German\".",
		chatWelcomeNoContext:
			"Describe what should happen with your text. You can send multiple instructions in sequence. Click **Apply** to insert the result into the editor.",
		chatInputPlaceholder: "Type an instruction...",
		chatSend: "Send",
		chatStop: "⏹ Stop",
		chatApply: "✓ Apply",
		chatCopyLast: "⧉ Copy last response",
		chatCopied: "✓ Copied to clipboard",
		chatReset: "↺ Reset",
		chatResetWithContext:
			"Chat reset. The text from the editor has been reloaded as context. What would you like to do with it?",
		chatResetNoContext: "Chat reset. What would you like to do with your text?",
		chatGenerating: "Generating response...",
		errorPrefix: "LLM Text Assistant: ",
		errorNoText: "No text in the editor",
		errorNoSelection: "No selection in the editor",
		errorNoResult: "No generated text to apply.",
		errorGeneric: "Unknown error",
		requestCancelled: "Request cancelled.",
		undoReplaced: "✓ Text replaced",
		undoButton: "Undo",
		iconTooltipProcessing: "Processing… Click to cancel",
		defaultTargetLanguage: "English",
		defaultPromptTranslate:
			"You are a translation tool. Translate the text marked below into $TARGET_LANGUAGE$. Preserve formatting, paragraphs and line breaks exactly. Output ONLY the translation – no introduction, no explanation, no meta comments.",
		defaultPromptExpand:
			"You are a text tool. Turn the bullet points or sentence fragments marked below into a complete, fluent text. Preserve formatting, paragraphs and line breaks. Output ONLY the expanded text – no introduction, no explanation, no meta comments.",
		defaultPromptSummarize:
			"You are a summarization tool. Summarize the text marked below briefly and concisely. Preserve formatting, paragraphs and line breaks. Output ONLY the summary – no introduction, no explanation, no meta comments.",
		defaultPromptGrammar:
			"You are a proofreading tool. Correct spelling, grammar and punctuation in the text marked below. Preserve formatting, paragraphs and line breaks. Output ONLY the corrected text – no introduction, no explanation, no meta comments.",
		freePromptSystem:
			"You are a helpful text assistant. Edit and phrase text according to the user's instructions. Reply only with the processed text, without additional explanations, unless the user asks for them.",
		freePromptContextIntro:
			"The user has loaded the following text from the editor as context. Refer to this text for all instructions:",
		settingsHeading: "LLM Text Assistant",
		settingsApiUrl: "API URL",
		settingsApiKey: "API key",
		settingsModel: "Model",
		settingsTemperature: "Temperature",
		settingsTimeout: "Timeout (seconds)",
		settingsTargetLanguage: "Target language (translate)",
		settingsPrompts: "📝 System prompts",
		settingsCustomActions: "⚡ Custom actions",
		settingsFreePrompt: "💬 Free prompt (chat mode)",
		settingsModelLoad: "Load models",
		settingsModelsLoading: "Loading models…",
		settingsModelsLoaded: "$COUNT$ models found",
		settingsModelsError: "Could not load models: ",
		settingsModelsNeedUrl: "Enter an API URL first.",
		settingsContextToggle: "Pass note context to the chat",
		settingsContextDesc:
			"Also gives the free prompt the note title, path and the surrounding text. The switch in the chat window can be toggled per session.",
		settingsContextChars: "Max note-context characters",
		settingsContextCharsHint:
			"0 = no context. Higher values give the model more surroundings but consume context window.",
		settingsConfirmToggle: "Confirm result before replacing",
		settingsConfirmDesc:
			"Shows a comparison (old → new) after every action and only replaces the text once you click \"Apply\". Off by default: the result is inserted directly and can be reverted via the undo toast.",
		chatContextToggle: "Note context",
		chatPresetsLabel: "Presets",
		chatPresetShorter: "Shorter",
		chatPresetFormal: "More formal",
		chatPresetEmail: "As email",
		chatPresetBullets: "Bullet list",
		chatPresetPromptShorter: "Make the text shorter without losing content.",
		chatPresetPromptFormal: "Rewrite the text in a more formal and polite tone.",
		chatPresetPromptEmail: "Turn the text into a complete email with a salutation and a sign-off.",
		chatPresetPromptBullets: "Summarize the text as a bullet list.",
		contextIntroLabel: "Note context (background information only, not part of the task):",
		diffTitle: "Review changes",
		diffApply: "Apply",
		diffDiscard: "Discard",
		diffNoChange: "No changes — text stays unchanged.",
		toastErrorPrefix: "Error: ",
	},
};

let currentLang: "de" | "en" = "en";

export function initI18n(obsidianLocale: string): void {
	currentLang = obsidianLocale.toLowerCase().startsWith("de") ? "de" : "en";
}

export function t(key: I18nKey, substitutions?: Record<string, string> | string): string {
	let text = messages[currentLang][key] ?? messages["en"][key] ?? key;
	if (typeof substitutions === "string") {
		// Legacy single-argument form used by the reference extension.
		text = text.split("$TARGET_LANGUAGE$").join(substitutions);
	} else if (substitutions) {
		for (const [name, value] of Object.entries(substitutions)) {
			text = text.split(`$${name}$`).join(value);
		}
	}
	return text;
}

export function isGerman(): boolean {
	return currentLang === "de";
}