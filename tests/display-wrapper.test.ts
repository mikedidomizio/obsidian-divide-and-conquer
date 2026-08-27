import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import divideAndConquer from "../src/main";

/**
 * Divide and Conquer puts its bulk controls onto Obsidian's settings pages by wrapping the
 * method that renders them. Which method that is changed in 1.13, and so did where the CSS
 * snippets live, so these tests walk the same user flow through both eras.
 *
 * Both breakages were silent. A plugin wrapping only `display()` kept working on 1.13 in the
 * sense that nothing threw — the hook simply never ran again. And the snippets moved behind a
 * sub-page opened through `app.setting.openPage()`, a throwaway object with its own container
 * that the tab hooks never see.
 *
 * Also pinned here: rendering must not reload. `reload()` tells Obsidian the plugin list
 * changed, which is what triggers the next render — so reloading from the render hook spins
 * forever.
 */

/** [what the user is running, the method it draws tabs with, the page event that proves it drew] */
const OBSIDIAN_ERAS = [
	["Obsidian 1.13+", "renderTab", "render"],
	["Obsidian 1.12 and earlier", "display", "display"],
] as const;

type Era = (typeof OBSIDIAN_ERAS)[number][1];

/**
 * A settings tab as the given Obsidian era builds it. `pageEvents` records what happened to the
 * page, so a test can assert the sequence the user actually goes through.
 */
function createSettingsTab(id: string, pageEvents: string[], drawnBy: Era, drawBody?: (containerEl: HTMLElement) => void) {
	const containerEl = document.createElement("div");
	const tab: Record<string, unknown> = {
		id,
		heading: "",
		containerEl,
		reload: vi.fn(async () => {}),
		display: vi.fn(() => {
			pageEvents.push("display");
			drawBody?.(containerEl);
		}),
	};

	if (drawnBy === "renderTab") {
		tab.renderTab = vi.fn(() => {
			pageEvents.push("render");
			drawBody?.(containerEl);
		});
		// Obsidian rebuilds the tab's definitions and draws it again.
		tab.update = vi.fn(() => (tab.renderTab as () => void)());
	}

	return tab;
}

/**
 * The CSS snippets sub-page as Obsidian 1.13 builds it: one searchable list group, one row
 * per snippet, and no heading of its own — the page title sits in the modal titlebar.
 */
function createCssSnippetsSubPage(snippets: string[], pageEvents: string[]) {
	const containerEl = document.createElement("div");
	return {
		title: "CSS snippets",
		containerEl,
		display: vi.fn(() => {
			pageEvents.push("draw page");
			containerEl.empty();
			const group = containerEl.createEl("div", { cls: "setting-group mod-list" });
			group.createEl("div", { cls: "setting-group-search" });
			const list = group.createEl("div", { cls: "setting-items" });
			for (const snippet of snippets) {
				const row = list.createEl("div", { cls: "setting-item" });
				row.createEl("div", { cls: "setting-item-name", text: snippet });
				row.createEl("div", { cls: "checkbox-container" });
			}
		}),
	};
}

/** Appearance as Obsidian 1.12 drew it: the snippets listed inline under a heading. */
function drawLegacyAppearancePage(containerEl: HTMLElement) {
	containerEl.empty();
	containerEl.createEl("div", { cls: "setting-item setting-item-heading", text: "CSS snippets" });
	const row = containerEl.createEl("div", { cls: "setting-item" });
	row.createEl("div", { cls: "setting-item-name", text: "my-snippet" });
	row.createEl("div", { cls: "checkbox-container" });
}

/** Appearance as it would look if Obsidian renamed the heading out from under us. */
function drawAppearancePageWithARenamedHeading(containerEl: HTMLElement) {
	containerEl.empty();
	containerEl.createEl("div", { cls: "setting-item setting-item-heading", text: "Custom CSS" });
	const row = containerEl.createEl("div", { cls: "setting-item" });
	row.createEl("div", { cls: "setting-item-name", text: "my-snippet" });
	row.createEl("div", { cls: "checkbox-container" });
}

/**
 * Obsidian of the given era, up and running with Divide and Conquer installed.
 *
 * By default `addControls` is stubbed out, so a test can watch the order things happen in
 * without caring what gets drawn. Pass `realControls` to let it build the actual buttons and
 * assert where on the page they landed.
 */
