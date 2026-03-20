import { describe, expect, it, vi } from "vitest";

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
	it("Start enables one half and disables the other half", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(2);
		expect(state.disabled).toHaveLength(2);
	});

	it("Yes narrows the candidate set", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		await plugin.answerYes();
		const session = plugin.mode2Session.get("plugins")!;
		expect(session.candidates.size).toBe(2);
		expect(session.enabledUnderTest.size).toBe(1);
	});

	it("No switches to the opposite half", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.startBisect();
		const before = new Set(plugin.mode2Session.get("plugins")!.enabledUnderTest);
		await plugin.answerNo();
		const after = plugin.mode2Session.get("plugins")!.enabledUnderTest;
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
});

describe("Command Palette: CSS Snippet Bisect Flow", () => {
	it("Start splits snippets into enabled and disabled halves", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css", "c.css", "d.css"], ["a.css", "b.css", "c.css", "d.css"]);
		await plugin.startBisect();
		const state = plugin.getEnabledDisabled();
		expect(state.enabled).toHaveLength(2);
		expect(state.disabled).toHaveLength(2);
	});

	it("Enable All turns all snippets on", async () => {
		const plugin = createSnippetPlugin(["a.css", "b.css"], []);
		await plugin.enableAll();
		const enabled = plugin.getEnabledFromObsidian();
		expect(enabled.has("a.css")).toBe(true);
		expect(enabled.has("b.css")).toBe(true);
	});
});

