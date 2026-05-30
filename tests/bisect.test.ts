import { describe, expect, it, vi } from "vitest";

import divideAndConquer from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

function makeManifest(id: string, name?: string) {
	return { id, name: name ?? id, version: "1.0.0" };
}

function createPlugin(
	pluginIds: string[],
	enabledIds: string[],
	filterRegexes: string[] = [],
	settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {},
) {
	const enabledSet = new Set<string>(enabledIds);
	const manifests: Record<string, any> = {};
	pluginIds.forEach((id) => (manifests[id] = makeManifest(id)));

	const fakeApp = {
		plugins: {
			manifests,
			enabledPlugins: enabledSet,
			enablePluginAndSave: vi.fn(async (id: string) => {
				enabledSet.add(id);
				return true;
			}),
			disablePluginAndSave: vi.fn(async (id: string) => {
				enabledSet.delete(id);
				return true;
			}),
			requestSaveConfig: vi.fn(async () => {}),
			initialize: vi.fn(async () => {}),
			loadManifests: vi.fn(async () => {}),
		},
		customCss: {
			snippets: [] as string[],
			enabledSnippets: new Set<string>(),
			setCssEnabledStatus: vi.fn(),
			loadSnippets: vi.fn(async () => {}),
		},
		commands: { executeCommandById: vi.fn() },
		workspace: { onLayoutReady: vi.fn() },
		setting: { settingTabs: [] },
	};

	const plugin = new divideAndConquer(fakeApp as any, {} as any);
	plugin.settings = {
		...DEFAULT_SETTINGS,
		...settingsOverride,
		pluginFilterRegexes: filterRegexes,
		snippetFilterRegexes: settingsOverride.snippetFilterRegexes ?? [],
	};
	plugin.saveData = vi.fn(async () => {});
	(plugin as any)._mode = "plugins";

	plugin.getAllItems = () =>
		new Set(Object.values(manifests as Record<string, { id: string; name: string }>));
	plugin.getEnabledFromObsidian = () => enabledSet;
	plugin.enableItem = async (id: string) => {
		enabledSet.add(id);
	};
	plugin.disableItem = async (id: string) => {
		enabledSet.delete(id);
	};
	plugin.getFilters = () => filterRegexes;

	return plugin;
}

function createSnippetPlugin(
	snippetIds: string[],
	enabledIds: string[],
	settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {},
) {
	const enabledSet = new Set<string>(enabledIds);
	const fakeApp = {
		plugins: {
			manifests: {},
			enabledPlugins: new Set<string>(),
			enablePluginAndSave: vi.fn(),
			disablePluginAndSave: vi.fn(),
			requestSaveConfig: vi.fn(async () => {}),
			initialize: vi.fn(async () => {}),
			loadManifests: vi.fn(async () => {}),
		},
		customCss: {
			snippets: snippetIds,
			enabledSnippets: enabledSet,
			setCssEnabledStatus: vi.fn((id: string, enable: boolean) => {
				if (enable) enabledSet.add(id);
				else enabledSet.delete(id);
			}),
			loadSnippets: vi.fn(async () => {}),
		},
		commands: { executeCommandById: vi.fn() },
		workspace: { onLayoutReady: vi.fn() },
		setting: { settingTabs: [] },
	};

	const plugin = new divideAndConquer(fakeApp as any, {} as any);
	plugin.settings = { ...DEFAULT_SETTINGS, ...settingsOverride, snippetFilterRegexes: [] };
	plugin.saveData = vi.fn(async () => {});
	(plugin as any)._mode = "snippets";
	plugin.getAllItems = () => new Set(snippetIds.map((id) => ({ id, name: id })));
	plugin.getEnabledFromObsidian = () => enabledSet;
	plugin.enableItem = async (id: string) => {
		enabledSet.add(id);
	};
	plugin.disableItem = async (id: string) => {
		enabledSet.delete(id);
	};
	plugin.getFilters = () => [];

	return plugin;
}

