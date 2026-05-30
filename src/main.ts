import {Notice, Plugin, SettingsTab} from "obsidian";
import type {Composed, Func, Mode} from "./util";
import {
	DACSettingsTab,
	DEFAULT_SETTINGS,
	type PersistedBisectSession
} from "./settings";
import {
	Modes,
	compose,
	getSnippetItems,
	makeArray,
	queryText,
	removeSetupDebugNotice,
	simpleCalc
} from "./util";
import {around} from "monkey-around";
import tinycolor from "tinycolor2";

const CSS_DELAY = 200;

/** Plugin IDs that must never be disabled by any bulk-disable or bisect operation. */
const PROTECTED_IDS = new Set(["obsidian-divide-and-conquer", "hot-reload"]);

interface DACCommand {
	id: string;
	method: keyof divideAndConquer;
	name: string;
}

interface DACButton {
	id: keyof divideAndConquer;
	tooltip: string;
}

interface NameNID {
	name: string;
	id: string;
	author?: string;
	description?: string;
}

interface BisectSession {
	isRunning: boolean;
	/** Which direction the bisect is running: "disable" narrows enabled plugins
	 * (disables more), "enable" narrows disabled plugins (enables more). */
	direction: "disable" | "enable";
	candidates: Set<string>;
	enabledUnderTest: Set<string>;
	culpritId: string | undefined;
	enabledBeforeBisect: Set<string> | undefined;
	awaitingInitialAnswer: boolean;
}

interface BypassState {
	enable: boolean;
	disable: boolean;
}

const pluginCommands: DACCommand[] = [
	{
		id: "plugin-enable-all",
		method: "enableAll",
		name: "Plugin Enable All - enable every installed plugin (including excluded)"
	},
	{
		id: "plugin-enable-all-except-excluded",
		method: "enableAllExceptExcluded",
		name: "Plugin Enable All Except Excluded - enable every installed plugin " +
			"respecting the exclusion list"
	},
	{
		id: "plugin-disable-all",
		method: "disableAll",
		name: "Plugin Disable All - disable every installed plugin (including excluded)"
	},
	{
		id: "plugin-disable-all-except-excluded",
		method: "disableAllExceptExcluded",
		name: "Plugin Disable All Except Excluded - disable every installed plugin " +
			"respecting the exclusion list"
	},
	{
		id: "plugin-start-bisect",
		method: "startBisect",
		name: "Plugin Bisect Start (Disable) - begin troubleshooting by disabling " +
			"half your plugins"
	},
	{
		id: "plugin-start-bisect-reverse",
		method: "startBisectReverse",
		name: "Plugin Bisect Start (Enable) - begin troubleshooting by enabling " +
			"half your disabled plugins"
	},
	{
		id: "plugin-answer-yes",
		method: "answerYes",
		name: "Plugin Bisect Yes - issue still happens with the currently enabled plugins"
	},
	{
		id: "plugin-answer-no",
		method: "answerNo",
		name: "Plugin Bisect No - issue does not happen with the currently enabled plugins"
	},
];

const snippetCommands: DACCommand[] = [
	{
		id: "snippet-enable-all",
		method: "enableAll",
		name: "Snippet Enable All - enable every installed CSS snippet (including excluded)"
	},
	{
		id: "snippet-enable-all-except-excluded",
		method: "enableAllExceptExcluded",
		name: "Snippet Enable All Except Excluded - enable every CSS snippet respecting " +
			"the exclusion list"
	},
	{
		id: "snippet-disable-all",
		method: "disableAll",
		name: "Snippet Disable All - disable every installed CSS snippet (including " +
			"excluded)"
	},
	{
		id: "snippet-disable-all-except-excluded",
		method: "disableAllExceptExcluded",
		name: "Snippet Disable All Except Excluded - disable every CSS snippet respecting " +
			"the exclusion list"
	},
	{
		id: "snippet-start-bisect",
		method: "startBisect",
		name: "Snippet Bisect Start (Disable) - begin troubleshooting by disabling " +
			"half your CSS snippets"
	},
	{
		id: "snippet-start-bisect-reverse",
		method: "startBisectReverse",
		name: "Snippet Bisect Start (Enable) - begin troubleshooting by enabling half " +
			"your disabled CSS snippets"
	},
	{
		id: "snippet-answer-yes",
		method: "answerYes",
		name: "Snippet Bisect Yes - issue still happens with the currently enabled CSS snippets"
	},
	{
		id: "snippet-answer-no",
		method: "answerNo",
		name: "Snippet Bisect No - issue does not happen with the currently enabled CSS snippets"
	},
];

