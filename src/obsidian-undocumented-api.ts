import "obsidian";

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: string[];
			manifests: {[id:string]: { id: string; name: string; author?: string; description?: string }};
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
			settingTabs: {id:string, containerEl:HTMLElement}[];
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

	interface SettingsTab {
		containerEl: HTMLElement;
		navEl: HTMLElement;
		display(...args: unknown[]): void;
		hide(): unknown;
		reload(): Promise<void>;
		heading:string;
		reloadLabel: string;
	}
}
