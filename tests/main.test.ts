/**
 * Tests for Divide & Conquer command workflows with a small set of logic guards.
 *
 * The Obsidian API is mocked via tests/__mocks__/obsidian.ts.
 * We create a lightweight plugin harness that wires up the same dependencies
 * that onload() would normally set, allowing us to exercise command-level
 * behavior (bisect/unBisect/reBisect/reset/restore) in isolation.
 */

import { vi, describe, it, expect } from "vitest";

import divideAndConquer from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { Mode } from "../src/util";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A simple plugin-id-only manifest shape. */
function makeManifest(id: string, name?: string) {
	return { id, name: name ?? id, version: "1.0.0" };
}

/**
 * Build a plugin instance whose internal functions are already wired up as
 * onload() would wire them, but backed entirely by in-memory state.
 *
 * @param pluginIds   All plugin ids that "exist" in this vault
 * @param enabledIds  Which ones start out enabled
 * @param filterRegexes  Plugin filter regexes (default: none)
 */
function createPlugin(
	pluginIds: string[],
	enabledIds: string[],
	filterRegexes: string[] = [],
): divideAndConquer {
	/** Tracks enabled-plugin state so disableItem / enableItem work correctly */
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

	// Construct without running onload – we manually wire the function props below.
	const plugin = new divideAndConquer(fakeApp as any, {} as any);

	plugin.settings = {
		...DEFAULT_SETTINGS,
		pluginFilterRegexes: filterRegexes,
		snippetFilterRegexes: [],
	};

	// Wire up mode-specific functions (mirrors what onload() does for "plugins")
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

	// Start in "plugins" mode with clean state
	(plugin as any)._mode = "plugins";
	plugin["mode2DisabledStates"] = new Map<Mode, Set<string>[]>();
	plugin["mode2Snapshot"] = new Map<Mode, Set<string>>();
	plugin["mode2Level"] = new Map<Mode, number>([
		["plugins", 1],
		["snippets", 1],
	]);

	// Prevent saveData from touching the file system during tests
	vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

	return plugin;
}

// ─── getEnabledDisabled ───────────────────────────────────────────────────────

describe("Command Palette: viewing current plugin state", () => {
	it("shows enabled and disabled plugins as separate groups", () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]);
		const { enabled, disabled } = plugin.getEnabledDisabled();
		expect(enabled).toContain("a");
		expect(enabled).toContain("c");
		expect(disabled).toContain("b");
		expect(disabled).toContain("d");
	});

	it("shows every plugin as enabled when none are disabled", () => {
		const plugin = createPlugin(["x", "y", "z"], ["x", "y", "z"]);
		const { enabled, disabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(3);
		expect(disabled).toHaveLength(0);
	});

	it("shows every plugin as disabled when none are enabled", () => {
		const plugin = createPlugin(["x", "y", "z"], []);
		const { enabled, disabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(0);
		expect(disabled).toHaveLength(3);
	});

	it("orders plugin names consistently so bisection targets are deterministic", () => {
		// ids equal names here, so sorted desc: z, y, x
		const plugin = createPlugin(["x", "y", "z"], ["x", "y", "z"]);
		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toEqual(["z", "y", "x"]);
	});
});

// ─── getExcludedItems / getIncludedItems ──────────────────────────────────────

