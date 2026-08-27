import "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: string[];
			manifests: {
				[id: string]: {
					id: string;
					name: string;
					author?: string;
					description?: string
				}
			};
			enabledPlugins: Set<string>;
			disablePluginAndSave: (id: string) => Promise<boolean>;
			enablePluginAndSave: (id: string) => Promise<boolean>;
			initialize: () => Promise<void>;
			loadManifests: () => Promise<void>;
			requestSaveConfig: () => Promise<void>;
		};
		commands: {
			executeCommandById: (commandID: string) => void;
		};
		customCss: {
			enabledSnippets: Set<string>;
			snippets: string[];
			setCssEnabledStatus(snippet: string, enable: boolean): void;
			loadSnippets(): Promise<void>;
		};
		setting: {
			settingTabs: { id: string, containerEl: HTMLElement }[];

			open(): void;
			close(): void;
			openTabById(id: string): void;

			/**
			 * Obsidian 1.13+ can push a settings sub-page in front of a tab — Appearance is
			 * where the CSS snippets moved. Optional, as older builds have no sub-pages.
			 *
			 * Undocumented, but not guesswork: Obsidian declare it the same way in their own
			 * importer plugin, labelled "Obsidian 1.13 API missing from the published types".
			 * https://github.com/obsidianmd/obsidian-importer/blob/master/src/augment.d.ts
			 */
			openPage?(page: SettingsSubPage): void;
		}
	}

	interface View {
		renderer: {
			worker: Worker,
			autoRestored: boolean,
			nodes: unknown[],
		};
		dataEngine: Engine;
		engine: Engine;
	}

	interface Engine {
		displayOptions: unknown,
		forceOptions: {
			optionListeners: {
				centerStrength: (value: number) => void,
				linkDistance: (value: number) => void,
				linkStrength: (value: number) => void,
				repelStrength: (value: number) => void,
			},
		},
	}

	/**
	 * A settings sub-page, new in Obsidian 1.13. It is built fresh each time the user clicks
	 * into it and has its own container, separate from the tab it was reached from.
	 */
	interface SettingsSubPage {
		containerEl: HTMLElement;

		/** The page's name in the modal titlebar, e.g. "CSS snippets". */
		title?: string;

		display(...args: unknown[]): void;
	}

	interface SettingsTab {
		containerEl: HTMLElement;
		navEl: HTMLElement;

		display(...args: unknown[]): void;

		/**
		 * Obsidian 1.13+ renders its own settings tabs from a list of definitions rather than
		 * through display(); renderTab() is what actually runs, and update() rebuilds the
		 * definitions and re-renders. Optional, as older builds have neither.
		 */
		renderTab?(...args: unknown[]): void;

		update?(): void;

		hide(): unknown;

		reload(): Promise<void>;

		heading: string;
		reloadLabel: string;
	}
}