describe("Command Palette: Plugin Bisect Flow", () => {
	it("Start does not change plugin states before first answer", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		const before = plugin.getEnabledDisabled();
		await plugin.startBisect();
		const after = plugin.getEnabledDisabled();
		const session = plugin.mode2Session.get("plugins")!;
		expect(after.enabled).toEqual(before.enabled);
		expect(after.disabled).toEqual(before.disabled);
		expect(session.awaitingInitialAnswer).toBe(true);
	});

	it("First Yes applies the first split", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		const state = plugin.getEnabledDisabled();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.awaitingInitialAnswer).toBe(false);
		expect(state.enabled).toHaveLength(2);
		expect(state.disabled).toHaveLength(2);
	});

	it("First No pivots to previously disabled plugin candidates", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisect();
		await plugin.answerNo();

		const session = plugin.mode2Session.get("plugins")!;
		const enabled = plugin.getEnabledFromObsidian();
		expect(session.awaitingInitialAnswer).toBe(false);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
		expect(enabled.has("a") || enabled.has("b")).toBe(false);
	});

	it("First No with all candidates enabled stops instead of getting stuck", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerNo();

		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.awaitingInitialAnswer).toBe(false);
	});

	it("No eliminates the current half and keeps bisecting", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		const before = new Set(plugin.mode2Session.get("plugins")!.enabledUnderTest);
		await plugin.answerNo();
		const session = plugin.mode2Session.get("plugins")!;
		const after = session.enabledUnderTest;
		const state = plugin.getEnabledDisabled();
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
		expect(state.enabled).toHaveLength(1);
		expect(state.disabled).toHaveLength(3);
		expect([...after].some((id) => before.has(id))).toBe(false);
	});

	it("Yes finalizes the possible culprit when one candidate is left", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		await plugin.startBisect();
		await plugin.answerYes();
		await plugin.answerYes();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(typeof session.culpritId).toBe("string");
	});

	it("Enable All turns everything on, even filtered items", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["b"], ["a"]);
		await plugin.enableAll();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("b")).toBe(true);
		expect(enabled.has("c")).toBe(true);
	});

	it("Excluded plugins are never bisect candidates or culprits", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"], ["^a$"]);

		await plugin.startBisect();
		const started = plugin.mode2Session.get("plugins")!;
		expect(started.candidates.has("a")).toBe(false);
		expect(started.enabledUnderTest.has("a")).toBe(false);

		// Drive to a single culprit and ensure the excluded plugin is never selected.
		await plugin.answerYes();
		await plugin.answerNo();

		const finished = plugin.mode2Session.get("plugins")!;
		expect(finished.culpritId).toBeDefined();
		expect(finished.culpritId).not.toBe("a");

		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
	});

	it("Enable All clears an in-progress plugin bisect session", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();

		expect((plugin as any).getButtonLabel("resetBisect")).toBe("Reset");
		await plugin.enableAll();

		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("b")).toBe(true);
		expect(enabled.has("c")).toBe(true);
		expect(enabled.has("d")).toBe(true);

		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.culpritId).toBeUndefined();
		expect(session.enabledBeforeBisect).toBeUndefined();
		expect(session.awaitingInitialAnswer).toBe(false);
		expect((plugin as any).getButtonLabel("enableAllExceptExcluded")).toBe("Enable All (except excluded)");
	});

	it("Start bisect sets a one-time reload skip token", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		expect((plugin as any).consumeReloadSkipToken()).toBe(false);

		await plugin.startBisect();

		expect((plugin as any).consumeReloadSkipToken()).toBe(true);
		expect((plugin as any).consumeReloadSkipToken()).toBe(false);
	});

	it("In-progress plugin bisect session survives reload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();

		const persisted = JSON.parse(JSON.stringify(plugin.settings.bisectSessions));
		const enabledNow = [...plugin.getEnabledFromObsidian()];
		const reloaded = createPlugin(["a", "b", "c", "d"], enabledNow, [], { bisectSessions: persisted });

		expect((reloaded as any).getButtonLabel("resetBisect")).toBe("Reset");
		await reloaded.answerYes();

		const session = reloaded.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});

	it("Reset restores plugin states from before bisect started", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		await plugin.startBisect();

		expect((plugin as any).getButtonLabel("resetBisect")).toBe("Reset");
		await plugin.resetBisect();

		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("b")).toBe(false);
		expect(enabled.has("c")).toBe(true);
		expect(enabled.has("d")).toBe(false);

		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.culpritId).toBeUndefined();
		expect(session.enabledBeforeBisect).toBeUndefined();
		expect((plugin as any).getButtonLabel("enableAllExceptExcluded")).toBe("Enable All (except excluded)");
	});

	it("Reset restores plugin states correctly after multiple answers", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		const before = plugin.getEnabledDisabled();

		await plugin.startBisect();
		await plugin.answerYes();
		await plugin.answerYes();
		await plugin.resetBisect();

		const after = plugin.getEnabledDisabled();
		expect(after.enabled).toEqual(before.enabled);
		expect(after.disabled).toEqual(before.disabled);

		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.culpritId).toBeUndefined();
		expect(session.enabledBeforeBisect).toBeUndefined();
		expect(session.awaitingInitialAnswer).toBe(false);
	});
});

