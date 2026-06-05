import { beforeEach, describe, expect, it, vi } from "vitest";

import divideAndConquer from "../src/main";

type WrappedTab = {
	id: string;
	heading: string;
	containerEl: HTMLDivElement;
	reload: () => Promise<void>;
	display: (...args: unknown[]) => void;
};

function createSettingsTab(id: string, callOrder: string[]) {
	const displayContexts: unknown[] = [];
	const displayArgs: unknown[][] = [];
	const reload = vi.fn(async () => {
		callOrder.push("reload");
	});
	const display = vi.fn(function (this: unknown, ...args: unknown[]) {
		callOrder.push("display");
		displayContexts.push(this);
		displayArgs.push(args);
	});

	return {
		tab: {
			id,
			heading: "",
			containerEl: document.createElement("div"),
			reload: reload as () => Promise<void>,
			display: display as (...args: unknown[]) => void,
		} as WrappedTab,
		reload,
		display,
		displayContexts,
		displayArgs,
	};
}

async function flushWrappedDisplay(reload: ReturnType<typeof vi.fn>) {
	const latestReload = reload.mock.results.at(-1)?.value;
	await latestReload;
	await Promise.resolve();
}

describe("overrideDisplay", () => {
	beforeEach(() => {
		(globalThis as any).activeDocument = document;
	});

	it.each([
		{ id: "community-plugins", mode: "plugins" as const },
		{ id: "appearance", mode: "snippets" as const },
	])("wraps the $mode settings tab display so reload runs first, then the original display, then UI controls are restored", async ({ id, mode }) => {
		const callOrder: string[] = [];
		const pluginTab = createSettingsTab("community-plugins", callOrder);
		const snippetTab = createSettingsTab("appearance", callOrder);
		const reloadPlugins = vi.fn(async () => {
			callOrder.push("reload");
		});
		const reloadSnippets = vi.fn(async () => {
			callOrder.push("reload");
		});
		const fakeApp = {
			plugins: {
				manifests: {},
				enabledPlugins: new Set<string>(),
				enablePluginAndSave: vi.fn(async () => {}),
				disablePluginAndSave: vi.fn(async () => {}),
				initialize: vi.fn(async () => {}),
				loadManifests: reloadPlugins,
			},
			customCss: {
				snippets: [] as string[],
				enabledSnippets: new Set<string>(),
				setCssEnabledStatus: vi.fn(),
				loadSnippets: reloadSnippets,
			},
			commands: {
				executeCommandById: vi.fn(),
			},
			workspace: {
				onLayoutReady: vi.fn(),
			},
			setting: {
				settingTabs: [pluginTab.tab, snippetTab.tab],
			},
		};

		const plugin = new divideAndConquer(fakeApp as any, {} as any);
		plugin.saveData = vi.fn(async () => {});
		vi.spyOn(plugin as any, "addControls").mockImplementation(() => {
			callOrder.push("controls");
		});
		vi.spyOn(plugin as any, "colorizeIgnoredToggles").mockImplementation(() => {
			callOrder.push("colorize");
		});

		await plugin.onload();

		const target = id === "community-plugins" ? pluginTab : snippetTab;
		const reload = mode === "plugins" ? reloadPlugins : reloadSnippets;
		target.tab.display("sentinel");
		await flushWrappedDisplay(reload);

		expect(plugin.mode).toBe(mode);
		expect(typeof plugin.mode2Refresh.get(mode)).toBe("function");

		// reload occurs first, then display, then controls are added, then colorization occurs
		expect(reload).toHaveBeenCalledTimes(1);
		expect(target.display).toHaveBeenCalledTimes(1);
		expect(target.displayContexts).toEqual([target.tab]);
		expect(callOrder).toEqual(["reload", "display", "controls", "colorize"]);

		const firstCallArgs = target.displayArgs[0];
		plugin.mode2Refresh.get(mode)?.();
		await flushWrappedDisplay(reload);

		expect(reload).toHaveBeenCalledTimes(2);
		expect(target.display).toHaveBeenCalledTimes(2);
		expect(target.displayContexts).toEqual([target.tab, target.tab]);
		expect(target.displayArgs[1]).toEqual(firstCallArgs);
		expect(callOrder).toEqual([
			"reload",
			"display",
			"controls",
			"colorize",
			"reload",
			"display",
			"controls",
			"colorize",
		]);
	});

	it.each([
		{ id: "community-plugins", mode: "plugins" as const },
		{ id: "appearance", mode: "snippets" as const },
	])("manually toggling a $mode will reset bulk toggle buttons getting reset to ensure enable/disable state is reset", async ({ id, mode }) => {
		const callOrder: string[] = [];
		const pluginTab = createSettingsTab("community-plugins", callOrder);
		const snippetTab = createSettingsTab("appearance", callOrder);
		const reloadPlugins = vi.fn(async () => {
			callOrder.push("reload");
		});
		const reloadSnippets = vi.fn(async () => {
			callOrder.push("reload");
		});
		const fakeApp = {
			plugins: {
				manifests: {},
				enabledPlugins: new Set<string>(),
				enablePluginAndSave: vi.fn(async () => {}),
				disablePluginAndSave: vi.fn(async () => {}),
				initialize: vi.fn(async () => {}),
				loadManifests: reloadPlugins,
			},
			customCss: {
				snippets: [] as string[],
				enabledSnippets: new Set<string>(),
				setCssEnabledStatus: vi.fn(),
				loadSnippets: reloadSnippets,
			},
			commands: {
				executeCommandById: vi.fn(),
			},
			workspace: {
				onLayoutReady: vi.fn(),
			},
			setting: {
				settingTabs: [pluginTab.tab, snippetTab.tab],
			},
		};

		const plugin = new divideAndConquer(fakeApp as any, {} as any);
		plugin.saveData = vi.fn(async () => {});
		vi.spyOn(plugin as any, "addControls").mockImplementation(() => {
			callOrder.push("controls");
		});
		vi.spyOn(plugin as any, "colorizeIgnoredToggles").mockImplementation(() => {
			callOrder.push("colorize");
		});

		await plugin.onload();

		const target = id === "community-plugins" ? pluginTab : snippetTab;
		const reload = mode === "plugins" ? reloadPlugins : reloadSnippets;

		// Add a fake checkbox to the tab container
		const checkboxWrapper = document.createElement("div");
		checkboxWrapper.className = "checkbox-container";
		target.tab.containerEl.appendChild(checkboxWrapper);

		// Set bulk-toggle mode to "enable"
		(plugin as any).mode2BulkToggleMode.set(mode, "enable");

		// Display the tab (which should attach the listener)
		target.tab.display("sentinel");
		await flushWrappedDisplay(reload);

		// Verify bulk-toggle mode is still set
		expect((plugin as any).getBulkToggleModeState(mode)).toBe("enable");

		// Simulate clicking the toggle
		checkboxWrapper.click();

		// Verify bulk-toggle mode was reset by the listener
		expect((plugin as any).getBulkToggleModeState(mode)).toBeNull();
	});
});




