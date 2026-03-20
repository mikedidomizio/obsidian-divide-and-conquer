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

		expect((reloaded as any).getButtonLabel("enableAll")).toBe("Reset");
		await reloaded.answerYes();

		const session = reloaded.mode2Session.get("plugins")!;
		expect(session.isRunning).toBe(true);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});

	it("Reset restores plugin states from before bisect started", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		await plugin.startBisect();

		expect((plugin as any).getButtonLabel("enableAll")).toBe("Reset");
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
		expect((plugin as any).getButtonLabel("enableAll")).toBe("Enable All");
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

		expect((reloaded as any).getButtonLabel("enableAll")).toBe("Reset");
		await reloaded.answerYes();

		const session = reloaded.mode2Session.get("snippets")!;
		expect(session.isRunning).toBe(true);
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});
});