async function obsidianRunning(
	drawnBy: Era,
	options: {
		realControls?: boolean;
		appearanceBody?: (containerEl: HTMLElement) => void;
		installedPlugins?: string[];
		installedSnippets?: string[];
	} = {},
) {
	const pageEvents: string[] = [];
	const communityPluginsTab = createSettingsTab("community-plugins", pageEvents, drawnBy);
	const appearanceTab = createSettingsTab("appearance", pageEvents, drawnBy, options.appearanceBody);

	const reloadPlugins = vi.fn(async () => {
		pageEvents.push("reload");
	});
	const reloadSnippets = vi.fn(async () => {
		pageEvents.push("reload");
	});

	const fakeApp = {
		plugins: {
			manifests: Object.fromEntries(
				(options.installedPlugins ?? []).map((name) => [name, { id: name, name, version: "1.0.0" }]),
			),
			enabledPlugins: new Set<string>(),
			enablePluginAndSave: vi.fn(async () => {}),
			disablePluginAndSave: vi.fn(async () => {}),
			initialize: vi.fn(async () => {}),
			loadManifests: reloadPlugins,
		},
		customCss: {
			snippets: (options.installedSnippets ?? []) as string[],
			enabledSnippets: new Set<string>(),
			setCssEnabledStatus: vi.fn(),
			loadSnippets: reloadSnippets,
		},
		commands: { executeCommandById: vi.fn() },
		workspace: { onLayoutReady: vi.fn() },
		setting: {
			settingTabs: [communityPluginsTab, appearanceTab],
			// Only 1.13 has sub-pages; on 1.12 there is no such method to hook.
			...(drawnBy === "renderTab"
				? {
					openPage(page: { containerEl: HTMLElement; display: () => void }) {
						pageEvents.push("open page");
						page.containerEl.empty();
						page.display();
					},
				}
				: {}),
		},
	};

	const plugin = new divideAndConquer(fakeApp as any, {} as any);
	plugin.saveData = vi.fn(async () => {});
	if (!options.realControls) {
		vi.spyOn(plugin as any, "addControls").mockImplementation(() => {
			pageEvents.push("controls");
		});
	}

	await plugin.onload();

	return {
		plugin,
		pageEvents,
		communityPluginsTab,
		appearanceTab,
		reloadPlugins,
		reloadSnippets,
		/** The user clicks into a settings tab, and Obsidian draws it the way this era draws it. */
		userOpens: (tab: Record<string, unknown>) => {
			(tab[drawnBy] as () => void)();
		},
		/** The user clicks a row that leads to a sub-page, and Obsidian opens it. */
		userClicksInto: (page: { containerEl: HTMLElement; display: () => void }) => {
			(fakeApp.setting as { openPage: (p: unknown) => void }).openPage(page);
		},
		/** The user clicks one of our bulk buttons, which finishes by refreshing the page. */
		userRunsABulkOperation: (mode: "plugins" | "snippets") => plugin.mode2Refresh.get(mode)?.(),
		/** Whether the bulk toggle buttons are still lit up for that mode. */
		bulkToggleButtonsLitFor: (mode: "plugins" | "snippets") =>
			(plugin as any).getBulkToggleModeState(mode),
		/** Let anything the page kicked off asynchronously finish. */
		waitForPendingWork: () => new Promise((resolve) => setTimeout(resolve, 0)),
	};
}

