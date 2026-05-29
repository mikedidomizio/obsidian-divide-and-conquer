import { describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";

import { DACSettingsTab, DEFAULT_SETTINGS } from "../src/settings";

describe("Settings Tab", () => {
	it("renders the warning note via the Setting API", () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set()),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);
		const setNameSpy = vi.spyOn(Setting.prototype, "setName");
		const setDescSpy = vi.spyOn(Setting.prototype, "setDesc");

		// Keep this test focused on top-level static heading content.
		vi.spyOn(tab, "addTextArea").mockReturnValue({} as any);

		tab.display();

		expect(setNameSpy).toHaveBeenCalledWith("Warning");
		expect(setDescSpy).toHaveBeenCalledWith(
			"Reinitializing or Reloading may cause disabled plugins to disappear; close and open the menu to see them again.",
		);
		setNameSpy.mockRestore();
		setDescSpy.mockRestore();
	});

	it("makes the included-items textarea readonly via inputEl.setAttr so that plugins/snippets can be clicked", () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set([{ id: "plugin-a" }])),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);

		const setAttr = vi.fn();
		const textArea = {
			inputEl: { setAttr, onblur: null as any },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
		};

		tab.addTextArea({
			mode: "plugins",
			container: {
				addTextArea: (cb: (ta: any) => void) => cb(textArea),
			} as any,
		});

		expect(setAttr).toHaveBeenCalledWith("rows", 10);
		expect(setAttr).toHaveBeenCalledWith("readonly", true);
	});

	it("resets the paired readonly textarea via inputEl.setAttr after toggle/blur", async () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, pluginFilterRegexes: [] },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set([{ id: "plugin-a", name: "Plugin A" }])),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);

		let onToggleClick: (() => Promise<void>) | undefined;
		tab.toggles.push({
			toggleEl: {
				onClickEvent: vi.fn((cb: () => Promise<void>) => {
					onToggleClick = cb;
				}),
			},
		} as any);

		const disabledArea = {
			inputEl: {
				setAttr: vi.fn(),
				addEventListener: vi.fn(),
				value: "Plugin A",
				selectionStart: 0,
			},
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			setDisabled: vi.fn(),
		};

		const editorArea = {
			inputEl: { setAttr: vi.fn(), onblur: null as any, value: "" },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			setDisabled: vi.fn(),
		};

		tab.addTextArea({
			mode: "plugins",
			container: {
				addTextArea: (cb: (ta: any) => void) => cb(editorArea),
			} as any,
			disabledArea: disabledArea as any,
		});

		expect(onToggleClick).toBeTypeOf("function");
		await onToggleClick?.();

		expect(disabledArea.inputEl.setAttr).toHaveBeenCalledWith("readonly", true);
		expect(disabledArea.setDisabled).not.toHaveBeenCalled();

		await editorArea.inputEl.onblur?.({
			target: {value: "daily\\ncalendar"},
		} as unknown as FocusEvent);

		expect(disabledArea.inputEl.setAttr).toHaveBeenCalledWith("readonly", true);
		expect(disabledArea.setDisabled).not.toHaveBeenCalled();
	});

	it("clicking an included plugin appends it to exclusions and refreshes to remaining included plugins", async () => {
		const allPlugins = [
			{ id: "plugin-a", name: "Plugin A" },
			{ id: "plugin-b", name: "Plugin B" },
		];
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, pluginFilterRegexes: ["already-excluded"] },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set(
				allPlugins.filter((item) => !plugin.settings.pluginFilterRegexes.includes(item.name)),
			)),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);

		const readOnlyIncludedTextArea = {
			inputEl: {
				setAttr: vi.fn(),
				value: "Plugin A\nPlugin B",
				selectionStart: 0,
				addEventListener: vi.fn(),
			},
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
		};

		const editorArea = {
			inputEl: { setAttr: vi.fn(), onblur: null as any, value: "already-excluded" },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn((next: string) => {
				editorArea.inputEl.value = next;
				return editorArea;
			}),
		};

		tab.addTextArea({
			mode: "plugins",
			container: {
				addTextArea: (cb: (ta: any) => void) => cb(editorArea),
			} as any,
			disabledArea: readOnlyIncludedTextArea as any,
		});

		const clickHandler = (readOnlyIncludedTextArea.inputEl.addEventListener as any).mock.calls.find(
			([event]: [string]) => event === "click",
		)?.[1] as (() => Promise<void>) | undefined;
		expect(clickHandler).toBeTypeOf("function");

		await clickHandler?.();

		expect(editorArea.setValue).toHaveBeenCalledWith("already-excluded\nPlugin A");
		expect(plugin.settings.pluginFilterRegexes).toEqual(["already-excluded", "Plugin A"]);
		expect(readOnlyIncludedTextArea.setValue).toHaveBeenCalledWith("Plugin B");
	});

	it("clicking an included snippet appends it to snippet exclusions and refreshes to remaining included snippets", async () => {
		const allSnippets = [
			{ id: "snippet-a", name: "Snippet A" },
			{ id: "snippet-b", name: "Snippet B" },
		];
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, snippetFilterRegexes: ["already-excluded-snippet"] },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set(
				allSnippets.filter((item) => !plugin.settings.snippetFilterRegexes.includes(item.name)),
			)),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);

		const readOnlyIncludedTextArea = {
			inputEl: {
				setAttr: vi.fn(),
				value: "Snippet A\nSnippet B",
				selectionStart: 0,
				addEventListener: vi.fn(),
			},
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
		};

		const editorArea = {
			inputEl: { setAttr: vi.fn(), onblur: null as any, value: "already-excluded-snippet" },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn((next: string) => {
				editorArea.inputEl.value = next;
				return editorArea;
			}),
		};

		tab.addTextArea({
			mode: "snippets",
			container: {
				addTextArea: (cb: (ta: any) => void) => cb(editorArea),
			} as any,
			disabledArea: readOnlyIncludedTextArea as any,
		});

		const clickHandler = (readOnlyIncludedTextArea.inputEl.addEventListener as any).mock.calls.find(
			([event]: [string]) => event === "click",
		)?.[1] as (() => Promise<void>) | undefined;
		expect(clickHandler).toBeTypeOf("function");

		await clickHandler?.();

		expect(editorArea.setValue).toHaveBeenCalledWith("already-excluded-snippet\nSnippet A");
		expect(plugin.settings.snippetFilterRegexes).toEqual(["already-excluded-snippet", "Snippet A"]);
		expect(readOnlyIncludedTextArea.setValue).toHaveBeenCalledWith("Snippet B");
	});
});

