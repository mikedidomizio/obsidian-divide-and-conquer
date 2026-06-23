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

function getSettingsTabOrThrow(fakeApp: any, id: string): ReturnType<typeof createSettingsTab> {
	const tab = fakeApp.setting.settingTabs.find((settingTab: { id: string }) => settingTab.id === id);
	expect(tab).toBeDefined();
	return tab as ReturnType<typeof createSettingsTab>;
}

function makeManifest(id: string, name?: string) {
	return { id, name: name ?? id, version: "1.0.0" };
}

function createPlugin(
	pluginIds: string[],
	enabledIds: string[],
	filterRegexes: string[] = [],
	snippetIds: string[] = [],
	enabledSnippetIds: string[] = [],
	settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {},
) {
	const enabledSet = new Set<string>(enabledIds);
	const enabledSnippets = new Set<string>(enabledSnippetIds);
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
			snippets: snippetIds,
			enabledSnippets,
			setCssEnabledStatus: vi.fn((id: string, enabled: boolean) => {
				if (enabled) {
					enabledSnippets.add(id);
					return;
				}
				enabledSnippets.delete(id);
			}),
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

		it("manually toggling plugins schedules app restart", async () => {
			vi.useFakeTimers();

			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.reloadAfterPluginChanges = true;

			const pluginsTab = getSettingsTabOrThrow(fakeApp, "community-plugins")!;

			const checkboxWrapper = document.createElement("div");
			checkboxWrapper.className = "checkbox-container";
			pluginsTab.containerEl.appendChild(checkboxWrapper);

			pluginsTab.display("sentinel");
			await Promise.resolve();
			await Promise.resolve();

			checkboxWrapper.click();
			await Promise.resolve();

			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).toHaveBeenCalledWith("app:reload");
		});

	})

	describe("setting disabled", () => {

		it("manually toggling plugins does not schedule app restart", async () => {
			vi.useFakeTimers();

			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.reloadAfterPluginChanges = false;

			const pluginsTab = getSettingsTabOrThrow(fakeApp, "community-plugins")!;

			const checkboxWrapper = document.createElement("div");
			checkboxWrapper.className = "checkbox-container";
			pluginsTab.containerEl.appendChild(checkboxWrapper);

			pluginsTab.display("sentinel");
			await Promise.resolve();
			await Promise.resolve();

			checkboxWrapper.click();
			await Promise.resolve();

			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalled();


			await vi.advanceTimersByTimeAsync(2000);
			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalledWith("app:reload");
		});

	})

	describe("snippet commands", () => {
		it("snippet bisect does not schedule app restart even when setting enabled as obsidian refreshes CSS automatically", async () => {
			const { plugin, fakeApp } = createPlugin(
				["a", "b", "c", "d"],
				["a", "b", "c", "d"],
				[],
				["s1", "s2", "s3", "s4"],
				["s1", "s2", "s3", "s4"],
			);
			await plugin.onload();
			plugin.settings.reloadAfterPluginChanges = true;

			const startBisect = getCommand(plugin, "snippet-start-bisect");
			const answerYes = getCommand(plugin, "snippet-answer-yes");

			await startBisect();
			await answerYes();

			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalled();
			expect(fakeApp.commands.executeCommandById).not.toHaveBeenCalledWith("app:reload");
		});
	});

});
