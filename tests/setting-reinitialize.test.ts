import { beforeEach, describe, expect, it, vi } from "vitest";

import divideAndConquer from "../src/main";

function createSettingsTab(id: string) {
	return {
		id,
		heading: "",
		containerEl: document.createElement("div"),
		reload: vi.fn(async () => {}),
		display: vi.fn(),
	};
}

function createPlugin(pluginIds: string[], enabledIds: string[]) {
	const enabledPlugins = new Set(enabledIds);
	const manifests = Object.fromEntries(pluginIds.map((id) => [id, { id, name: id, version: "1.0.0" }]));
	const fakeApp = {
		plugins: {
			manifests,
			enabledPlugins,
			enablePluginAndSave: vi.fn(async (id: string) => {
				enabledPlugins.add(id);
			}),
			disablePluginAndSave: vi.fn(async (id: string) => {
				enabledPlugins.delete(id);
			}),
			initialize: vi.fn(async () => {}),
			loadManifests: vi.fn(async () => {}),
		},
		customCss: {
			snippets: [] as string[],
			enabledSnippets: new Set<string>(),
			setCssEnabledStatus: vi.fn(),
			loadSnippets: vi.fn(async () => {}),
		},
		commands: {
			executeCommandById: vi.fn(),
		},
		workspace: {
			onLayoutReady: vi.fn(),
		},
		setting: {
			settingTabs: [createSettingsTab("community-plugins"), createSettingsTab("appearance")],
		},
	};

	const plugin = new divideAndConquer(fakeApp as any, {} as any);
	return { plugin, fakeApp };
}

function getCommand(plugin: divideAndConquer, id: string) {
	const command = (plugin as any).registeredCommands.find((c: { id: string }) => c.id === id);
	expect(command).toBeDefined();
	expect(typeof command.callback).toBe("function");
	return command.callback as () => Promise<void>;
}

beforeEach(() => {
	(globalThis as any).activeDocument = document;
});

describe("Reinitialize after plugin changes", () => {

	describe("setting enabled", () => {

		it("user changing plugins does reinitialize plugins", async () => {
			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.initializeAfterPluginChanges = true;

			const startBisect = getCommand(plugin, "plugin-start-bisect");
			const answerYes = getCommand(plugin, "plugin-answer-yes");

			await startBisect();
			await answerYes();

			// verifies both enabled/disabled paths
			expect(fakeApp.plugins.enablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.disablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.initialize).toHaveBeenCalled();
		});

	})

	describe("setting disabled", () => {

		it("user changing plugins does not reinitialize plugins", async () => {
			const { plugin, fakeApp } = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
			await plugin.onload();
			plugin.settings.initializeAfterPluginChanges = false;

			const startBisect = getCommand(plugin, "plugin-start-bisect");
			const answerYes = getCommand(plugin, "plugin-answer-yes");

			await startBisect();
			await answerYes();

			// verifies both enabled/disabled paths
			expect(fakeApp.plugins.enablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.disablePluginAndSave).toHaveBeenCalled();
			expect(fakeApp.plugins.initialize).not.toHaveBeenCalled();
		});

	})

})

