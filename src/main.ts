import {Notice, Plugin, SettingsSubPage, SettingsTab} from "obsidian";
import type {Composed, Func, Mode} from "./util";
import {
	DACSettings,
	DACSettingsTab,
	DEFAULT_SETTINGS,
	type PersistedBisectSession
} from "./settings";
import {
	Modes,
	compose,
	queryText,
	removeSetupDebugNotice
} from "./util";
import {around} from "monkey-around";

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

type BulkToggleModeState = "enable" | "disable" | null;

interface BisectSession {
	isRunning: boolean;
	/** Which direction the bisect is running: "disable" narrows enabled plugins
	 * (disables more), "enable" narrows disabled plugins (enables more). */
	direction: BulkToggleModeState;
	candidates: Set<string>;
	enabledUnderTest: Set<string>;
	culpritId: string | undefined;
	enabledBeforeBisect: Set<string> | undefined;
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
	{id: "enableAll", tooltip: "Enable All"},
	{id: "disableAllExceptExcluded", tooltip: "Disable All (except excluded)"},
	{id: "disableAll", tooltip: "Disable All"},
	{id: "startBisect", tooltip: "Start bisect (disable half)"},
	{id: "startBisectReverse", tooltip: "Start bisect (enable half)"},
	{id: "resetBisect", tooltip: "Reset bisect and restore previous states"},
	{id: "answerYes", tooltip: "Issue still happens"},
	{id: "answerNo", tooltip: "Issue does not happen"},
];

const numberOfTextElements = 1;
const numberOfButtonsAndTextElements = UIButtons.length + numberOfTextElements;

/**
 * Where our controls go on a page, and how they get there. Obsidian gives us three shapes of
 * page to attach to; resolve that once rather than branching at every step.
 */
type ControlsHost = {
	/** What we insert into, and so the only place a stale copy can be hiding. */
	root: HTMLElement;
	place: (controls: HTMLElement) => void;
};

export default class divideAndConquer extends Plugin {
	declare settings: typeof DEFAULT_SETTINGS;
	manifests = this.app.plugins.manifests;
	/** Skips the next reload/reinitialize, once. */
	private skipNextReload = false;
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
	private mode2BulkToggleMode: Map<Mode, BulkToggleModeState> = new Map();

	/** Undoes our wrapper on the settings sub-page the user currently has open, if any. */
	private uninstallSubPageHook: (() => void) | null = null;

	/** Modes we have already complained about, so a re-render does not spam the console. */
	private warnedAboutMissingHost: Set<Mode> = new Set();

	/**
	 * Every controls root we have put into a settings page, so unload can take them back out —
	 * Obsidian leaves a plugin's DOM in place. References rather than a later query, because on
	 * 1.13 the settings can be in a window this plugin can no longer reach once unloaded.
	 */
	private controlsRoots: Set<HTMLElement> = new Set();

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
		this.removeControls();
		this.saveData().catch(() => {
			throw new Error('Could not save data');
		});
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