describe("Command Palette: CSS Snippet Bisect Flow", () => {
	it("Start does not change snippet states before first answer", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		const before = plugin.getEnabledDisabled();
		await plugin.startBisect();
		const after = plugin.getEnabledDisabled();
		const session = plugin.mode2Session.get("snippets")!;
		expect(after.enabled).toEqual(before.enabled);
		expect(after.disabled).toEqual(before.disabled);
		expect(session.awaitingInitialAnswer).toBe(true);
	});

	it("No narrows the remaining snippet candidates", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
		await plugin.answerYes();
		await plugin.answerNo();
		const session = plugin.mode2Session.get("snippets")!;
		const state = plugin.getEnabledDisabled();
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
		expect(state.enabled).toHaveLength(1);
		expect(state.disabled).toHaveLength(3);
	});

	it("Enable All turns all snippets on", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css"], []);
		await plugin.enableAll();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a.css")).toBe(true);
		expect(enabled.has("b.css")).toBe(true);
	});

	it("Reset restores snippet states from before bisect started", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css"], ["b.css"]);
		await plugin.startBisect();
		await plugin.resetBisect();

		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a.css")).toBe(false);
		expect(enabled.has("b.css")).toBe(true);
		expect(enabled.has("c.css")).toBe(false);

		const session = plugin.mode2Session.get("snippets")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.enabledBeforeBisect).toBeUndefined();
	});

	it("Start bisect sets a one-time reload skip token for snippets too", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
		expect((plugin as any).consumeReloadSkipToken()).toBe(true);
		expect((plugin as any).consumeReloadSkipToken()).toBe(false);
	});

	it("In-progress snippet bisect session survives reload", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
		await plugin.answerYes();

		const persisted = JSON.parse(JSON.stringify(plugin.settings.bisectSessions));
		const enabledNow = [...plugin.getEnabledFromObsidian()];
		const reloaded = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], enabledNow, { bisectSessions: persisted });

		expect((reloaded as any).getButtonLabel("resetBisect")).toBe("Reset");
		await reloaded.answerYes();

		const session = reloaded.mode2Session.get("snippets")!;
		expect(session.isRunning).toBe(true);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});
});