describe("our bulk controls on Obsidian's settings pages", () => {
	beforeEach(() => {
		(globalThis as any).activeDocument = document;
	});

	it.each(OBSIDIAN_ERAS)(
		"on %s, the user opens Community plugins and our controls are there",
		async (_era, drawnBy, drawn) => {
			const obsidian = await obsidianRunning(drawnBy);

			obsidian.userOpens(obsidian.communityPluginsTab);

			expect(obsidian.plugin.mode).toBe("plugins");
			expect(obsidian.pageEvents).toEqual([drawn, "controls"]);
		},
	);

	it.each(OBSIDIAN_ERAS)(
		"on %s, the user opens Appearance and our controls are there",
		async (_era, drawnBy, drawn) => {
			const obsidian = await obsidianRunning(drawnBy);

			obsidian.userOpens(obsidian.appearanceTab);

			expect(obsidian.plugin.mode).toBe("snippets");
			expect(obsidian.pageEvents).toEqual([drawn, "controls"]);
		},
	);

	it("opening a tab never reloads, because a reload is what triggers the next draw", async () => {
		const obsidian = await obsidianRunning("renderTab");

		obsidian.userOpens(obsidian.communityPluginsTab);
		await obsidian.waitForPendingWork();

		expect(obsidian.reloadPlugins).not.toHaveBeenCalled();
		expect(obsidian.pageEvents).not.toContain("reload");
	});

	it.each([
		["plugins", "communityPluginsTab"],
		["snippets", "appearanceTab"],
	] as const)(
		"the user runs a bulk %s operation, and the page reloads and redraws with our controls",
		async (mode, tabName) => {
			const obsidian = await obsidianRunning("renderTab");
			obsidian.userOpens(obsidian[tabName]);
			obsidian.pageEvents.length = 0;

			obsidian.userRunsABulkOperation(mode);
			await obsidian.waitForPendingWork();

			const reload = mode === "plugins" ? obsidian.reloadPlugins : obsidian.reloadSnippets;
			expect(reload).toHaveBeenCalledTimes(1);
			expect(obsidian.pageEvents).toEqual(["reload", "render", "controls"]);
		},
	);

	it.each([
		["plugin", "plugins", "communityPluginsTab"],
		["snippet", "snippets", "appearanceTab"],
	] as const)(
		"the user toggles one %s by hand after a redraw, and the bulk buttons stop being lit",
		async (_item, mode, tabName) => {
			const obsidian = await obsidianRunning("renderTab");
			const tab = obsidian[tabName];

			// that item's own toggle, sitting in the tab like any other row
			const itemToggle = document.createElement("div");
			itemToggle.className = "checkbox-container";
			(tab.containerEl as HTMLElement).appendChild(itemToggle);

			(obsidian.plugin as any).mode2BulkToggleMode.set(mode, "enable");
			obsidian.userOpens(tab);
			await obsidian.waitForPendingWork();

			expect(obsidian.bulkToggleButtonsLitFor(mode)).toBe("enable");

			itemToggle.click();

			expect(obsidian.bulkToggleButtonsLitFor(mode)).toBeNull();
		},
	);

	describe("CSS snippets, which Obsidian 1.13 moved behind a sub-page", () => {
		it("the user clicks into Appearance > CSS snippets and our controls are on that page", async () => {
			const obsidian = await obsidianRunning("renderTab", { realControls: true });
			const snippetsPage = createCssSnippetsSubPage(["a.css", "b.css"], obsidian.pageEvents);

			obsidian.userOpens(obsidian.appearanceTab);
			obsidian.userClicksInto(snippetsPage);

			expect(obsidian.plugin.mode).toBe("snippets");
			const controls = snippetsPage.containerEl.querySelectorAll(".dac-controls-root");
			expect(controls).toHaveLength(1);
			// at the top of the snippets group, above the search box and the list of snippets
			const group = snippetsPage.containerEl.querySelector(".setting-group");
			expect(controls[0]?.parentElement).toBe(group);
			expect(group?.firstElementChild).toBe(controls[0]);
			expect(controls[0]?.querySelectorAll("button").length).toBeGreaterThan(0);
		});

		it("Obsidian redraws the open sub-page and the controls come back exactly once", async () => {
			const obsidian = await obsidianRunning("renderTab", { realControls: true });
			const snippetsPage = createCssSnippetsSubPage(["a.css"], obsidian.pageEvents);
			obsidian.userClicksInto(snippetsPage);

			// what Obsidian does to an open sub-page after anything changes under it
			snippetsPage.display();

			expect(snippetsPage.containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(1);
		});

		it("the user toggles a snippet by hand on the sub-page, and the bulk buttons stop being lit", async () => {
			const obsidian = await obsidianRunning("renderTab", { realControls: true });
			const snippetsPage = createCssSnippetsSubPage(["a.css"], obsidian.pageEvents);
			(obsidian.plugin as any).mode2BulkToggleMode.set("snippets", "enable");

			obsidian.userClicksInto(snippetsPage);
			expect(obsidian.bulkToggleButtonsLitFor("snippets")).toBe("enable");

			snippetsPage.containerEl.querySelector<HTMLElement>(".checkbox-container")?.click();

			expect(obsidian.bulkToggleButtonsLitFor("snippets")).toBeNull();
		});

		it("clicking into a sub-page we do not own leaves it alone", async () => {
			const obsidian = await obsidianRunning("renderTab", { realControls: true });
			const fontsPage = createCssSnippetsSubPage(["a.css"], obsidian.pageEvents);
			fontsPage.title = "Interface font";

			obsidian.userOpens(obsidian.communityPluginsTab);
			obsidian.userClicksInto(fontsPage);

			expect(fontsPage.containerEl.querySelector(".dac-controls-root")).toBeNull();
			// and we did not quietly switch modes out from under the page the user came from
			expect(obsidian.plugin.mode).toBe("plugins");
		});

		it("on Obsidian 1.12 and earlier the snippets are still on the Appearance page, under its heading", async () => {
			const obsidian = await obsidianRunning("display", {
				realControls: true,
				appearanceBody: drawLegacyAppearancePage,
			});

			obsidian.userOpens(obsidian.appearanceTab);

			const containerEl = obsidian.appearanceTab.containerEl as HTMLElement;
			const controls = containerEl.querySelectorAll(".dac-controls-root");
			expect(controls).toHaveLength(1);
			// directly after the "CSS snippets" heading, where they have always gone
			const heading = containerEl.querySelector(".setting-item-heading");
			expect(heading?.nextElementSibling).toBe(controls[0]);
		});
	});

	describe("when Obsidian moves the goalposts again", () => {
		let warnings: string[];

		beforeEach(() => {
			warnings = [];
			vi.spyOn(console, "warn").mockImplementation((message: string) => {
				warnings.push(message);
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("the console says the controls could not be placed, rather than nothing happening", async () => {
			const obsidian = await obsidianRunning("renderTab", {
				realControls: true,
				installedSnippets: ["my-snippet"],
				appearanceBody: drawAppearancePageWithARenamedHeading,
			});

			obsidian.userOpens(obsidian.appearanceTab);

			expect((obsidian.appearanceTab.containerEl as HTMLElement).querySelector(".dac-controls-root")).toBeNull();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("CSS snippets");
			expect(warnings[0]).toContain("snippets");
		});

		it("and says it once, however many times the page is redrawn", async () => {
			const obsidian = await obsidianRunning("renderTab", {
				realControls: true,
				installedSnippets: ["my-snippet"],
				appearanceBody: drawAppearancePageWithARenamedHeading,
			});

			obsidian.userOpens(obsidian.appearanceTab);
			obsidian.userOpens(obsidian.appearanceTab);
			obsidian.userOpens(obsidian.appearanceTab);

			expect(warnings).toHaveLength(1);
		});

		it("but stays quiet on a page that lists nothing we manage", async () => {
			// Appearance on 1.13 is exactly this: the snippets it used to list have moved to a
			// sub-page, so having nowhere to put our controls here is the normal state of things.
			const obsidian = await obsidianRunning("renderTab", {
				realControls: true,
				installedSnippets: ["my-snippet"],
			});

			obsidian.userOpens(obsidian.appearanceTab);

			expect(warnings).toEqual([]);
		});
	});

	describe("when the user disables Divide and Conquer", () => {
		// Obsidian unhooks a plugin's patches on unload, but leaves whatever it put into the
		// DOM exactly where it is. That was the bug these cover: the buttons stayed on the
		// settings page after the user switched the plugin off, still wired to a plugin that
		// was no longer running.
		it.each(OBSIDIAN_ERAS)(
			"%s takes the controls off a settings tab",
			async (_era, drawnBy) => {
				const obsidian = await obsidianRunning(drawnBy, {
					realControls: true,
					appearanceBody: drawLegacyAppearancePage,
				});
				obsidian.userOpens(obsidian.appearanceTab);
				const containerEl = obsidian.appearanceTab.containerEl as HTMLElement;
				expect(containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(1);

				obsidian.plugin.onunload();

				expect(containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(0);
			},
		);

		it("takes the controls off the CSS snippets sub-page too", async () => {
			const obsidian = await obsidianRunning("renderTab", { realControls: true });
			const snippetsPage = createCssSnippetsSubPage(["a.css"], obsidian.pageEvents);
			obsidian.userClicksInto(snippetsPage);
			expect(snippetsPage.containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(1);

			obsidian.plugin.onunload();

			expect(snippetsPage.containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(0);
		});

		it("clears them from every page at once, not just the one on screen", async () => {
			const obsidian = await obsidianRunning("renderTab", {
				realControls: true,
				appearanceBody: drawLegacyAppearancePage,
			});
			obsidian.userOpens(obsidian.appearanceTab);
			const snippetsPage = createCssSnippetsSubPage(["a.css"], obsidian.pageEvents);
			obsidian.userClicksInto(snippetsPage);
			const appearanceContainer = obsidian.appearanceTab.containerEl as HTMLElement;
			expect(appearanceContainer.querySelectorAll(".dac-controls-root")).toHaveLength(1);
			expect(snippetsPage.containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(1);

			obsidian.plugin.onunload();

			expect(appearanceContainer.querySelectorAll(".dac-controls-root")).toHaveLength(0);
			expect(snippetsPage.containerEl.querySelectorAll(".dac-controls-root")).toHaveLength(0);
		});
	});
});