const UIButtons: DACButton[] = [
	{id: "enableAllExceptExcluded", tooltip: "Enable All (except excluded)"},
	{id: "disableAllExceptExcluded", tooltip: "Disable All (except excluded)"},
	{id: "startBisect", tooltip: "Start (Disable)"},
	{id: "startBisectReverse", tooltip: "Start (Enable)"},
	{id: "answerYes", tooltip: "Issue still happens"},
	{id: "answerNo", tooltip: "Issue does not happen"},
];

const numberOfTextElements = 1;
const numberOfButtonsAndTextElements = UIButtons.length + numberOfTextElements;

export default class divideAndConquer extends Plugin {
	settings!: typeof DEFAULT_SETTINGS;
	manifests = this.app.plugins.manifests;
	private skipNextReload = false;
	enabledColor: string | null = null;
	disabledColor: string | null = null;
	getItemEls!: () => Element[];
	getAllItems!: () => Set<NameNID>;
	getEnabledFromObsidian!: () => Set<string>;
	enableItem!: (item: string) => Promise<unknown>;
	disableItem!: (item: string) => Promise<unknown>;
	getFilters!: () => string[];

	private _mode: Mode = "plugins";
	public get mode(): Mode {
		return this._mode;
	}

	private setMode(mode: Mode) {
		this._mode = mode;
	}

	mode2Call: Map<Mode, Composed> = new Map();
	mode2Refresh: Map<Mode, () => void> = new Map();
	mode2Tab: Map<Mode, SettingsTab> = new Map();
	mode2Controls: Map<Mode, HTMLElement[]> = new Map();
	mode2Session: Map<Mode, BisectSession> = new Map();
	private mode2Bypass: Map<Mode, BypassState> = new Map();

	get controls() {
		return this.mode2Controls.get(this.mode) ?? [];
	}

	get tab() {
		return this.mode2Tab.get(this.mode);
	}

	get refreshTab(): (() => void) | undefined {
		return this.mode2Refresh.get(this.mode);
	}

	set refreshTab(f: () => void) {
		this.mode2Refresh.set(this.mode, f);
	}

	override onunload(): void {
		this.saveData().catch(() => {
			throw new Error('Could not save data')
		})
	}

