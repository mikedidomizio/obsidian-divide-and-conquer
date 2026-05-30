import { describe, expect, it, vi } from "vitest";
import divideAndConquer from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { Modes } from "../src/util";

function createPluginForCommands() {
	const enabledSet = new Set<string>();
	const fakeApp = {
		plugins: {
			manifests: {},
			enabledPlugins: enabledSet,
			enablePluginAndSave: vi.fn(),
			disablePluginAndSave: vi.fn(),
			requestSaveConfig: vi.fn(),
			initialize: vi.fn(),
			loadManifests: vi.fn(),
		},
		customCss: {
			snippets: [] as string[],
			enabledSnippets: new Set<string>(),
			setCssEnabledStatus: vi.fn(),
			loadSnippets: vi.fn(),
		},
		commands: { executeCommandById: vi.fn() },
		workspace: { onLayoutReady: vi.fn() },
		setting: { settingTabs: [] },
	};

	const plugin = new divideAndConquer(fakeApp as any, {} as any);
	plugin.settings = { ...DEFAULT_SETTINGS };
	plugin.saveData = vi.fn(async () => {});
	(plugin as any)._mode = "plugins";
	plugin.getAllItems = () => new Set();
	plugin.getEnabledFromObsidian = () => enabledSet;
	plugin.enableItem = vi.fn(async () => {});
	plugin.disableItem = vi.fn(async () => {});
	plugin.getFilters = () => [];

	// Set up mode2Call the same way onload does, but with a simple passthrough
	plugin.mode2Call = new Map(
		Modes.map((mode) => [mode, (f: any) => async () => f.call(plugin)]),
	);

	(plugin as any).addCommands();
	return plugin;
}

describe("Command Registration", () => {
	it("registers exactly 16 commands (8 plugin + 8 snippet)", () => {
		const plugin = createPluginForCommands();
		expect((plugin as any).registeredCommands).toHaveLength(16);
	});

	it("all registered command IDs are unique", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("plugin commands use the plugin- prefix", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands
			.filter((c: any) => c.name.startsWith("Plugin"))
			.map((c: any) => c.id);
		expect(ids).toHaveLength(8);
		ids.forEach((id) => expect(id.startsWith("plugin-")).toBe(true));
	});

	it("snippet commands use the snippet- prefix", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands
			.filter((c: any) => c.name.startsWith("Snippet"))
			.map((c: any) => c.id);
		expect(ids).toHaveLength(8);
		ids.forEach((id) => expect(id.startsWith("snippet-")).toBe(true));
	});

	it("every registered command has a callback function", () => {
		const plugin = createPluginForCommands();
		(plugin as any).registeredCommands.forEach((c: any) => {
			expect(typeof c.callback).toBe("function");
		});
	});

	it("plugin commands are registered before snippet commands", () => {
		const plugin = createPluginForCommands();
		const commands: any[] = (plugin as any).registeredCommands;
		const firstPluginIndex = commands.findIndex((c) => c.id.startsWith("plugin-"));
		const lastPluginIndex = commands.findLastIndex((c) => c.id.startsWith("plugin-"));
		const firstSnippetIndex = commands.findIndex((c) => c.id.startsWith("snippet-"));
		const lastSnippetIndex = commands.findLastIndex((c) => c.id.startsWith("snippet-"));
		expect(firstPluginIndex).toBe(0);
		expect(lastPluginIndex).toBe(7);
		expect(firstSnippetIndex).toBe(8);
		expect(lastSnippetIndex).toBe(15);
	});

	it("all new bulk-toggle plugin command IDs are registered", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(ids).toContain("plugin-enable-all");
		expect(ids).toContain("plugin-enable-all-except-excluded");
		expect(ids).toContain("plugin-disable-all");
		expect(ids).toContain("plugin-disable-all-except-excluded");
	});

	it("all new bulk-toggle snippet command IDs are registered", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(ids).toContain("snippet-enable-all");
		expect(ids).toContain("snippet-enable-all-except-excluded");
		expect(ids).toContain("snippet-disable-all");
		expect(ids).toContain("snippet-disable-all-except-excluded");
	});

	it("both bisect direction commands are registered for plugins", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(ids).toContain("plugin-start-bisect");
		expect(ids).toContain("plugin-start-bisect-reverse");
	});

	it("both bisect direction commands are registered for snippets", () => {
		const plugin = createPluginForCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(ids).toContain("snippet-start-bisect");
		expect(ids).toContain("snippet-start-bisect-reverse");
	});

	it("re-calling addCommands still produces 16 unique IDs (no mutation side-effects)", () => {
		const plugin = createPluginForCommands();
		// clear and re-register
		(plugin as any).registeredCommands = [];
		(plugin as any).addCommands();
		const ids: string[] = (plugin as any).registeredCommands.map((c: any) => c.id);
		expect(ids).toHaveLength(16);
		expect(new Set(ids).size).toBe(16);
	});
});


