/** Minimal mock of the Obsidian API used by this plugin. */

export class Notice {
	constructor(public message: string, public timeout?: number) {}
}

export class Plugin {
	app: any;
	manifest: any;
	registeredCommands: any[] = [];

	constructor(app: any, manifest?: any) {
		this.app = app;
		this.manifest = manifest ?? {};
	}

	async loadData(): Promise<any> {
		return {};
	}

	async saveData(_data: any): Promise<void> {}

	addCommand(command: any) {
		this.registeredCommands.push(command);
		return command;
	}

	addSettingTab(_tab: any) {}

	register(_cb: () => any) {}

	registerEvent(_eventRef: any) {}

	registerDomEvent(..._args: any[]) {}

	addRibbonIcon(_icon: string, _title: string, _cb: (e: MouseEvent) => any) {
		return document.createElement("div");
	}
}

export class PluginSettingTab {
	app: any;
	plugin: any;
	containerEl: HTMLElement;

	constructor(app: any, plugin: any) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}

	display() {}
	hide() {}
}

export class Setting {
	containerEl: HTMLElement;
	infoEl: HTMLElement;
	controlEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;

	constructor(_containerEl: HTMLElement) {
		this.containerEl = document.createElement("div");
		this.infoEl = document.createElement("div");
		this.controlEl = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.descEl = document.createElement("div");
	}

	setName(_name: string) {
		return this;
	}
	setDesc(_desc: string) {
		return this;
	}
	addToggle(_cb: (toggle: any) => any) {
		_cb({ setValue: () => ({ onChange: () => {} }), toggleEl: document.createElement("div") });
		return this;
	}
	addTextArea(_cb: (ta: any) => any) {
		const ta = {
			inputEl: Object.assign(document.createElement("textarea"), {
				onblur: null,
				setAttr: () => {},
			}),
			setPlaceholder: () => ta,
			setValue: () => ta,
			setDisabled: () => ta,
		};
		_cb(ta);
		return this;
	}
}

export class ExtraButtonComponent {
	extraSettingsEl: HTMLElement;
	constructor(_container: HTMLElement) {
		this.extraSettingsEl = document.createElement("button");
	}
	setTooltip(_tooltip: string) {
		return this;
	}
	setIcon(_icon: string) {
		return this;
	}
	onClick(_cb: () => any) {
		return this;
	}
	setDisabled(_disabled: boolean) {
		return this;
	}
}

export class SettingsTab {}

export type PluginManifest = {
	id: string;
	name: string;
	author?: string;
	description?: string;
	version: string;
};

export type Command = {
	id: string;
	name: string;
	callback?: () => any;
};