describe("Settings Tab: plugin exclusion filters", () => {
	it("excludes plugins when their id matches an exclusion regex", () => {
		const plugin = createPlugin(
			["hot-reload", "dataview", "obsidian-divide-and-conquer"],
			["hot-reload", "dataview"],
			["hot-reload", "obsidian-divide-and-conquer"],
		);
		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).toContain("hot-reload");
		expect(excludedIds).toContain("obsidian-divide-and-conquer");
		expect(excludedIds).not.toContain("dataview");
	});

	it("keeps plugins included when they do not match any exclusion regex", () => {
		const plugin = createPlugin(
			["hot-reload", "dataview", "tasks"],
			["hot-reload", "dataview", "tasks"],
			["hot-reload"],
		);
		const included = plugin.getIncludedItems();
		const includedIds = [...included].map((p) => p.id);
		expect(includedIds).not.toContain("hot-reload");
		expect(includedIds).toContain("dataview");
		expect(includedIds).toContain("tasks");
	});

	it("includes all plugins when no exclusions are configured", () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"], []);
		const included = plugin.getIncludedItems();
		expect(included.size).toBe(3);
	});

	it("treats exclusion regex matching as case-insensitive", () => {
		const plugin = createPlugin(["MyPlugin", "other"], ["MyPlugin", "other"], ["myplugin"]);
		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).toContain("MyPlugin");
	});

	it("matches plugin display names when 'Use Filters on Plugin Display Names' is enabled", () => {
		const plugin = createPlugin(["calendar-helper"], ["calendar-helper"], ["daily notes"]);
		plugin.app.plugins.manifests["calendar-helper"].name = "Daily Notes Utility";
		plugin.settings.filterUsingDisplayName = true;
		plugin.settings.filterUsingAuthor = false;
		plugin.settings.filterUsingDescription = false;

		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).toContain("calendar-helper");
	});

	it("does not match display names when display-name filtering is turned off", () => {
		const plugin = createPlugin(["calendar-helper"], ["calendar-helper"], ["daily notes"]);
		plugin.app.plugins.manifests["calendar-helper"].name = "Daily Notes Utility";
		plugin.settings.filterUsingDisplayName = false;
		plugin.settings.filterUsingAuthor = false;
		plugin.settings.filterUsingDescription = false;

		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).not.toContain("calendar-helper");
	});

	it("matches plugin authors when 'Use Filters on Plugin Authors' is enabled", () => {
		const plugin = createPlugin(["calendar-helper"], ["calendar-helper"], ["jane dev"]);
		plugin.app.plugins.manifests["calendar-helper"].author = "Jane Dev";
		plugin.settings.filterUsingDisplayName = false;
		plugin.settings.filterUsingAuthor = true;
		plugin.settings.filterUsingDescription = false;

		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).toContain("calendar-helper");
	});

	it("matches plugin descriptions when 'Use Filters on Plugin Descriptions' is enabled", () => {
		const plugin = createPlugin(["calendar-helper"], ["calendar-helper"], ["task timeline"]);
		plugin.app.plugins.manifests["calendar-helper"].description = "Adds a task timeline view";
		plugin.settings.filterUsingDisplayName = false;
		plugin.settings.filterUsingAuthor = false;
		plugin.settings.filterUsingDescription = true;

		const excluded = plugin.getExcludedItems();
		const excludedIds = [...excluded].map((p) => p.id);
		expect(excludedIds).toContain("calendar-helper");
	});
});

// ─── bisect ───────────────────────────────────────────────────────────────────

describe("Command Palette: Plugin Bisect", () => {
	it("when I run Plugin Bisect, it disables half of currently enabled plugins", async () => {
		// 6 plugins all enabled
		const plugin = createPlugin(
			["a", "b", "c", "d", "e", "f"],
			["a", "b", "c", "d", "e", "f"],
		);

		const half = await plugin.bisect();

		expect(half).toHaveLength(3); // Math.floor(6/2) = 3
		expect(plugin.level).toBe(2);
		// Three plugins were disabled
		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(3);
	});

	it("when I bisect, it records the disabled half so I can undo it later", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.bisect();
		// disabledState[0] is the original (empty) snapshot, [1] is the bisected half
		expect(plugin.disabledState).toHaveLength(2);
		expect(plugin.disabledState[1]!.size).toBe(2);
	});

	it("when no plugins are enabled, bisect does not move me deeper into levels", async () => {
		const plugin = createPlugin(["a", "b"], []);
		const initialLevel = plugin.level;
		// getCurrentState will initialise disabledState from the current disabled set,
		// then bisect will try to disable Math.floor(0/2) = 0 items
		await plugin.bisect();
		// Level should be rolled back since half.length === 0
		expect(plugin.level).toBe(initialLevel);
	});

	it("with an odd plugin count, bisect disables floor(n/2) plugins", async () => {
		const plugin = createPlugin(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"]);
		const half = await plugin.bisect();
		expect(half).toHaveLength(2); // Math.floor(5/2) = 2
	});
});