		this.mode2Call = new Map(Modes.map(mode => [mode, (f: Func) => async () => compose(
			this,
			() => this.setMode(mode),
			f,
			() => this.mode2Refresh.get(this.mode)?.(),
			() => {
				// intended as the compose function is expecting functions that return void, and not Promise<void>
				(() => void this.maybeReloadAfterPluginChanges())();
			},
			() => {
				// todo if the previous step reloads, we don't need to continue here
				// intended as the compose function is expecting functions that return void, and not Promise<void>
				(() => void this.maybeInitializeAfterPluginChanges())();
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
			this.mode2Refresh.set(mode, () => {
				this.setMode(mode);
				void tab.reload().then(() => this.rerenderTab(tab));
			});

			// Obsidian 1.13 renders its own tabs through renderTab(); display() survives only as
			// the compatibility path for third-party tabs. Hook whichever this build calls.
			this.register(around(tab, {display: this.overrideRender.bind(this, mode, tab)}));
			if (typeof tab.renderTab === "function") {
				const renderingTab = tab as SettingsTab & { renderTab: (...args: unknown[]) => void };
				this.register(around(renderingTab, {renderTab: this.overrideRender.bind(this, mode, tab)}));
			}
		}

		// Obsidian 1.13 also moved the CSS snippets off the Appearance page and onto a sub-page
		// you click into. That page is a throwaway object with its own container, so neither the
		// Appearance tab nor the hooks above ever see it — follow the navigation instead.
		const settingModal = this.app.setting;
		if (typeof settingModal.openPage === "function") {
			const navigableModal = settingModal as typeof settingModal & {
				openPage: (page: SettingsSubPage) => void;
			};
			this.register(around(navigableModal, {openPage: this.overrideOpenPage.bind(this)}));
			this.register(() => this.stopFollowingSubPage());
		}

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
	}

	public override async loadData() {
		const loadedData = await super.loadData() as Partial<DACSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.settings.bisectSessions ??= {};
	}

	public override async saveData() {
		await super.saveData(this.settings);
	}

	private addControls(subPageContainer?: HTMLElement) {
		const host = subPageContainer
			? this.getSubPageControlsHost(subPageContainer)
			: this.getTabControlsHost();
		if (!host) {
			this.warnIfControlsHaveNowhereToGo(subPageContainer ?? this.tab?.containerEl);
			return;
		}

		// Obsidian reconciles its own setting items in place instead of emptying the container,
		// so a re-render can leave our previous controls behind. Ours are a foreign node in its
		// tree; clear them out before adding them back.
		for (const stale of Array.from(host.root.querySelectorAll(".dac-controls-root"))) {
			this.controlsRoots.delete(stale as HTMLElement);
			stale.remove();
		}

		if (!this.mode2Controls.has(this.mode)) {
			const buttons = UIButtons.map((button) => {
				const el = activeDocument.createElement("button");
				el.type = "button";
				el.classList.add("mod-cta");
				el.ariaLabel = button.tooltip;
				el.setText(this.getButtonText(button.id));
				el.onclick = () => this.wrapCall(this.mode, button.id)?.();
				return el;
			});
			this.mode2Controls.set(this.mode, [...buttons, this.createStatusText()]);
		}

		this.updateControlState();

		const [
			enableAllExceptBtn,
			enableAllBtn,
			disableAllExceptBtn,
			disableAllBtn,
			startBtn,
			startReverseBtn,
			...rest
		] = this.controls;

		const statusText = rest.find((control) => control.tagName === "SPAN");
		const remainingControls = rest.filter((control) => control !== statusText);

		const controlsRoot = activeDocument.createElement("div");
		controlsRoot.classList.add("dac-controls-root");

		if (statusText) {
			statusText.classList.add("dac-status-text");
			controlsRoot.appendChild(statusText);
		}

		const buttonsRow = activeDocument.createElement("div");
		buttonsRow.classList.add("dac-controls-buttons");
		// if we're bisecting we add this class to hide/shift elements
		buttonsRow.classList.toggle("dac-bisecting", this.getSession().isRunning);

		const bulkToggleStack = activeDocument.createElement("div");
		bulkToggleStack.classList.add("dac-button-stack");
		bulkToggleStack.appendChild(enableAllExceptBtn);
		bulkToggleStack.appendChild(enableAllBtn);
		bulkToggleStack.appendChild(disableAllExceptBtn);
		bulkToggleStack.appendChild(disableAllBtn);

		buttonsRow.appendChild(bulkToggleStack);

		const startBisectStack = activeDocument.createElement("div");
		startBisectStack.classList.add("dac-button-stack");
		startBisectStack.classList.add("dac-start-bisect-stack");
		startBisectStack.appendChild(startBtn);
		startBisectStack.appendChild(startReverseBtn);

		buttonsRow.appendChild(startBisectStack);
		for (const control of remainingControls) {
			buttonsRow.appendChild(control);
		}

		controlsRoot.appendChild(buttonsRow);
		this.controlsRoots.add(controlsRoot);
		host.place(controlsRoot);
	}

	/** Takes our controls back off whatever settings pages they were added to. */
	private removeControls() {
		for (const root of this.controlsRoots) {
			root.remove();
		}
		this.controlsRoots.clear();
		this.mode2Controls.clear();
	}

	/** A settings tab's own page: our controls sit directly under its heading. */
	private getTabControlsHost(): ControlsHost | undefined {
		const heading = this.getControlHeading();
		const headingParent = heading?.parentElement;
		if (heading && headingParent) {
			return {
				root: headingParent,
				place: (controls) => headingParent.insertBefore(controls, heading.nextSibling),
			};
		}

		const controlContainer = this.getControlContainer() ?? heading?.querySelector(".setting-item-control");
		if (!controlContainer) {
			return undefined;
		}
		return {
			root: controlContainer as HTMLElement,
			place: (controls) => controlContainer.appendChild(controls),
		};
	}

	/**
	 * A 1.13 sub-page has no heading of its own — the title sits in the modal titlebar — so the
	 * controls go at the top of its group, above the search and the items.
	 */
	private getSubPageControlsHost(container: HTMLElement): ControlsHost {
		const group = container.querySelector<HTMLElement>(".setting-group") ?? container;
		return {
			root: group,
			place: (controls) => group.insertBefore(controls, group.firstChild),
		};
	}

	/**
	 * A rearranged settings page breaks us quietly: the hook still runs, it just finds nowhere
	 * to put anything. Say so once, in the console.
	 *
	 * Only when the page is actually listing the items we control, though. A page listing none
	 * of them is simply not ours — on 1.13 that describes Appearance, whose snippets moved.
	 */
	private warnIfControlsHaveNowhereToGo(container: HTMLElement | undefined) {
		if (!container || this.warnedAboutMissingHost.has(this.mode)) {
			return;
		}
		if (!this.pageIsListingOurItems(container)) {
			return;
		}

		this.warnedAboutMissingHost.add(this.mode);
		console.warn(
			`Divide and Conquer: the "${this.tab?.heading}" settings page is listing ${this.mode}, ` +
			"but there is nowhere to attach the bulk controls, so they will not appear. " +
			"Obsidian's settings layout has most likely changed.",
		);
	}

	/** Does this page show at least one of the plugins or snippets we manage? */
	private pageIsListingOurItems(container: HTMLElement) {
		const names = [...this.getAllItems()].map((item) => item.name).filter(Boolean);

		// Obsidian appends the version and author to a plugin's name, so match the start of the
		// row rather than the whole of it.
		return Array.from(container.querySelectorAll(".setting-item-name")).some((row) => {
			const rowName = row.textContent?.trim() ?? "";
			return names.some((name) => rowName.startsWith(name));
		});
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
		const includedItems = this.getIncludedSortedItems();
		const enabledBeforeBisect = new Set(this.getEnabledFromObsidian());
		const enabledCandidates = includedItems.filter(item => enabledBeforeBisect.has(item.id));

		if (enabledCandidates.length < 1) {
			new Notice(`No enabled ${this.getPluralLabel()} available for bisect.`);
			return;
		}

		const session = this.getSession();
		session.isRunning = true;
		session.direction = "disable";
		session.culpritId = undefined;
		session.enabledBeforeBisect = enabledBeforeBisect;
		session.candidates = new Set(enabledCandidates.map(item => item.id));
		this.resetBulkToggleModeState(this.mode);
		// Starting bisect from settings should not immediately reload Obsidian.
		this.skipNextReload = true;
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));
		await this.applyTestState(session.candidates, session.enabledUnderTest);
		await this.persistSession();
	}

	public async startBisectReverse() {
		const includedItems = this.getIncludedSortedItems();
		const enabledBeforeBisect = new Set(this.getEnabledFromObsidian());
		const disabledCandidates = includedItems.filter(item => !enabledBeforeBisect.has(item.id));

		if (disabledCandidates.length < 1) {
			new Notice(`No disabled ${this.getPluralLabel()} available for reverse bisect.`);
			return;
		}

		const session = this.getSession();
		session.isRunning = true;
		session.direction = "enable";
		session.culpritId = undefined;
		session.enabledBeforeBisect = enabledBeforeBisect;
		session.candidates = new Set(disabledCandidates.map(item => item.id));
		session.enabledUnderTest = new Set(this.takeFirstHalf([...session.candidates]));
		this.resetBulkToggleModeState(this.mode);
		// Starting bisect from settings should not immediately reload Obsidian.
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

		if (session.enabledUnderTest.size < 1) {
			new Notice(`No enabled ${this.getPluralLabel()} to test.`);
			await this.persistSession();
			return;
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
			direction: null,
			candidates: new Set<string>(),
			enabledUnderTest: new Set<string>(),
			culpritId: undefined,
			enabledBeforeBisect: undefined,
		};
	}

	private deserializeSession(session?: PersistedBisectSession): BisectSession {
		if (!session) {
			return this.emptySession();
		}

		// Legacy sessions without an explicit direction field are discarded rather than guessing intent.
		if (session.direction === undefined) {
			return this.emptySession();
		}

		return {
			isRunning: session.isRunning,
			direction: session.direction,
			candidates: new Set(session.candidates ?? []),
			enabledUnderTest: new Set(session.enabledUnderTest ?? []),
			culpritId: session.culpritId,
			enabledBeforeBisect: session.enabledBeforeBisect ? new Set(session.enabledBeforeBisect) : undefined,
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
		};
	}

	private isSessionEmpty(session: BisectSession) {
		return !session.isRunning
			&& session.candidates.size < 1
			&& session.enabledUnderTest.size < 1
			&& !session.culpritId
			&& !session.enabledBeforeBisect;
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
		session.direction = null;
		session.candidates = new Set();
		session.enabledUnderTest = new Set();
		session.culpritId = undefined;
		session.enabledBeforeBisect = undefined;
	}

	private getBulkToggleModeState(mode: Mode): BulkToggleModeState {
		if (!this.mode2BulkToggleMode.has(mode)) {
			this.mode2BulkToggleMode.set(mode, null);
		}
		return this.mode2BulkToggleMode.get(mode)!;
	}

	private resetBulkToggleModeState(mode: Mode) {
		this.mode2BulkToggleMode.set(mode, null);
	}

	private async maybeReloadAfterPluginChanges(consumeSkipToken = true) {
		if (this.mode !== "plugins") {
			return;
		}
		if (consumeSkipToken && this.consumeReloadSkipToken()) {
			return;
		}
		if (!this.settings.reloadAfterPluginChanges) {
			return;
		}
		await this.saveData();
		window.setTimeout(() => this.app.commands.executeCommandById("app:reload"), 2000);
	}

	private async maybeInitializeAfterPluginChanges() {
		if (this.mode !== "plugins") {
			return;
		}
		if (!this.settings.initializeAfterPluginChanges) {
			return;
		}
		await this.app.plugins.initialize();
	}

	/** Called when the user toggles a single plugin or snippet by hand. */
	private handleManualItemToggle(mode: Mode) {
		const bulkToggleMode = this.getBulkToggleModeState(mode);

		// Reload and re-initialize are plugins-only concerns: CSS snippets take effect
		// immediately via CSS injection and have no equivalent of app.plugins.initialize().
		if (mode === "plugins") {
			void this.maybeReloadAfterPluginChanges(false);
			void this.maybeInitializeAfterPluginChanges();
		}

		if (bulkToggleMode === null) {
			return;
		}
		this.resetBulkToggleModeState(mode);
		this.updateControlState();
	}

	/** Whether to skip this reload, clearing the token as it reads it. */
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

	getControlHeading(tab?: SettingsTab) {
		const currentTab = tab ?? this.tab;
		if (!currentTab) {
			return undefined;
		}
		return queryText(currentTab.containerEl, ".setting-item-heading", currentTab.heading);
	}

	getControlContainer(tab?: SettingsTab) {
		return this.getControlHeading(tab)?.querySelector(".setting-item-control");
	}

	getSettingsTab(id: string) {
		return this.app.setting.settingTabs.filter(t => t.id === id).shift() as Partial<SettingsTab>;
	}

	private createStatusText() {
		const span = activeDocument.createElement("span");
		span.className = "setting-item-name";
		return span;
	}

	private getButtonText(id: keyof divideAndConquer) {
		switch (id) {
			case "enableAllExceptExcluded":
				return "Enable Included";
			case "enableAll":
				return "Enable All";
			case "disableAllExceptExcluded":
				return "Disable Included";
			case "disableAll":
				return "Disable All";
			case "startBisect":
				return "Start (disable half)";
			case "startBisectReverse":
				return "Start (enable half)";
			case "resetBisect":
				return "Reset";
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
			this.mode2BulkToggleMode.set(this.mode, "enable");
			this.updateControlState();
			return "enableAllExceptExcluded";
		}
		if (id === "enableAll") {
			this.mode2BulkToggleMode.set(this.mode, "enable");
			this.updateControlState();
			return "enableAll";
		}
		if (id === "disableAllExceptExcluded") {
			this.mode2BulkToggleMode.set(this.mode, "disable");
			this.updateControlState();
			return "disableAllExceptExcluded";
		}
		if (id === "disableAll") {
			this.mode2BulkToggleMode.set(this.mode, "disable");
			this.updateControlState();
			return "disableAll";
		}
		return id;
	}

	private updateControlState() {
		const controls = this.controls;
		if (controls.length !== numberOfButtonsAndTextElements) {
			return;
		}
		const [enableAllExceptBtn, enableAllBtn, disableAllExceptBtn, disableAllBtn, startBtn, startReverseBtn, resetBtn, yes, no, text] = controls;

		const session = this.getSession();
		const bulkToggleMode = this.getBulkToggleModeState(this.mode);

		// Show/hide enable button pair based on bulk-toggle mode state
		enableAllExceptBtn.style.display = bulkToggleMode === "enable" ? "none" : "";
		enableAllBtn.style.display = bulkToggleMode === "enable" ? "" : "none";
		enableAllBtn.ariaLabel = `Enable all ${this.getPluralLabel()}, including excluded ones`;
		enableAllExceptBtn.ariaLabel = `Enable all ${this.getPluralLabel()} except those on your exclusion list`;

		// Show/hide disable button pair based on bulk-toggle mode state
		disableAllExceptBtn.style.display = bulkToggleMode === "disable" ? "none" : "";
		disableAllBtn.style.display = bulkToggleMode === "disable" ? "" : "none";
		disableAllBtn.ariaLabel = `Disable all ${this.getPluralLabel()}, including excluded ones (Divide & Conquer and Hot Reload are always kept on)`;
		disableAllExceptBtn.ariaLabel = `Disable all ${this.getPluralLabel()} except those on your exclusion list`;

		// Hide all enable and disable buttons during bisect
		if (session.isRunning) {
			enableAllExceptBtn.setCssStyles({display: "none"});
			enableAllBtn.setCssStyles({display: "none"});
			disableAllExceptBtn.setCssStyles({display: "none"});
			disableAllBtn.setCssStyles({display: "none"});
		}

		startBtn.style.display = session.isRunning ? "none" : "";
		startBtn.ariaLabel = "Start bisect (disable half)";
		startReverseBtn.style.display = session.isRunning ? "none" : "";
		startReverseBtn.ariaLabel = "Start bisect (enable half)";

		resetBtn.style.display = session.isRunning ? "" : "none";
		resetBtn.ariaLabel = "Reset bisect and restore previous states";

		yes.style.display = session.isRunning ? "" : "none";
		yes.ariaLabel = "Yes";
		no.style.display = session.isRunning ? "" : "none";
		no.ariaLabel = "No";

		if (session.culpritId) {
			text.setText(`The ${this.getSingularLabel()} possibly causing issues is: ${this.getDisplayName(session.culpritId)}`);
			return;
		}
		if (!session.isRunning) {
			text.setText(`Click Start (Disable) or Start (Enable) to begin bisecting ${this.getPluralLabel()}.`);
			return;
		}

		text.setText(`The ${this.getPluralLabel()} below are enabled. Are you still having issues?`);
	}

	/**
	 * Wraps whichever method renders a settings tab, so our controls go back on afterwards.
	 *
	 * Deliberately does not reload: `reload()` ends in didChange(), which is what makes Obsidian
	 * re-render the tab, so reloading from here spins forever. That belongs to `refreshTab`,
	 * which runs after our own bulk operations.
	 */
	private overrideRender(mode: Mode, tab: SettingsTab, old: (...args: unknown[]) => void) {
		return (function render(this: divideAndConquer, ...args: unknown[]) {
			this.setMode(mode);
			old.apply(tab, args);
			this.addControls();
			this.attachContainerToggleListener(mode, tab.containerEl);
		}).bind(this);
	}

	/**
	 * Wraps navigation into a sub-page, so we can follow that page's rendering the way we follow
	 * a tab's. Obsidian rebuilds the page object per visit, so drop the last wrapper as we go.
	 */
	private overrideOpenPage(old: (page: SettingsSubPage) => void) {
		const settingModal = this.app.setting;
		return (function openPage(this: divideAndConquer, page: SettingsSubPage) {
			const mode = this.getModeForHeading(page.title);
			this.stopFollowingSubPage();
			if (mode !== undefined) {
				this.uninstallSubPageHook = around(page, {
					display: this.overrideSubPageRender.bind(this, mode, page),
				});
			}
			old.call(settingModal, page);
		}).bind(this);
	}

	/** The sub-page equivalent of {@link overrideRender}, and it must not reload either. */
	private overrideSubPageRender(mode: Mode, page: SettingsSubPage, old: (...args: unknown[]) => void) {
		return (function display(this: divideAndConquer, ...args: unknown[]) {
			this.setMode(mode);
			old.apply(page, args);
			this.addControls(page.containerEl);
			this.attachContainerToggleListener(mode, page.containerEl);
		}).bind(this);
	}

	private stopFollowingSubPage() {
		this.uninstallSubPageHook?.();
		this.uninstallSubPageHook = null;
	}

	/** Which of our modes, if any, owns the tab or sub-page carrying this title. */
	private getModeForHeading(title: string | undefined) {
		if (!title) {
			return undefined;
		}
		for (const [mode, tab] of this.mode2Tab.entries()) {
			if (tab.heading === title) {
				return mode;
			}
		}
		return undefined;
	}

	/** Ask the tab to draw itself again, whichever era of settings tab it is. */
	private rerenderTab(tab: SettingsTab) {
		if (typeof tab.update === "function") {
			tab.update();
			return;
		}
		tab.display();
	}

	/**
	 * One delegated click listener per container, so toggling any plugin or snippet resets the
	 * bulk-toggle state. Delegation means it survives re-renders; the data attribute keeps us
	 * from attaching twice.
	 */
	private attachContainerToggleListener(mode: Mode, container: HTMLElement) {
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

	private wrapCall(mode: Mode, key: keyof divideAndConquer) {
		return this.mode2Call.get(mode)?.(this[this.getButtonAction(key)] as Func);
	}
}

