import { describe, expect, it, vi } from "vitest";

import { Plugin } from "obsidian";
import divideAndConquer from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

function makeManifest(id: string, name?: string) {
	return { id, name: name ?? id, version: "1.0.0" };
}

function createPlugin(pluginIds: string[], enabledIds: string[], filterRegexes: string[] = []) {
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
		pluginFilterRegexes: filterRegexes,
		snippetFilterRegexes: [],
	};
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

function createSnippetPlugin(snippetIds: string[], enabledIds: string[]) {
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
	plugin.settings = { ...DEFAULT_SETTINGS, snippetFilterRegexes: [] };
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
	it("Start does NOT change the enabled/disabled state", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(4);
		expect(state.disabled).toHaveLength(0);
	});

	it("Start sets isRunning and hasStarted on the session", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.hasStarted).toBe(true);
	});

	it("Start captures the enabled state at the time of click into startingEnabled", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		await plugin.startBisect();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.startingEnabled.has("a")).toBe(true);
		expect(session.startingEnabled.has("c")).toBe(true);
		expect(session.startingEnabled.has("b")).toBe(false);
		expect(session.startingEnabled.has("d")).toBe(false);
	});

	it("Start sets up candidates and enabledUnderTest without applying state", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.candidates.size).toBe(4);
		expect(session.enabledUnderTest.size).toBe(2);
	});

	it("First Yes after Start applies the first-half state", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		// answerYes narrows within the first-half candidates only,
		// so one of those is disabled while the second-half items remain enabled
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(3);
		expect(state.disabled).toHaveLength(1);
	});

	it("First No after Start applies the second-half state", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerNo();
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(1);
		expect(state.disabled).toHaveLength(3);
	});

	it("Yes narrows the candidate set", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});

	it("No eliminates the current half and keeps bisecting", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
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

	it("Enable All resets hasStarted so the Reset button is hidden", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.enableAll();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.hasStarted).toBe(false);
		expect(session.startingEnabled.size).toBe(0);
	});
});

describe("Reset (startOver)", () => {
	it("Reset restores the enabled/disabled state from when Start was clicked", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		await plugin.startBisect();
		await plugin.answerYes(); // applies a different state
		await plugin.startOver();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("c")).toBe(true);
		expect(enabled.has("b")).toBe(false);
		expect(enabled.has("d")).toBe(false);
	});

	it("Reset resets hasStarted, isRunning, and clears session state", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.startOver();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.hasStarted).toBe(false);
		expect(session.isRunning).toBe(false);
		expect(session.candidates.size).toBe(0);
		expect(session.enabledUnderTest.size).toBe(0);
		expect(session.culpritId).toBeUndefined();
	});

	it("Reset restores state correctly even after multiple Yes answers", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b"]);
		await plugin.startBisect();
		await plugin.answerYes();
		await plugin.answerYes();
		await plugin.startOver();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a")).toBe(true);
		expect(enabled.has("b")).toBe(true);
		expect(enabled.has("c")).toBe(false);
		expect(enabled.has("d")).toBe(false);
	});
});

describe("Reset button label", () => {
	it("getButtonLabel returns 'Reset' for startOver", () => {
		const plugin = createPlugin([], []);
		expect((plugin as any).getButtonLabel("startOver")).toBe("Reset");
	});
});

describe("Command Palette: CSS Snippet Bisect Flow", () => {
	it("Start does NOT change the snippet enabled/disabled state", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(4);
		expect(state.disabled).toHaveLength(0);
	});

	it("No narrows the remaining snippet candidates", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
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

	it("Reset restores snippet state from when Start was clicked", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css"]);
		await plugin.startBisect();
		await plugin.answerYes();
		await plugin.startOver();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a.css")).toBe(true);
		expect(enabled.has("b.css")).toBe(true);
		expect(enabled.has("c.css")).toBe(false);
		expect(enabled.has("d.css")).toBe(false);
	});
});

describe("Session persistence across reloads", () => {
	/** Helper: capture what saveData would write to disk. */
	async function captureSave(plugin: divideAndConquer): Promise<any> {
		let captured: any;
		vi.spyOn(Plugin.prototype, "saveData").mockImplementationOnce(async (data: any) => {
			captured = data;
		});
		await plugin.saveData();
		return captured;
	}

	/** Helper: restore a plugin from previously captured disk data. */
	async function restorePlugin(savedData: any, pluginIds: string[], enabledIds: string[]): Promise<divideAndConquer> {
		const plugin2 = createPlugin(pluginIds, enabledIds);
		vi.spyOn(Plugin.prototype, "loadData").mockImplementationOnce(async () => savedData);
		await plugin2.loadData();
		return plugin2;
	}

	it("saveData writes bisectSessions to the persisted payload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const saved = await captureSave(plugin);
		expect(saved.bisectSessions).toBeDefined();
		expect(saved.bisectSessions["plugins"]).toBeDefined();
	});

	it("session isRunning and hasStarted survive a reload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		const session = plugin2.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.hasStarted).toBe(true);
	});

	it("startingEnabled is restored correctly after reload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		await plugin.startBisect();
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b", "c", "d"], ["a", "c"]);
		const session = plugin2.mode2Session.get("plugins")!;
		expect(session.startingEnabled.has("a")).toBe(true);
		expect(session.startingEnabled.has("c")).toBe(true);
		expect(session.startingEnabled.has("b")).toBe(false);
		expect(session.startingEnabled.has("d")).toBe(false);
	});

	it("candidates and enabledUnderTest are restored after reload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const originalSession = plugin.mode2Session.get("plugins")!;
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		const session = plugin2.mode2Session.get("plugins")!;
		expect(session.candidates.size).toBe(originalSession.candidates.size);
		expect(session.enabledUnderTest.size).toBe(originalSession.enabledUnderTest.size);
		expect([...session.candidates]).toEqual(expect.arrayContaining([...originalSession.candidates]));
		expect([...session.enabledUnderTest]).toEqual(expect.arrayContaining([...originalSession.enabledUnderTest]));
	});

	it("mid-bisect session (after Yes) is fully restored after reload", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		const session = plugin2.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.hasStarted).toBe(true);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});

	it("culpritId is restored after reload", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		await plugin.startBisect();
		await plugin.answerYes(); // with 2 items, this finds the culprit
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b"], ["a", "b"]);
		const session = plugin2.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(false);
		expect(typeof session.culpritId).toBe("string");
	});

	it("settings are still loaded correctly alongside bisectSessions", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		plugin.settings.reloadAfterPluginChanges = true;
		await plugin.startBisect();
		const saved = await captureSave(plugin);
		const plugin2 = await restorePlugin(saved, ["a", "b"], ["a", "b"]);
		expect(plugin2.settings.reloadAfterPluginChanges).toBe(true);
	});

	it("loading data with no bisectSessions (fresh install) does not throw", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		vi.spyOn(Plugin.prototype, "loadData").mockImplementationOnce(async () => ({}));
		await expect(plugin.loadData()).resolves.not.toThrow();
		expect(plugin.mode2Session.size).toBe(0);
	});
});