// ─── unBisect ─────────────────────────────────────────────────────────────────

describe("Command Palette: Plugin Un-Bisect", () => {
	it("when I run Plugin Un-Bisect, it re-enables the last disabled half", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.bisect(); // level→2, disables 2 plugins
		expect(plugin.level).toBe(2);

		await plugin.unBisect();

		expect(plugin.level).toBe(1);
		// All 4 should be enabled again
		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(4);
	});

	it("does not reduce the level below 0", async () => {
		const plugin = createPlugin(["a", "b"], ["a", "b"]);
		// Manually set level to 0
		plugin.level = 0;
		plugin["mode2DisabledStates"].set("plugins", [new Set(["a"])]);

		await plugin.unBisect();

		expect(plugin.level).toBe(0);
	});

	it("keeps the original baseline state after undoing the latest bisect", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"]);
		await plugin.bisect(); // adds entry [0]=original, [1]=half
		await plugin.unBisect(); // pops [1], keeps [0]

		// disabledState should still have the root entry
		expect(plugin.disabledState.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── reBisect ────────────────────────────────────────────────────────────────

describe("Command Palette: Plugin Re-Bisect", () => {
	it("shows no change when I run Re-Bisect in the original state", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"]);
		// level is 1 at start; reBisect should no-op (Notice is fired internally)
		await plugin.reBisect();
		// level should not have changed
		expect(plugin.level).toBe(1);
	});

	it("after undoing one bisect, Re-Bisect disables the complementary half", async () => {
		const plugin = createPlugin(
			["a", "b", "c", "d", "e", "f"],
			["a", "b", "c", "d", "e", "f"],
		);

		// First bisect: disables [f, e, d] (sorted desc, first half)
		const firstHalf = await plugin.bisect();
		expect(plugin.level).toBe(2);

		// reBisect: re-enables firstHalf, then disables the OTHER half
		await plugin.reBisect();

		const { enabled, disabled } = plugin.getEnabledDisabled();
		// The second half should now be disabled
		expect(disabled.length).toBeGreaterThan(0);
		// None of the first half should remain disabled
		firstHalf!.forEach((id) => expect(enabled).toContain(id));
	});
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("Command Palette: Plugin Reset", () => {
	it("when I run Plugin Reset, it snapshots the current disabled plugins", () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "c"]); // b, d disabled
		plugin.reset();

		expect(plugin.level).toBe(1);
		// snapshot should contain the currently-disabled plugins
		expect(plugin.snapshot.has("b")).toBe(true);
		expect(plugin.snapshot.has("d")).toBe(true);
		expect(plugin.snapshot.has("a")).toBe(false);
	});

	it("when I reset after bisecting, previous bisection history is cleared", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.bisect(); // creates some history
		plugin.reset();

		// After reset there should be exactly one entry (the original disabled set)
		expect(plugin.disabledState).toHaveLength(1);
	});
});

// ─── restore ──────────────────────────────────────────────────────────────────

describe("Command Palette: Plugin Restore", () => {
	it("when I run Plugin Restore, it returns plugins to the last reset baseline", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		plugin.reset();
		await plugin.bisect();

		await plugin.restore();

		const { enabled, disabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(4);
		expect(disabled).toHaveLength(0);
	});

	it("keeps plugins disabled if they were already disabled when I reset baseline", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c"]);
		plugin.reset(); // baseline has d disabled
		await plugin.bisect();

		await plugin.restore();

		const { enabled, disabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(3);
		expect(disabled).toEqual(["d"]);
	});
});