	override async onload() {
		await this.loadData();
		this.addSettingTab(new DACSettingsTab(this.app, this));

		const notice = () => {
			removeSetupDebugNotice();
			const session = this.getSession();
			if (!session.culpritId) {
				return;
			}
			const label = this.mode === "plugins" ? "plugin" : "CSS snippet";
			new Notice(`Possible ${label} culprit: ${this.getDisplayName(session.culpritId)}`);
		};

		const maybeReload = async () => {
			if (this.consumeReloadSkipToken()) {
				return;
			}
			if (!this.settings.reloadAfterPluginChanges) {
				return;
			}
			await this.saveData();
			window.setTimeout(() => this.app.commands.executeCommandById("app:reload"), 2000);
		};

		const maybeInit = async () => {
			if (!this.settings.initializeAfterPluginChanges) {
				return;
			}
			await this.app.plugins.initialize();
		};

		this.mode2Call = new Map(Modes.map(mode => [mode, (f: Func) => async () => compose(
			this,
			() => this.setMode(mode),
			f,
			() => this.mode2Refresh.get(this.mode)?.(),
			() => {
				// intended as the compose function is expecting functions that return void, and not Promise<void>
				(() => void maybeReload())()
			},
			() => {
				// todo if the previous step reloads, we don't need to continue here
				// intended as the compose function is expecting functions that return void, and not Promise<void>
				(() => void maybeInit())()
			},
			notice,
		).bind(this)()]));

		this.mode2Tab = new Map<Mode, SettingsTab>(([
			["plugins", "community-plugins"],
			["snippets", "appearance"],
		] as [Mode, string][]).map(([mode, id]) => [mode, this.getSettingsTab(id) as SettingsTab]));

		Object.assign(this.mode2Tab.get("plugins") as object, {
			heading: "Installed plugins",
			reloadLabel: "Reload plugins",
			reload: () => this.app.plugins.loadManifests(),
		});
		Object.assign(this.mode2Tab.get("snippets") as object, {
			heading: "CSS snippets",
			reloadLabel: "Reload snippets",
			reload: () => this.app.customCss.loadSnippets(),
		});

		for (const [mode, tab] of this.mode2Tab.entries()) {
			this.register(around(tab, {display: this.overrideDisplay.bind(this, mode, tab)}));
		}

		this.getItemEls = () => {
			switch (this.mode) {
				case "plugins": {
					const installedContainer = this.tab?.containerEl.find(".installed-plugins-container");
					return installedContainer ? makeArray(installedContainer.children) : [];
				}
				case "snippets":
					return getSnippetItems(this.tab as SettingsTab);
				default:
					throw new Error(`Unknown mode`);
			}
		};

		this.getAllItems = () => {
			switch (this.mode) {
				case "plugins":
					return new Set(Object.values(this.manifests));
				case "snippets":
					return new Set(this.app.customCss.snippets.map((s) => ({
						name: s,
						id: s
					})));
			}
		};

		this.getEnabledFromObsidian = () => {
			switch (this.mode) {
				case "plugins":
					return this.app.plugins.enabledPlugins;
				case "snippets":
					return new Set(
						this.app.customCss.snippets.filter((snippet) => this.app.customCss.enabledSnippets.has(snippet)),
					);
			}
		};

		this.enableItem = (id: string) => {
			switch (this.mode) {
				case "plugins":
					return this.app.plugins.enablePluginAndSave(id);
				case "snippets":
					return new Promise((resolve) => {
						this.app.customCss.setCssEnabledStatus(id, true);
						window.setTimeout(() => resolve({}), CSS_DELAY);
					});
			}
		};

		this.disableItem = (id: string) => {
			switch (this.mode) {
				case "plugins":
					return this.app.plugins.disablePluginAndSave(id);
				case "snippets":
					return new Promise((resolve) => {
						this.app.customCss.setCssEnabledStatus(id, false);
						window.setTimeout(() => resolve({}), CSS_DELAY);
					});
			}
		};

		this.getFilters = () => {
			switch (this.mode) {
				case "plugins":
					return this.settings.pluginFilterRegexes;
				case "snippets":
					return this.settings.snippetFilterRegexes;
			}
		};

		this.addCommands();
		this.app.workspace.onLayoutReady(() => {
			const appContainer = activeDocument.getElementsByClassName("app-container").item(0) as HTMLDivElement;
			this.enabledColor ??= tinycolor(simpleCalc(appContainer.getCssPropertyValue("--checkbox-color"))).spin(180).toHexString();
			this.disabledColor ??= tinycolor(this.enabledColor).darken(35).toHexString();
		});
	}

