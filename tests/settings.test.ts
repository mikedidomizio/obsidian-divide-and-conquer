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

	it("disables the read-only textarea via inputEl.setAttr, not Obsidian setDisabled() (for keeping min version for now)", () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			saveData: vi.fn(async () => {}),
			getIncludedItems: vi.fn(() => new Set([{ id: "plugin-a" }])),
		};
		const tab = new DACSettingsTab({} as any, plugin as any);

		const setAttr = vi.fn();
		const setDisabled = vi.fn();
		const textArea = {
			inputEl: { setAttr, onblur: null as any },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			setDisabled,
		};

		tab.addTextArea({
			mode: "plugins",
			container: {
				addTextArea: (cb: (ta: any) => void) => cb(textArea),
			} as any,
		});

		expect(setAttr).toHaveBeenCalledWith("rows", 10);
		expect(setAttr).toHaveBeenCalledWith("disabled", true);
		expect(setDisabled).not.toHaveBeenCalled();
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
			},
			setPlaceholder: vi.fn().mockReturnThis(),
			setDisabled: vi.fn(),
		};

		const editorArea = {
			inputEl: { setAttr: vi.fn(), onblur: null as any },
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

		expect(disabledArea.inputEl.setAttr).toHaveBeenCalledWith("disabled", true);
		expect(disabledArea.setDisabled).not.toHaveBeenCalled();

		await editorArea.inputEl.onblur?.({
			target: {value: "daily\\ncalendar"},
		} as unknown as FocusEvent);

		expect(disabledArea.inputEl.setAttr).toHaveBeenCalledWith("disabled", true);
		expect(disabledArea.setDisabled).not.toHaveBeenCalled();
	});
});