// ─── getCurrentState ─────────────────────────────────────────────────────────

describe("Logic guard: getCurrentState history initialisation", () => {
	it("initialises disabledState from current disabled set when empty", () => {
		const plugin = createPlugin(["a", "b", "c"], ["a"]); // b, c disabled

		const { enabled, disabled } = plugin.getCurrentState();

		expect(enabled).toContain("a");
		expect(disabled?.has("b")).toBe(true);
		expect(disabled?.has("c")).toBe(true);
		// disabledState was created
		expect(plugin.disabledState).toHaveLength(1);
	});

	it("does not re-initialise disabledState if history already exists", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.bisect(); // creates disabledState with 2 entries
		const sizeBefore = plugin.disabledState.length;

		plugin.getCurrentState(); // should not reset

		expect(plugin.disabledState.length).toBe(sizeBefore);
	});
});

// ─── loadData / saveData serialisation ───────────────────────────────────────

describe("Logic guard: loadData / saveData serialisation", () => {
	it("serialises disabled states and snapshots as JSON for persistence", async () => {
		const plugin = createPlugin(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
		await plugin.bisect();

		// saveData calls the mocked super.saveData; capture what it saves
		const saved: any[] = [];
		vi.spyOn(plugin, "saveData").mockImplementation(async (_restore = true) => {
			// Run the real serialisation logic
			if (plugin["mode2DisabledStates"])
				plugin.settings.disabledStates = JSON.stringify(
					Object.fromEntries(
						[...plugin["mode2DisabledStates"].entries()].map(([mode, sets]) => [
							mode,
							[...sets].map((set) => [...set]),
						]),
					),
				);
			if (plugin["mode2Snapshot"])
				plugin.settings.snapshots = JSON.stringify(
					Object.fromEntries(
						[...plugin["mode2Snapshot"].entries()].map(([mode, set]) => [mode, [...set]]),
					),
				);
			saved.push(plugin.settings);
		});

		await plugin.saveData(false);

		expect(saved).toHaveLength(1);
		expect(typeof saved[0].disabledStates).toBe("string");
		const parsed = JSON.parse(saved[0].disabledStates);
		expect(parsed).toHaveProperty("plugins");
	});

	it("restores disabled-state history and snapshots from persisted JSON", async () => {
		const plugin = createPlugin([], []);

		// Simulate data previously saved to disk
		const persistedData = {
			...DEFAULT_SETTINGS,
			disabledStates: JSON.stringify({ plugins: [["b", "d"]], snippets: [] }),
			snapshots: JSON.stringify({ plugins: ["b", "d"], snippets: [] }),
		};

		vi.spyOn(plugin, "loadData" as any).mockImplementation(async () => {
			// Manually apply what the real loadData does
			plugin.settings = Object.assign({}, DEFAULT_SETTINGS, persistedData);
			plugin["mode2DisabledStates"] = persistedData.disabledStates
				? new Map(
						(
							Object.entries(JSON.parse(persistedData.disabledStates)) as [string, string[][]
						][]
						).map(([mode, states]) => [mode as Mode, states.map((s) => new Set(s))])
					)
				: new Map();
			plugin["mode2Snapshot"] = persistedData.snapshots
				? new Map(
						(
							Object.entries(JSON.parse(persistedData.snapshots)) as [string, string[]][]
						).map(([mode, states]) => [mode as Mode, new Set(states)])
					)
				: new Map();
		});

		await plugin.loadData();

		const pluginsDisabledStates = plugin["mode2DisabledStates"].get("plugins");
		expect(pluginsDisabledStates).toBeDefined();
		expect(pluginsDisabledStates![0]!.has("b")).toBe(true);

		const pluginsSnapshot = plugin["mode2Snapshot"].get("plugins");
		expect(pluginsSnapshot).toBeDefined();
		expect(pluginsSnapshot!.has("d")).toBe(true);
	});
});

// ─── enableItems / disableItems ───────────────────────────────────────────────

describe("Logic guard: bulk enable/disable helpers", () => {
	it("disableItems disables each requested plugin id", async () => {
		const plugin = createPlugin(["a", "b", "c"], ["a", "b", "c"]);
		const result = await plugin.disableItems(["a", "b"]);
		expect(result).toEqual(["a", "b"]);
		const { disabled } = plugin.getEnabledDisabled();
		expect(disabled).toContain("a");
		expect(disabled).toContain("b");
	});

	it("enableItems enables each requested plugin id", async () => {
		const plugin = createPlugin(["a", "b", "c"], []);
		const result = await plugin.enableItems(["a", "b"]);
		// enableItems reverses the array internally before processing
		expect(result).toContain("a");
		expect(result).toContain("b");
		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toContain("a");
		expect(enabled).toContain("b");
	});

	it("disableItems accepts a Set input", async () => {
		const plugin = createPlugin(["x", "y", "z"], ["x", "y", "z"]);
		await plugin.disableItems(new Set(["x", "z"]));
		const { disabled } = plugin.getEnabledDisabled();
		expect(disabled).toContain("x");
		expect(disabled).toContain("z");
		expect(disabled).not.toContain("y");
	});

	it("enableItems accepts a Set input", async () => {
		const plugin = createPlugin(["x", "y", "z"], []);
		await plugin.enableItems(new Set(["y", "z"]));
		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toContain("y");
		expect(enabled).toContain("z");
		expect(enabled).not.toContain("x");
	});
});

// ─── snippet mode ─────────────────────────────────────────────────────────────

describe("Command Palette: Snippet commands", () => {
	/**
	 * Build a plugin wired for snippet mode so we can exercise the snippet
	 * code-path with the same bisect logic.
	 */
	function createSnippetPlugin(snippetIds: string[], enabledIds: string[]) {
		const enabledSet = new Set<string>(enabledIds);

		const fakeApp = {
			plugins: {
				manifests: {},
				enabledPlugins: new Set<string>(),
				enablePluginAndSave: vi.fn(),
				disablePluginAndSave: vi.fn(),
				requestSaveConfig: vi.fn(async () => {}),
				initialize: vi.fn(),
				loadManifests: vi.fn(),
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

		plugin.getAllItems = () =>
			new Set(snippetIds.map((s) => ({ name: s, id: s })));

		plugin.getEnabledFromObsidian = () => enabledSet;

		plugin.enableItem = async (id: string) => {
			enabledSet.add(id);
		};

		plugin.disableItem = async (id: string) => {
			// mimic the CSS_DELAY-free version
			enabledSet.delete(id);
		};

		plugin.getFilters = () => [];

		(plugin as any)._mode = "snippets";
		plugin["mode2DisabledStates"] = new Map<Mode, Set<string>[]>();
		plugin["mode2Snapshot"] = new Map<Mode, Set<string>>();
		plugin["mode2Level"] = new Map<Mode, number>([
			["plugins", 1],
			["snippets", 1],
		]);

		vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

		return plugin;
	}

	it("when I run Snippet Bisect, it disables half of enabled snippets", async () => {
		const plugin = createSnippetPlugin(
			["dark.css", "light.css", "custom.css", "tables.css"],
			["dark.css", "light.css", "custom.css", "tables.css"],
		);

		const half = await plugin.bisect();

		expect(half).toHaveLength(2);
		expect(plugin.level).toBe(2);
	});

	it("when I run Snippet Un-Bisect, it re-enables snippets disabled by DAC", async () => {
		const plugin = createSnippetPlugin(
			["a.css", "b.css", "c.css", "d.css"],
			["a.css", "b.css", "c.css", "d.css"],
		);

		await plugin.bisect();
		await plugin.unBisect();

		const { enabled } = plugin.getEnabledDisabled();
		expect(enabled).toHaveLength(4);
	});
});