describe("Bulk toggle: enableAllExceptExcluded / disableAll / disableAllExceptExcluded", () => {
	it("enableAllExceptExcluded enables only non-excluded items", async () => {
		const plugin = createPlugin(["a", "b", "c"], [], ["^a$"]);
		await plugin.enableAllExceptExcluded();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(false); // excluded
		expect(enabled.has("b")).toBe(true);
		expect(enabled.has("c")).toBe(true);
	});

	it("disableAll disables every item except PROTECTED_IDS", async () => {
		const ids = ["a", "b", "obsidian-divide-and-conquer", "hot-reload"];
		const plugin = createPlugin(ids, ids);
		await plugin.disableAll();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(false);
		expect(enabled.has("b")).toBe(false);
		expect(enabled.has("obsidian-divide-and-conquer")).toBe(true);
		expect(enabled.has("hot-reload")).toBe(true);
	});

	it("disableAllExceptExcluded respects both the exclusion list and PROTECTED_IDS", async () => {
		const ids = ["a", "b", "c", "obsidian-divide-and-conquer", "hot-reload"];
		const plugin = createPlugin(ids, ids, ["^c$"]);
		await plugin.disableAllExceptExcluded();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(false);
		expect(enabled.has("b")).toBe(false);
		expect(enabled.has("c")).toBe(true);  // excluded by filter
		expect(enabled.has("obsidian-divide-and-conquer")).toBe(true); // PROTECTED
		expect(enabled.has("hot-reload")).toBe(true); // PROTECTED
	});

	it("disableAll still protects PROTECTED_IDS even when they match no exclusion filter", async () => {
		const ids = ["obsidian-divide-and-conquer", "hot-reload", "x"];
		const plugin = createPlugin(ids, ids, []);
		await plugin.disableAll();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("obsidian-divide-and-conquer")).toBe(true);
		expect(enabled.has("hot-reload")).toBe(true);
		expect(enabled.has("x")).toBe(false);
	});

	it("disableAll clears an in-progress bisect session", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.disableAll();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
	});
});

