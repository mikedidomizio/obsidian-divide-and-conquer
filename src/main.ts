import { Command, Notice, Plugin, SettingsTab } from "obsidian";
import type { Composed, Func, Mode } from "./util";
import { DACSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { Modes, compose, getSnippetItems, makeArray, queryText, removeSetupDebugNotice, simpleCalc } from "./util";
import { around } from "monkey-around";

const tinycolor = require("tinycolor2");

const CSS_DELAY = 200;

interface DACCommand { id: keyof divideAndConquer; name: string; }
interface DACButton { id: keyof divideAndConquer; tooltip: string; }
interface NameNID {
	name: string;
	id: string;
	author?: string;
	description?: string;
}

interface BisectSession {
	isRunning: boolean;
	hasStarted: boolean;
	startingEnabled: Set<string>;
	candidates: Set<string>;
	enabledUnderTest: Set<string>;
	culpritId: string | undefined;
}

interface SerializedBisectSession {
	isRunning: boolean;
	hasStarted: boolean;
	startingEnabled: string[];
	candidates: string[];
	enabledUnderTest: string[];
	culpritId: string | undefined;
}

const pluginCommands: DACCommand[] = [
	{ id: "enableAll", name: "Plugin Enable All - enable every installed plugin" },
	{ id: "startBisect", name: "Plugin Bisect Start - begin troubleshooting by splitting plugins in half" },
	{ id: "answerYes", name: "Plugin Bisect Yes - issue still happens with the currently enabled plugins" },
	{ id: "answerNo", name: "Plugin Bisect No - issue does not happen with the currently enabled plugins" },
];

const snippetCommands: DACCommand[] = [
	{ id: "enableAll", name: "Snippet Enable All - enable every installed CSS snippet" },
	{ id: "startBisect", name: "Snippet Bisect Start - begin troubleshooting by splitting CSS snippets in half" },
	{ id: "answerYes", name: "Snippet Bisect Yes - issue still happens with the currently enabled CSS snippets" },
	{ id: "answerNo", name: "Snippet Bisect No - issue does not happen with the currently enabled CSS snippets" },
];

const UIButtons: DACButton[] = [
	{ id: "enableAll", tooltip: "Enable all items" },
	{ id: "startOver", tooltip: "Start over" },
	{ id: "startBisect", tooltip: "Start bisect" },
	{ id: "answerYes", tooltip: "Issue still happens" },
	{ id: "answerNo", tooltip: "Issue does not happen" },
];

export default class divideAndConquer extends Plugin {
	settings!: typeof DEFAULT_SETTINGS;
	manifests = this.app.plugins.manifests;
	enabledColor: string | null = null;
	disabledColor: string | null = null;
	getItemEls!: () => Element[];
	getAllItems!: () => Set<NameNID>;
	getEnabledFromObsidian!: () => Set<string>;
	enableItem!: (item: string) => Promise<unknown>;
	disableItem!: (item: string) => Promise<unknown>;
	getFilters!: () => string[];

	private _mode: Mode = "plugins";
	public get mode(): Mode { return this._mode; }
	private setMode(mode: Mode) { this._mode = mode; }

	mode2Call: Map<Mode, Composed> = new Map();
	mode2Refresh: Map<Mode, () => void> = new Map();
	mode2Tab: Map<Mode, SettingsTab> = new Map();
	mode2Controls: Map<Mode, HTMLElement[]> = new Map();
	mode2Session: Map<Mode, BisectSession> = new Map();

	get controls() { return this.mode2Controls.get(this.mode) ?? []; }
	set controls(c) { this.mode2Controls.set(this.mode, c ?? []); }
	get tab() { return this.mode2Tab.get(this.mode); }
	get wrapper() { return this.mode2Call.get(this.mode); }
	get refreshTab(): (() => void) | undefined { return this.mode2Refresh.get(this.mode); }
	set refreshTab(f: () => void) { this.mode2Refresh.set(this.mode, f); }

	override async onunload() {
		await this.saveData();
	}

	override async onload() {
		await this.loadData();
		this.addSettingTab(new DACSettingsTab(this.app, this));

		const notice = () => {
			removeSetupDebugNotice();
			const session = this.getSession();
			if (!session.culpritId) return;
			const label = this.mode === "plugins" ? "plugin" : "CSS snippet";
			new Notice(`Possible ${label} culprit: ${this.getDisplayName(session.culpritId)}`);
		};

		const maybeReload = async () => {
			if (!this.settings.reloadAfterPluginChanges) return;
			await this.saveData();
			setTimeout(() => this.app.commands.executeCommandById("app:reload"), 2000);
		};

		const maybeInit = async () => {
			if (!this.settings.initializeAfterPluginChanges) return;
			await this.app.plugins.initialize();
		};

		this.mode2Call = new Map(Modes.map(mode => [mode, (f: Func) => async () => compose(
			this,
			() => this.setMode(mode),
			f,
			() => this.mode2Refresh.get(this.mode)?.(),
			maybeReload,
			maybeInit,
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
			this.register(around(tab, { display: this.overrideDisplay.bind(this, mode, tab) }));
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
					throw new Error("Unknown mode: " + this.mode);
			}
		};

		this.getAllItems = () => {
			switch (this.mode) {
				case "plugins":
					return new Set(Object.values(this.manifests));
				case "snippets":
					return new Set(this.app.customCss.snippets.map((s) => ({ name: s, id: s })));
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
						setTimeout(() => resolve({}), CSS_DELAY);
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
						setTimeout(() => resolve({}), CSS_DELAY);
					});
			}
		};

		this.getFilters = () => {
			switch (this.mode) {
				case "plugins": return this.settings.pluginFilterRegexes;
				case "snippets": return this.settings.snippetFilterRegexes;
			}
		};

		this.addCommands();
		this.app.workspace.onLayoutReady(() => {
			const appContainer = document.getElementsByClassName("app-container").item(0) as HTMLDivElement;
			this.enabledColor ??= tinycolor(simpleCalc(appContainer.getCssPropertyValue("--checkbox-color"))).spin(180).toHexString();
			this.disabledColor ??= tinycolor(this.enabledColor).darken(35).toHexString();
		});
	}

	public override async loadData() {
		const raw = (await super.loadData()) ?? {};
		const { bisectSessions, ...settingsData } = raw;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
		if (bisectSessions) {
			for (const [mode, s] of Object.entries(bisectSessions) as [Mode, SerializedBisectSession][]) {
				this.mode2Session.set(mode, {
					isRunning: s.isRunning ?? false,
					hasStarted: s.hasStarted ?? false,
					startingEnabled: new Set(s.startingEnabled ?? []),
					candidates: new Set(s.candidates ?? []),
					enabledUnderTest: new Set(s.enabledUnderTest ?? []),
					culpritId: s.culpritId,
				});
			}
		}
	}

	public override async saveData() {
		const bisectSessions: Record<string, SerializedBisectSession> = {};
		for (const [mode, session] of this.mode2Session.entries()) {
			bisectSessions[mode] = {
				isRunning: session.isRunning,
				hasStarted: session.hasStarted,
				startingEnabled: [...session.startingEnabled],
				candidates: [...session.candidates],
				enabledUnderTest: [...session.enabledUnderTest],
				culpritId: session.culpritId,
			};
		}
		await super.saveData({ ...this.settings, bisectSessions });
	}

	private addControls() {
		const container = this.getControlContainer();
		if (!container) return;

		if (!this.mode2Controls.has(this.mode)) {
			const buttons = UIButtons.map((button) => {
				const el = document.createElement("button");
				el.type = "button";
				el.classList.add("mod-cta");
				el.style.marginLeft = "8px";
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
		type PC = Partial<Command>;
		for (const command of pluginCommands) {
			this.addCommand(Object.assign(command, { callback: this.mode2Call.get("plugins")?.(this[command.id] as Func) } as PC));
		}
		for (const command of snippetCommands) {
			this.addCommand(Object.assign(command, { callback: this.mode2Call.get("snippets")?.(this[command.id] as Func) } as PC));
		}
	}

	public async enableAll() {
		const allItems = this.getAllSortedItems();
		await this.enableItems(allItems.map(item => item.id));
		const session = this.getSession();
		session.isRunning = false;
		session.hasStarted = false;
		session.startingEnabled = new Set();
		session.candidates = new Set();
		session.enabledUnderTest = new Set();
		session.culpritId = undefined;
	}

	public async startBisect() {
		const candidates = this.getIncludedSortedItems();
		if (candidates.length < 1) {
			new Notice(`No ${this.getPluralLabel()} available for bisect.`);
			return;
		}

		const session = this.getSession();
		if (!session.hasStarted) {
			session.hasStarted = true;
			session.startingEnabled = new Set(this.getEnabledFromObsidian());
		}
		session.isRunning = true;
		session.culpritId = undefined;
		session.candidates = new Set(candidates.map(item => item.id));
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));

		if (session.enabledUnderTest.size < 1) {
			session.enabledUnderTest = new Set([...session.candidates]);
		}
	}

	public async answerYes() {
		const session = this.getSession();
		if (!session.isRunning) {
			new Notice("Start bisect before answering.");
			return;
		}

		if (session.enabledUnderTest.size === 1) {
			session.culpritId = [...session.enabledUnderTest][0];
			session.isRunning = false;
			return;
		}

		session.candidates = new Set(session.enabledUnderTest);
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));
		await this.applyTestState(session.candidates, session.enabledUnderTest);
	}

	public async answerNo() {
		const session = this.getSession();
		if (!session.isRunning) {
			new Notice("Start bisect before answering.");
			return;
		}

		const previousCandidates = new Set(session.candidates);
		const remainingCandidates = [...session.candidates].filter(id => !session.enabledUnderTest.has(id));
		if (remainingCandidates.length < 1) {
			new Notice("No alternate group left to test.");
			return;
		}

		if (remainingCandidates.length === 1) {
			session.candidates = new Set(remainingCandidates);
			session.enabledUnderTest = new Set(remainingCandidates);
			session.culpritId = remainingCandidates[0];
			session.isRunning = false;
			await this.applyTestState(previousCandidates, session.enabledUnderTest);
			return;
		}

		session.candidates = new Set(remainingCandidates);
		session.enabledUnderTest = new Set(this.takeFirstHalf(remainingCandidates));
		await this.applyTestState(previousCandidates, session.enabledUnderTest);
	}

	public async startOver() {
		const session = this.getSession();
		const toRestore = new Set(session.startingEnabled);

		session.isRunning = false;
		session.hasStarted = false;
		session.startingEnabled = new Set();
		session.candidates = new Set();
		session.enabledUnderTest = new Set();
		session.culpritId = undefined;

		const allItems = this.getIncludedSortedItems();
		for (const item of allItems) {
			if (toRestore.has(item.id)) {
				await this.enableItem(item.id);
			} else {
				await this.disableItem(item.id);
			}
		}
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
		if (mode) this.setMode(mode);

		const filtered = [...this.getAllItems()].filter(
			(item) => outIncluded !== this.getFilters().some(
				(filter) => item.id.match(new RegExp(filter, "i"))
					|| (this.settings.filterUsingDisplayName && item.name.match(new RegExp(filter, "i")))
					|| (this.settings.filterUsingAuthor && item.author?.match(new RegExp(filter, "i")))
					|| (this.settings.filterUsingDescription && item.description?.match(new RegExp(filter, "i"))),
			),
		);

		if (mode) this.setMode(oldMode);
		return new Set(filtered);
	}

	async enableItems(items: string[] | Set<string>) {
		const list = items instanceof Set ? [...items] : [...items];
		for (const id of list.reverse()) {
			await this.enableItem(id);
		}
		return list;
	}

	async disableItems(items: string[] | Set<string>) {
		const list = items instanceof Set ? [...items] : [...items];
		for (const id of list) {
			await this.disableItem(id);
		}
		return list;
	}

	private getSession() {
		if (!this.mode2Session.has(this.mode)) {
			const session: BisectSession = {
				isRunning: false,
				hasStarted: false,
				startingEnabled: new Set<string>(),
				candidates: new Set<string>(),
				enabledUnderTest: new Set<string>(),
				culpritId: undefined,
			};
			this.mode2Session.set(this.mode, session);
		}
		return this.mode2Session.get(this.mode) as BisectSession;
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
		if (!currentTab) return undefined;
		const heading = queryText(currentTab.containerEl, ".setting-item-heading", currentTab.heading);
		return heading?.querySelector(".setting-item-control") as HTMLElement | undefined;
	}

	getSettingsTab(id: string) {
		return this.app.setting.settingTabs.filter(t => t.id === id).shift() as Partial<SettingsTab>;
	}

	private createStatusText() {
		const span = document.createElement("span");
		span.style.whiteSpace = "pre-line";
		span.style.marginLeft = "12px";
		return span;
	}

	private getButtonLabel(id: keyof divideAndConquer) {
		switch (id) {
			case "enableAll": return "Enable All";
			case "startOver": return "Reset";
			case "startBisect": return "Start";
			case "answerYes": return "Yes";
			case "answerNo": return "No";
			default: return String(id);
		}
	}

	private updateControlState() {
		const controls = this.controls;
		if (controls.length !== 6) return;

		const enableAll = controls[0] as HTMLButtonElement;
		const startOver = controls[1] as HTMLButtonElement;
		const start = controls[2] as HTMLButtonElement;
		const yes = controls[3] as HTMLButtonElement;
		const no = controls[4] as HTMLButtonElement;
		const text = controls[5] as HTMLSpanElement;

		const session = this.getSession();
		const { isRunning, hasStarted } = session;

		enableAll.style.display = hasStarted ? "none" : "";
		startOver.style.display = hasStarted ? "" : "none";
		start.style.display = (isRunning || hasStarted) ? "none" : "";
		yes.style.display = isRunning ? "" : "none";
		no.style.display = isRunning ? "" : "none";

		if (session.culpritId) {
			text.setText(`The ${this.getSingularLabel()} possibly causing issues is: ${this.getDisplayName(session.culpritId)}`);
			return;
		}
		if (!isRunning) {
			text.setText(hasStarted
				? `Click Start Over to restore your original ${this.getPluralLabel()} state.`
				: `Click Start to begin bisecting ${this.getPluralLabel()}.`);
			return;
		}

		text.setText(`The ${this.getPluralLabel()} below are enabled. Are you still having issues?`);
	}

	private overrideDisplay(mode: Mode, tab: SettingsTab, old: (...args: unknown[]) => void) {
		const plugin = this;
		return (function display(...args: unknown[]) {
			plugin.setMode(mode);
			plugin.refreshTab = () => {
				plugin.setMode(mode);
				tab.reload().then(() => {
					old.apply(tab, args);
					plugin.addControls();
					plugin.colorizeIgnoredToggles();
				});
			};
			plugin.refreshTab?.();
		}).bind(plugin, tab);
	}

	private colorizeIgnoredToggles() {
		const name2Toggle = this.createToggleMap(this.getItemEls());
		const included = new Set([...(this.getIncludedItems())].map(m => m.name));

		for (const [name, toggle] of name2Toggle) {
			if (!included.has(name)) {
				const colorToggle = () => {
					if (toggle.classList.contains("is-enabled")) toggle.style.backgroundColor = this.enabledColor ?? "";
					else toggle.style.backgroundColor = this.disabledColor ?? "";
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
			if (name && toggle) name2Toggle.set(name, toggle);
		}
		return name2Toggle;
	}

	private wrapCall(mode: Mode, key: keyof divideAndConquer) {
		return this.mode2Call.get(mode)?.(this[key] as Func);
	}
}