	public override async loadData() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, super.loadData());
		this.settings.bisectSessions ??= {};
	}

	public override async saveData() {
		await super.saveData(this.settings);
	}

	private addControls() {
		const container = this.getControlContainer();
		if (!container) {
			return;
		}

		if (!this.mode2Controls.has(this.mode)) {
			const buttons = UIButtons.map((button) => {
				const el = activeDocument.createElement("button");
				el.type = "button";
				el.classList.add("mod-cta");
				el.ariaLabel = button.tooltip;
				el.setText(this.getButtonLabel(button.id));
				el.onclick = () => this.wrapCall(this.mode, button.id)?.();
				return el;
			});
			this.mode2Controls.set(this.mode, [...buttons, this.createStatusText()]);
		}

		this.updateControlState();
		for (const control of this.controls) {
			container.appendChild(control);
		}
	}

	private addCommands() {
		for (const command of pluginCommands) {
			const callback = this.mode2Call.get("plugins")?.(this[command.method] as Func);
			if (!callback) {
				continue;
			}
			this.addCommand({
				id: command.id,
				name: command.name,
				callback,
			});
		}
		for (const command of snippetCommands) {
			const callback = this.mode2Call.get("snippets")?.(this[command.method] as Func);
			if (!callback) {
				continue;
			}
			this.addCommand({
				id: command.id,
				name: command.name,
				callback,
			});
		}
	}

	public async enableAll() {
		const allItems = this.getAllSortedItems();
		await this.enableItems(allItems.map(item => item.id));
		this.clearSession(this.getSession());
		await this.persistSession();
	}

	public async enableAllExceptExcluded() {
		const included = this.getIncludedSortedItems();
		await this.enableItems(included.map(item => item.id));
		this.clearSession(this.getSession());
		await this.persistSession();
	}

	public async disableAll() {
		const allItems = this.getAllSortedItems();
		await this.disableItems(allItems.map(item => item.id));
		this.clearSession(this.getSession());
		await this.persistSession();
	}

	public async disableAllExceptExcluded() {
		const included = this.getIncludedSortedItems();
		await this.disableItems(included.map(item => item.id));
		this.clearSession(this.getSession());
		await this.persistSession();
	}

	public async resetBisect() {
		const session = this.getSession();
		const enabledBeforeBisect = session.enabledBeforeBisect;

		if (enabledBeforeBisect) {
			const allIds = this.getAllSortedItems().map(item => item.id);
			const toEnable = allIds.filter(id => enabledBeforeBisect.has(id));
			const toDisable = allIds.filter(id => !enabledBeforeBisect.has(id));
			await this.enableItems(toEnable);
			await this.disableItems(toDisable);
		}

		this.clearSession(session);
		await this.persistSession();
	}

	public async startBisect() {
		const candidates = this.getIncludedSortedItems();
		if (candidates.length < 1) {
			new Notice(`No ${this.getPluralLabel()} available for bisect.`);
			return;
		}

		const session = this.getSession();
		session.isRunning = true;
		session.direction = "disable";
		session.culpritId = undefined;
		session.enabledBeforeBisect = new Set(this.getEnabledFromObsidian());
		session.candidates = new Set(candidates.map(item => item.id));
		session.enabledUnderTest = new Set(
			[...session.candidates].filter(id => session.enabledBeforeBisect?.has(id)),
		);
		session.awaitingInitialAnswer = true;
		this.resetBypassFlags(this.mode);
		// Starting bisect from settings should not immediately reload Obsidian.
		this.skipNextReload = true;
		await this.persistSession();
	}

	public async startBisectReverse() {
		const includedItems = this.getIncludedSortedItems();
		const disabledCandidates = includedItems.filter(item => !this.getEnabledFromObsidian().has(item.id));

		if (disabledCandidates.length < 1) {
			new Notice(`No disabled ${this.getPluralLabel()} available for reverse bisect.`);
			return;
		}

		const session = this.getSession();
		session.isRunning = true;
		session.direction = "enable";
		session.culpritId = undefined;
		session.enabledBeforeBisect = new Set(this.getEnabledFromObsidian());
		session.candidates = new Set(disabledCandidates.map(item => item.id));
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));
		session.awaitingInitialAnswer = false;
		this.resetBypassFlags(this.mode);
		this.skipNextReload = true;
		await this.applyTestState(session.candidates, session.enabledUnderTest);
		await this.persistSession();
	}

	public async answerYes() {
		const session = this.getSession();
		if (!session.isRunning) {
			new Notice("Start bisect before answering.");
			return;
		}

		if (session.awaitingInitialAnswer) {
			session.awaitingInitialAnswer = false;
			if (session.enabledUnderTest.size < 1) {
				new Notice(`No enabled ${this.getPluralLabel()} to test.`);
				await this.persistSession();
				return;
			}
		}

		if (session.enabledUnderTest.size === 1) {
			session.culpritId = [...session.enabledUnderTest][0];
			session.isRunning = false;
			await this.persistSession();
			return;
		}

		session.candidates = new Set(session.enabledUnderTest);
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));
		await this.applyTestState(session.candidates, session.enabledUnderTest);
		await this.persistSession();
	}

	public async answerNo() {
		const session = this.getSession();
		if (!session.isRunning) {
			new Notice("Start bisect before answering.");
			return;
		}
		session.awaitingInitialAnswer = false;

		const previousCandidates = new Set(session.candidates);
		const remainingCandidates = [...session.candidates].filter(id => !session.enabledUnderTest.has(id));
		if (remainingCandidates.length < 1) {
			this.clearSession(session);
			await this.persistSession();
			new Notice("No alternate group left to test. Bisect stopped.");
			return;
		}

		if (remainingCandidates.length === 1) {
			session.candidates = new Set(remainingCandidates);
			session.enabledUnderTest = new Set(remainingCandidates);
			session.culpritId = remainingCandidates[0];
			session.isRunning = false;
			await this.applyTestState(previousCandidates, session.enabledUnderTest);
			await this.persistSession();
			return;
		}

		session.candidates = new Set(remainingCandidates);
		session.enabledUnderTest = new Set(this.takeFirstHalf(remainingCandidates));
		await this.applyTestState(previousCandidates, session.enabledUnderTest);
		await this.persistSession();
	}

	public getEnabledDisabled() {
		const excluded = [...this.getExcludedItems()];
		const included = [...this.getAllItems()]
			.filter(item => !excluded.some(i => i.id === item.id))
			.sort((a, b) => b.name.localeCompare(a.name))
			.map((item) => item.id);

		return {
			enabled: included.filter(id => this.getEnabledFromObsidian().has(id)),
			disabled: included.filter(id => !this.getEnabledFromObsidian().has(id)),
		};
	}

	public getIncludedItems(mode?: Mode) {
		return this.getExcludedItems(mode, true);
	}

	public getExcludedItems(mode?: Mode, outIncluded: boolean = false) {
		const oldMode = this.mode;
		if (mode) {
			this.setMode(mode);
		}

		const filtered = [...this.getAllItems()].filter(
			(item) => outIncluded !== this.getFilters().some(
				(filter) => item.id.match(new RegExp(filter, "i"))
					|| (this.settings.filterUsingDisplayName && item.name.match(new RegExp(filter, "i")))
					|| (this.settings.filterUsingAuthor && item.author?.match(new RegExp(filter, "i")))
					|| (this.settings.filterUsingDescription && item.description?.match(new RegExp(filter, "i"))),
			),
		);

		if (mode) {
			this.setMode(oldMode);
		}
		return new Set(filtered);
	}

	async enableItems(items: string[] | Set<string>) {
		const list = [...items];
		for (const id of list.reverse()) {
			await this.enableItem(id);
		}
		return list;
	}

	async disableItems(items: string[] | Set<string>) {
		const list = [...items].filter(id => !PROTECTED_IDS.has(id));
		for (const id of list) {
			await this.disableItem(id);
		}
		return list;
	}

	private getSession() {
		if (!this.mode2Session.has(this.mode)) {
			const session = this.deserializeSession(this.settings.bisectSessions?.[this.mode]);
			this.mode2Session.set(this.mode, session);
		}
		return this.mode2Session.get(this.mode) as BisectSession;
	}

	private emptySession(): BisectSession {
		return {
			isRunning: false,
			direction: "disable",
			candidates: new Set<string>(),
			enabledUnderTest: new Set<string>(),
			culpritId: undefined,
			enabledBeforeBisect: undefined,
			awaitingInitialAnswer: false,
		};
	}

	private deserializeSession(session?: PersistedBisectSession): BisectSession {
		// Legacy sessions without an explicit direction field are discarded rather than guessing intent.
		if (!session || !session.direction) {
			return this.emptySession();
		}

		return {
			isRunning: session.isRunning,
			direction: session.direction,
			candidates: new Set(session.candidates ?? []),
			enabledUnderTest: new Set(session.enabledUnderTest ?? []),
			culpritId: session.culpritId,
			enabledBeforeBisect: session.enabledBeforeBisect ? new Set(session.enabledBeforeBisect) : undefined,
			awaitingInitialAnswer: session.awaitingInitialAnswer,
		};
	}

	private serializeSession(session: BisectSession): PersistedBisectSession {
		return {
			isRunning: session.isRunning,
			direction: session.direction,
			candidates: [...session.candidates],
			enabledUnderTest: [...session.enabledUnderTest],
			culpritId: session.culpritId,
			enabledBeforeBisect: session.enabledBeforeBisect ? [...session.enabledBeforeBisect] : undefined,
			awaitingInitialAnswer: session.awaitingInitialAnswer,
		};
	}

	private isSessionEmpty(session: BisectSession) {
		return !session.isRunning
			&& session.candidates.size < 1
			&& session.enabledUnderTest.size < 1
			&& !session.culpritId
			&& !session.enabledBeforeBisect
			&& !session.awaitingInitialAnswer;
	}

	private async persistSession(mode: Mode = this.mode) {
		const session = this.mode2Session.get(mode);
		if (!session) {
			return;
		}

		const persisted = {...(this.settings.bisectSessions ?? {})};
		if (this.isSessionEmpty(session)) {
			delete persisted[mode];
		} else {
			persisted[mode] = this.serializeSession(session);
		}
		this.settings.bisectSessions = persisted;
		await this.saveData();
	}

	private clearSession(session: BisectSession) {
		session.isRunning = false;
		session.direction = "disable";
		session.candidates = new Set();
		session.enabledUnderTest = new Set();
		session.culpritId = undefined;
		session.enabledBeforeBisect = undefined;
		session.awaitingInitialAnswer = false;
	}

	private getBypassState(mode: Mode): BypassState {
		if (!this.mode2Bypass.has(mode)) {
			this.mode2Bypass.set(mode, {enable: false, disable: false});
		}
		return this.mode2Bypass.get(mode)!;
	}

	private resetBypassFlags(mode: Mode) {
		this.mode2Bypass.set(mode, {enable: false, disable: false});
	}

	private handleManualItemToggle(mode: Mode) {
		const bypass = this.getBypassState(mode);
		if (!bypass.enable && !bypass.disable) {
			return;
		}
		this.resetBypassFlags(mode);
		this.updateControlState();
	}

	private consumeReloadSkipToken() {
		if (!this.skipNextReload) {
			return false;
		}
		this.skipNextReload = false;
		return true;
	}

	private getPluralLabel() {
		return this.mode === "plugins" ? "plugins" : "CSS snippets";
	}

	private getSingularLabel() {
		return this.mode === "plugins" ? "plugin" : "CSS snippet";
	}

	private getIncludedSortedItems() {
		return [...this.getIncludedItems()].sort((a, b) => b.name.localeCompare(a.name));
	}

	private getAllSortedItems() {
		return [...this.getAllItems()].sort((a, b) => b.name.localeCompare(a.name));
	}

	private takeFirstHalf(ids: string[]) {
		return ids.slice(0, Math.ceil(ids.length / 2));
	}

	private async applyTestState(candidates: Set<string>, enabledUnderTest: Set<string>) {
		await this.enableItems(enabledUnderTest);
		const toDisable = [...candidates].filter(id => !enabledUnderTest.has(id));
		await this.disableItems(toDisable);
	}

	private getDisplayName(id: string) {
		return this.getAllSortedItems().find(item => item.id === id)?.name ?? id;
	}

	getControlContainer(tab?: SettingsTab) {
		const currentTab = tab ?? this.tab;
		if (!currentTab) {
			return undefined;
		}
		const heading = queryText(currentTab.containerEl, ".setting-item-heading", currentTab.heading);
		return heading?.querySelector(".setting-item-control") as HTMLElement | undefined;
	}

	getSettingsTab(id: string) {
		return this.app.setting.settingTabs.filter(t => t.id === id).shift() as Partial<SettingsTab>;
	}

	private createStatusText() {
		const span = activeDocument.createElement("span");
		span.className = "setting-item-name"
		return span;
	}

	private getButtonLabel(id: keyof divideAndConquer) {
		const bypass = this.getBypassState(this.mode);
		switch (id) {
			case "enableAllExceptExcluded":
				if (this.getSession().isRunning) return "Reset";
				return bypass.enable ? "Enable All" : "Enable All (except excluded)";
			case "disableAllExceptExcluded":
				return bypass.disable ? "Disable All" : "Disable All (except excluded)";
			case "startBisect":
				return "Start (Disable)";
			case "startBisectReverse":
				return "Start (Enable)";
			case "answerYes":
				return "Yes";
			case "answerNo":
				return "No";
			default:
				return String(id);
		}
	}

	private getButtonAction(id: keyof divideAndConquer): keyof divideAndConquer {
		if (id === "enableAllExceptExcluded") {
			if (this.getSession().isRunning) {
				return "resetBisect";
			}
			const bypass = this.getBypassState(this.mode);
			// Clicking any enable state resets disable state back to "(except excluded)".
			bypass.disable = false;
			const buttonText = this.controls[0]?.textContent?.trim();
			const isPlainEnable = buttonText ? buttonText === "Enable All" : bypass.enable;
			if (bypass.enable && isPlainEnable) {
				bypass.enable = false;
				this.updateControlState();
				return "enableAll";
			}
			bypass.enable = true;
			this.updateControlState();
			return "enableAllExceptExcluded";
		}
		if (id === "disableAllExceptExcluded") {
			const bypass = this.getBypassState(this.mode);
			// Clicking any disable state resets enable state back to "(except excluded)".
			bypass.enable = false;
			const buttonText = this.controls[1]?.textContent?.trim();
			const isPlainDisable = buttonText ? buttonText === "Disable All" : bypass.disable;
			if (bypass.disable && isPlainDisable) {
				bypass.disable = false;
				this.updateControlState();
				return "disableAll";
			}
			bypass.disable = true;
			this.updateControlState();
			return "disableAllExceptExcluded";
		}
		return id;
	}

	private updateControlState() {
		const controls = this.controls;
		if (controls.length !== numberOfButtonsAndTextElements) {
			return;
		}
		const [enableAllBtn, disableAllBtn, startBtn, startReverseBtn, yes, no, text] = controls;

		const session = this.getSession();
		enableAllBtn.setText(this.getButtonLabel("enableAllExceptExcluded"));
		enableAllBtn.ariaLabel = session.isRunning
			? "Reset bisect and restore previous states"
			: "Enable all items";

		disableAllBtn.setText(this.getButtonLabel("disableAllExceptExcluded"));
		disableAllBtn.ariaLabel = "Disable all items";
		disableAllBtn.style.display = session.isRunning ? "none" : "";

		startBtn.style.display = session.isRunning ? "none" : "";
		startReverseBtn.style.display = session.isRunning ? "none" : "";
		yes.style.display = session.isRunning ? "" : "none";
		no.style.display = session.isRunning ? "" : "none";

		if (session.culpritId) {
			text.setText(`The ${this.getSingularLabel()} possibly causing issues is: ${this.getDisplayName(session.culpritId)}`);
			return;
		}
		if (!session.isRunning) {
			text.setText(`Click Start (Disable) or Start (Enable) to begin bisecting ${this.getPluralLabel()}.`);
			return;
		}
		if (session.awaitingInitialAnswer) {
			text.setText(`No changes yet. With your current ${this.getPluralLabel()} state, are you still having issues?`);
			return;
		}

		text.setText(`The ${this.getPluralLabel()} below are enabled. Are you still having issues?`);
	}

	private overrideDisplay(mode: Mode, tab: SettingsTab, old: (...args: unknown[]) => void) {
		return (...args: unknown[]) => {
			const refresh = async () => {
				this.setMode(mode);
				await tab.reload();
				old.apply(tab, args);
				this.addControls();
				this.colorizeIgnoredToggles();
				this.attachContainerToggleListener(mode, tab);
			};

			this.refreshTab = () => {
				void refresh();
			};

			void refresh();
		};
	}

	/**
	 * Attach a single delegated click listener on the tab container so that clicking ANY
	 * plugin/snippet toggle resets the two-click bypass state on the bulk-toggle buttons.
	 * Using delegation means the listener survives tab re-renders — we only need to attach
	 * it once per tab (guarded by a data attribute on the container element).
	 */
	private attachContainerToggleListener(mode: Mode, tab: SettingsTab) {
		const container = tab.containerEl;
		if (!container || container.dataset.dacToggleListenerAttached === "true") {
			return;
		}
		container.dataset.dacToggleListenerAttached = "true";
		container.addEventListener("click", (e: Event) => {
			const target = e.target as HTMLElement;
			if (target?.closest(".checkbox-container")) {
				this.handleManualItemToggle(mode);
			}
		});
	}

	private colorizeIgnoredToggles() {
		const name2Toggle = this.createToggleMap(this.getItemEls());
		const included = new Set([...(this.getIncludedItems())].map(m => m.name));

		for (const [name, toggle] of name2Toggle) {
			if (!included.has(name)) {
				const colorToggle = () => {
					if (toggle.classList.contains("is-enabled")) {
						toggle.style.backgroundColor = this.enabledColor ?? "";
					} else {
						toggle.style.backgroundColor = this.disabledColor ?? "";
					}
				};
				colorToggle();
				toggle.addEventListener("click", colorToggle);
			}
		}
	}

	private createToggleMap(items: Element[]) {
		const name2Toggle = new Map<string, HTMLDivElement>();
		for (let i = 0; i < items.length; i++) {
			const child = items[i];
			const name = (child.querySelector(".setting-item-name") as HTMLDivElement)?.innerText;
			const toggle = child.querySelector(".setting-item-control")?.querySelector(".checkbox-container") as HTMLDivElement;
			if (name && toggle) {
				name2Toggle.set(name, toggle);
			}
		}
		return name2Toggle;
	}

	private wrapCall(mode: Mode, key: keyof divideAndConquer) {
		return this.mode2Call.get(mode)?.(this[this.getButtonAction(key)] as Func);
	}
}