describe("Two-button bulk-toggle visibility", () => {
	it("enableAllExceptExcluded button has fixed 'Enable All (except excluded)' label", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		expect((plugin as any).getButtonLabel("enableAllExceptExcluded")).toBe("Enable All (except excluded)");
	});

	it("enableAll button has fixed 'Enable All' label", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		expect((plugin as any).getButtonLabel("enableAll")).toBe("Enable All");
	});

	it("disableAllExceptExcluded button has fixed 'Disable All (except excluded)' label", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		expect((plugin as any).getButtonLabel("disableAllExceptExcluded")).toBe("Disable All (except excluded)");
	});

	it("disableAll button has fixed 'Disable All' label", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		expect((plugin as any).getButtonLabel("disableAll")).toBe("Disable All");
	});

	it("first click on enableAllExceptExcluded routes to enableAllExceptExcluded and sets bypass flag", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		const action = (plugin as any).getButtonAction("enableAllExceptExcluded");
		expect(action).toBe("enableAllExceptExcluded");
		expect((plugin as any).getBypassState("plugins").enable).toBe(true);
	});

	it("clicking an enable state resets disable state back to false", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		(plugin as any).getBypassState("plugins").disable = true;
		expect((plugin as any).getBypassState("plugins").disable).toBe(true);
		(plugin as any).getButtonAction("enableAllExceptExcluded");
		expect((plugin as any).getBypassState("plugins").disable).toBe(false);
	});

	it("second click on enableAllExceptExcluded (when on enableAll) routes to enableAll but keeps bypass flag true", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		(plugin as any).getBypassState("plugins").enable = true;
		const action = (plugin as any).getButtonAction("enableAll");
		expect(action).toBe("enableAll");
		expect((plugin as any).getBypassState("plugins").enable).toBe(true);
	});

	it("first click on disableAllExceptExcluded routes to disableAllExceptExcluded and sets bypass flag", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		const action = (plugin as any).getButtonAction("disableAllExceptExcluded");
		expect(action).toBe("disableAllExceptExcluded");
		expect((plugin as any).getBypassState("plugins").disable).toBe(true);
	});

	it("clicking a disable state resets enable state back to false", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		(plugin as any).getBypassState("plugins").enable = true;
		expect((plugin as any).getBypassState("plugins").enable).toBe(true);
		(plugin as any).getButtonAction("disableAllExceptExcluded");
		expect((plugin as any).getBypassState("plugins").enable).toBe(false);
	});

	it("second click on disableAllExceptExcluded (when on disableAll) routes to disableAll but keeps bypass flag true", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		(plugin as any).getBypassState("plugins").disable = true;
		const action = (plugin as any).getButtonAction("disableAll");
		expect(action).toBe("disableAll");
		expect((plugin as any).getBypassState("plugins").disable).toBe(true);
	});

	it("attachContainerToggleListener resets bypass flags when a .checkbox-container is clicked", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		(plugin as any).getBypassState("plugins").enable = true;
		(plugin as any).getBypassState("plugins").disable = true;

		// Simulate the tab container with a checkbox-container inside it
		const container = document.createElement("div");
		const checkboxWrapper = document.createElement("div");
		checkboxWrapper.className = "checkbox-container";
		container.appendChild(checkboxWrapper);

		const fakeTab = { containerEl: container } as any;
		(plugin as any)._mode = "plugins";
		(plugin as any).attachContainerToggleListener("plugins", fakeTab);

		// Simulate clicking the toggle
		checkboxWrapper.click();

		expect((plugin as any).getBypassState("plugins").enable).toBe(false);
		expect((plugin as any).getBypassState("plugins").disable).toBe(false);
		expect((plugin as any).getButtonLabel("enableAllExceptExcluded")).toBe("Enable All (except excluded)");
		expect((plugin as any).getButtonLabel("disableAllExceptExcluded")).toBe("Disable All (except excluded)");
	});

	it("attachContainerToggleListener only attaches the listener once per container", () => {
		const plugin = createPlugin(["a", "b"], ["a"]);
		const container = document.createElement("div");
		const checkboxWrapper = document.createElement("div");
		checkboxWrapper.className = "checkbox-container";
		container.appendChild(checkboxWrapper);

		const fakeTab = { containerEl: container } as any;
		(plugin as any)._mode = "plugins";

		// Attach twice — should only count once
		(plugin as any).attachContainerToggleListener("plugins", fakeTab);
		(plugin as any).attachContainerToggleListener("plugins", fakeTab);

		let callCount = 0;
		const origHandle = (plugin as any).handleManualItemToggle.bind(plugin);
		(plugin as any).handleManualItemToggle = (mode: string) => { callCount++; origHandle(mode); };

		checkboxWrapper.click();
		expect(callCount).toBe(1);
	});

	it("bypass flags are reset when bisect starts", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"]);
		(plugin as any).getBypassState("plugins").enable = true;
		(plugin as any).getBypassState("plugins").disable = true;
		await plugin.startBisect();
		expect((plugin as any).getBypassState("plugins").enable).toBe(false);
		expect((plugin as any).getBypassState("plugins").disable).toBe(false);
	});

	it("bypass flags stay set after first bulk click and reset when an item is manually toggled", async () => {
		const plugin = createPlugin(["a", "b"], ["a"]);

		const firstAction = (plugin as any).getButtonAction("enableAllExceptExcluded");
		expect(firstAction).toBe("enableAllExceptExcluded");
		await plugin.enableAllExceptExcluded();
		expect((plugin as any).getBypassState("plugins").enable).toBe(true);

		(plugin as any).handleManualItemToggle("plugins");
		expect((plugin as any).getBypassState("plugins").enable).toBe(false);
		expect((plugin as any).getBypassState("plugins").disable).toBe(false);
		expect((plugin as any).getButtonLabel("enableAllExceptExcluded")).toBe("Enable All (except excluded)");
		expect((plugin as any).getButtonLabel("disableAllExceptExcluded")).toBe("Disable All (except excluded)");
	});

	it("resetBisect button shows 'Reset' while bisect is running", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"]);
		await plugin.startBisect();
		expect((plugin as any).getButtonLabel("resetBisect")).toBe("Reset");
	});
});

