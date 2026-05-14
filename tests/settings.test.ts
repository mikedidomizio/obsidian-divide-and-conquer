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
});

