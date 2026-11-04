// Action selection menu modal — the Obsidian counterpart of the browser
// extension's floating icon menu. Lists built-in actions, custom actions and
// (if enabled) the free prompt entry.

import { Editor, FuzzySuggestModal } from "obsidian";
import { t } from "./i18n";
import LlmTextAssistantPlugin, { BUILTIN_ACTION_IDS, getActionTitle } from "./main";

export class ActionMenuModal extends FuzzySuggestModal<string> {
	private plugin: LlmTextAssistantPlugin;
	private editor: Editor;

	constructor(plugin: LlmTextAssistantPlugin, editor: Editor) {
		super(plugin.app);
		this.plugin = plugin;
		this.editor = editor;
	}

	getItems(): string[] {
		const items: string[] = [...BUILTIN_ACTION_IDS];
		this.plugin.settings.customActions.forEach((action, idx) => {
			if (action.title && action.title.trim()) {
				items.push(`custom_${idx}`);
			}
		});
		if (this.plugin.settings.freePromptEnabled) {
			items.push("__free_prompt__");
		}
		return items;
	}

	getItemText(item: string): string {
		if (item === "__free_prompt__") {
			return t("menuFreePrompt");
		}
		return getActionTitle(item, this.plugin.settings);
	}

	onChooseItem(item: string) {
		if (item === "__free_prompt__") {
			this.plugin.openFreePrompt(this.editor);
			return;
		}
		void this.plugin.runAction(this.editor, item);
	}
}