describe("Reverse bisect flow", () => {
	it("startBisectReverse seeds candidates from disabled plugins only", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.direction).toBe("enable");
		expect(session.candidates.has("a")).toBe(false);
		expect(session.candidates.has("b")).toBe(false);
		expect(session.candidates.has("c")).toBe(true);
		expect(session.candidates.has("d")).toBe(true);
	});

	it("startBisectReverse immediately enables the first half of disabled candidates", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.enabledUnderTest.size).toBe(1);
		// one of {c, d} should now be enabled
		const enabled = plugin.getEnabledFromObsidian();
		const newlyEnabled = [...session.enabledUnderTest];
		expect(enabled.has(newlyEnabled[0])).toBe(true);
	});

	it("startBisectReverse does not have awaitingInitialAnswer (starts immediately)", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.awaitingInitialAnswer).toBe(false);
	});

	it("startBisectReverse records state before bisect for reset", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.enabledBeforeBisect?.has("a")).toBe(true);
		expect(session.enabledBeforeBisect?.has("b")).toBe(true);
		expect(session.enabledBeforeBisect?.has("c")).toBe(false);
		expect(session.enabledBeforeBisect?.has("d")).toBe(false);
	});

	it("startBisectReverse notices when no disabled plugins available", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		await plugin.startBisectReverse();
		// When early-exiting, no session is created — getSession() returns a fresh empty one
		const session = (plugin as any).getSession();
		expect(session.isRunning).toBe(false);
	});

	it("startBisectReverse excludes excluded plugins from candidates", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a"], ["^d$"]);
		await plugin.startBisectReverse();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.candidates.has("d")).toBe(false); // excluded
		expect(session.candidates.has("b")).toBe(true);
		expect(session.candidates.has("c")).toBe(true);
	});

	it("answerYes in reverse bisect narrows to the first half of enabled candidates", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a"]);
		// b, c, d are disabled candidates
		await plugin.startBisectReverse();
		await plugin.answerYes();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.candidates.size).toBeLessThan(3);
		expect(session.enabledUnderTest.size).toBeGreaterThanOrEqual(1);
	});

	it("answerNo in reverse bisect pivots to the second (untested) half", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], []);
		// all 4 are disabled
		await plugin.startBisectReverse();
		const beforeCandidates = new Set(plugin.mode2Session.get("plugins")!.enabledUnderTest);
		await plugin.answerNo();
		const session = plugin.mode2Session.get("plugins")!;
		// new enabledUnderTest must not overlap with the previous tested half
		const overlap = [...session.enabledUnderTest].some(id => beforeCandidates.has(id));
		expect(overlap).toBe(false);
	});

	it("reverse bisect Reset restores state from before reverse bisect started", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();
		await plugin.resetBisect();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("b")).toBe(true);
		expect(enabled.has("c")).toBe(false);
		expect(enabled.has("d")).toBe(false);
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
	});

	it("reverse bisect session persists and restores with direction field", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisectReverse();

		const persisted = JSON.parse(JSON.stringify(plugin.settings.bisectSessions));
		const enabledNow = [...plugin.getEnabledFromObsidian()];
		const reloaded = createPlugin(["a", "b", "c", "d"], enabledNow, [], { bisectSessions: persisted });

		expect((reloaded as any).getButtonLabel("resetBisect")).toBe("Reset");
		// Trigger deserialization by calling getSession
		const session = (reloaded as any).getSession();
		expect(session.direction).toBe("enable");
		expect(session.isRunning).toBe(true);
	});

	it("Reset button shows 'Reset' regardless of bisect direction", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a"]);
		await plugin.startBisectReverse();
		expect((plugin as any).getButtonLabel("resetBisect")).toBe("Reset");
	});

	it("legacy persisted session without direction field is discarded", () => {
		const legacySession = {
			isRunning: true,
			// direction intentionally omitted
			candidates: ["a", "b"],
			enabledUnderTest: ["a"],
			culpritId: undefined,
			enabledBeforeBisect: ["a", "b"],
			awaitingInitialAnswer: false,
		};
		const plugin = createPlugin(["a", "b"], ["a"], [], {
			bisectSessions: { plugins: legacySession as any },
		});
		const session = plugin.mode2Session.get("plugins") ?? (plugin as any).deserializeSession(legacySession);
		// Force deserialization by accessing the session
		const deserialized = (plugin as any).deserializeSession(legacySession);
		expect(deserialized.isRunning).toBe(false);
		expect(deserialized.candidates.size).toBe(0);
	});
});


