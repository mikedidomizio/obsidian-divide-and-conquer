import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import divideAndConquer from "../src/main";
import {DEFAULT_SETTINGS} from "../src/settings";

function createSettingsTab(id: string) {
	return {
		id,
		heading: "",
		containerEl: document.createElement("div"),
		reload: vi.fn(async () => {}),
		display: vi.fn(),
	};
}

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
		setting: {
			settingTabs: [createSettingsTab("community-plugins"), createSettingsTab("appearance")],
		},
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
	plugin.enableItem = async (id: string) => fakeApp.plugins.enablePluginAndSave(id);
	plugin.disableItem = async (id: string) => fakeApp.plugins.disablePluginAndSave(id);
	plugin.getFilters = () => filterRegexes;

	return { plugin, fakeApp };
}

function getCommand(plugin: divideAndConquer, id: string) {
	const command = (plugin as any).registeredCommands.find((c: { id: string }) => c.id === id);
	expect(command).toBeDefined();
	expect(typeof command.callback).toBe("function");
	return command.callback as () => Promise<void>;
}

afterEach(() => {
	vi.useRealTimers();
});

beforeEach(() => {
	(globalThis as any).activeDocument = document;
});

describe("Reload on plugin changes", () => {

	describe("setting enabled", () => {

		it("user changing plugins schedules app restart", async () => {
			vi.useFakeTimers();

			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.reloadAfterPluginChanges = true;

			const startBisect = getCommand(plugin, "plugin-start-bisect");
			await startBisect();

			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalled();

			const answerYes = getCommand(plugin, "plugin-answer-yes");
			await answerYes();

			// verifies both enabled/disabled paths
			expect(fakeApp.plugins.enablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.disablePluginAndSave).toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).toHaveBeenCalledWith("app:reload");
		});

	})

	describe("setting disabled", () => {

		it("user changing plugins does not schedule app restart", async () => {
			vi.useFakeTimers();

			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.reloadAfterPluginChanges = false;

			const startBisect = getCommand(plugin, "plugin-start-bisect");
			await startBisect();

			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalled();

			const answerYes = getCommand(plugin, "plugin-answer-yes");
			await answerYes();

			// verifies both enabled/disabled paths
			expect(fakeApp.plugins.enablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.disablePluginAndSave).toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalledWith("app:reload");
		});

	})

});
