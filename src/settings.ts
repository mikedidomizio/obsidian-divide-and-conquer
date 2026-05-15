import {
	App,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
	ToggleComponent
} from "obsidian";

import type {Mode} from "./util";
import divideAndConquer from "./main";

export interface PersistedBisectSession {
	isRunning: boolean;
	candidates: string[];
	enabledUnderTest: string[];
	culpritId: string | undefined;
	enabledBeforeBisect: string[] | undefined;
	awaitingInitialAnswer: boolean;
}

export interface DACSettings {
	pluginFilterRegexes: string[];
	snippetFilterRegexes: string[];
	filterUsingDisplayName: boolean,
	filterUsingAuthor: boolean,
	filterUsingDescription: boolean,
	initializeAfterPluginChanges: boolean,
	reloadAfterPluginChanges: boolean,
	disabledStates: string | undefined;
	snapshots: string | undefined;
	levels: string | undefined;
	bisectSessions: Partial<Record<Mode, PersistedBisectSession>>;
}

export const DEFAULT_SETTINGS: DACSettings = {
	pluginFilterRegexes: [
		"hot-reload",
		"obsidian-divide-and-conquer"
	],
	snippetFilterRegexes: [],
	filterUsingDisplayName: true,
	filterUsingAuthor: false,
	filterUsingDescription: false,
	initializeAfterPluginChanges: false,
	reloadAfterPluginChanges: false,
	disabledStates: undefined,
	snapshots: undefined,
	levels: undefined,
	bisectSessions: {},
};

interface TextAreaArgs {
	mode: Mode,
	container: Setting,
	placeholder?: string,
	value?: string,
	disabledArea?: TextAreaComponent
}

export class DACSettingsTab extends PluginSettingTab {
	plugin: divideAndConquer;
	toggles: ToggleComponent[] = [];

	constructor(app: App, plugin: divideAndConquer) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Called when the Settings for DAC is opened
	 */
	public display(): void {
		const {containerEl} = this;
		containerEl.empty();
		const warning = new Setting(containerEl)
			.setName('Warning')
			.setDesc('Reinitializing or Reloading may cause disabled plugins to disappear; close and open the menu to see them again.')
		warning.settingEl.classList.add('dac-warning-setting', 'mod-warning');

		new Setting(containerEl)
			.setName('Reinitialize Obsidian after plugin changes')
			.setDesc('This is not usually necessary. If you have "Debug startup time" enabled in the Community Plugins tab you\'ll see startup times when using commmands')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.initializeAfterPluginChanges)
				.onChange(async (value) => {
					this.plugin.settings.initializeAfterPluginChanges = value;
					await this.plugin.saveData();
				})
			);

		new Setting(containerEl)
			.setName('Reload Obsidian after plugin changes')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.reloadAfterPluginChanges)
				.onChange(async (value) => {
					this.plugin.settings.reloadAfterPluginChanges = value;
					await this.plugin.saveData();
				})
			);

		containerEl.createEl('hr');

		new Setting(containerEl)
			.setName('Changes below affect filtering and bisect candidate selection.')
			.setHeading();

		new Setting(containerEl)
			.setName('Use Filters on Plugin Display Names')
			.setDesc('If this is off, DAC will only match plugins by their ID')
			.addToggle((toggle) => {
					this.toggles.push(toggle);
					return toggle
						.setValue(this.plugin.settings.filterUsingDisplayName)
						.onChange(async (value) => {
							this.plugin.settings.filterUsingDisplayName = value;
							await this.plugin.saveData();
						});
				}
			);

		new Setting(containerEl)
			.setName('Use Filters on Plugin Authors')
			.addToggle((toggle) => {
					this.toggles.push(toggle);
					return toggle
						.setValue(this.plugin.settings.filterUsingAuthor)
						.onChange(async (value) => {
							this.plugin.settings.filterUsingAuthor = value;
							await this.plugin.saveData();
						});
				}
			);

		new Setting(containerEl)
			.setName('Use Filters on Plugin Descriptions')
			.addToggle((toggle) => {
					this.toggles.push(toggle);
					return toggle
						.setValue(this.plugin.settings.filterUsingDescription)
						.onChange(async (value) => {
							this.plugin.settings.filterUsingDescription = value;
							await this.plugin.saveData();
						});
				}
			);

		const pluginExclusions = new Setting(containerEl)
			.setName('Plugin Exclusions')
			.setDesc('Exclude plugins using regex (case insensitive).\nEach new line is a new regex. Plugin ids are used for matching by default. Included plugins are on the left, excluded on the right. ')
			.setClass('dac-exclusions');
		this.addTextArea({
			mode: 'plugins',
			container: pluginExclusions,
			placeholder: '^daily/\n\\.png$\netc...',
			value: this.plugin.settings.pluginFilterRegexes.join('\n'),
			disabledArea: this.addTextArea({
				mode: 'plugins',
				container: pluginExclusions
			})
		});

		const snippetExclusions = new Setting(containerEl)
			.setName('Snippet Exclusions')
			.setDesc('Exclude snippets using regex (case insensitive).\nEach new line is a new regex. Snippet are only exclude by their name.')
			.setClass('dac-exclusions');
		this.addTextArea({
			mode: 'snippets',
			container: snippetExclusions,
			placeholder: '^daily/\n\\.png$\netc...',
			value: this.plugin.settings.snippetFilterRegexes.join('\n'),
			disabledArea: this.addTextArea({
				mode: 'snippets',
				container: snippetExclusions
			})
		});
	}

	addTextArea({
		            mode,
		            container,
		            placeholder,
		            value,
		            disabledArea
	            }: TextAreaArgs) {
		let ret!: TextAreaComponent;
		const reset = async (area: TextAreaComponent, mode: Mode) => {
			await this.plugin.saveData();
			area.setPlaceholder(
				[...(this.plugin.getIncludedItems(mode))].map(p => p.name ?? p.id).join('\n')
			)
			// although it is possible we could use .setDisabled(), it would be a major breaking change.
			// consider updating the minAppVersion to 1.2.3 and using area.setDisabled() in the next breaking change
			area.inputEl.setAttr('disabled', true);
		};

		container.addTextArea((textArea) => {
			ret = textArea;
			textArea.inputEl.setAttr('rows', 10);
			if (value) {
				textArea.setPlaceholder(placeholder ?? "").setValue(value);
			}
			textArea.setPlaceholder(
				placeholder ?? [...(this.plugin.getIncludedItems(mode))].map(p => p.name ?? p.id).join('\n')
			)
			// although it is possible we could use .setDisabled(), it would be a major breaking change
			// consider updating the minAppVersion to 1.2.3 and using area.setDisabled() in the next breaking change
			if (!disabledArea) {
				textArea.inputEl.setAttr('disabled', true);
			}

			if (disabledArea) {
				this.toggles.forEach(t => t.toggleEl.onClickEvent(reset.bind(this, disabledArea, mode)));
				textArea.inputEl.onblur = async (e: FocusEvent) => {
					await this.setFilters(mode, (e.target as HTMLInputElement).value);
					await reset(disabledArea, mode);
				};
			}
		});
		return ret;
	}

	setFilters(mode: Mode, input: string) {
		const f = input?.split('\n').filter(p => p.length);
		switch (mode) {
			case 'plugins':
				this.plugin.settings.pluginFilterRegexes = f;
				break;
			case 'snippets':
				this.plugin.settings.snippetFilterRegexes = f;
				break;
		}
		return this.plugin.saveData();
	}
}
