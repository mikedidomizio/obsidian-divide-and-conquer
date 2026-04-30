/**
 * Test setup: polyfill Obsidian's custom Array / Element extensions
 * that exist in a live Obsidian environment but not in Node/happy-dom.
 */

// Obsidian adds Array.prototype.last (returns last element or undefined)
if (!Array.prototype.last) {
	Object.defineProperty(Array.prototype, "last", {
		value: function <T>(this: T[]): T | undefined {
			return this[this.length - 1];
		},
		writable: true,
		configurable: true,
	});
}

// Obsidian adds Array.prototype.contains (strict-equality includes)
if (!Array.prototype.contains) {
	Object.defineProperty(Array.prototype, "contains", {
		value: function <T>(this: T[], item: T): boolean {
			return this.includes(item);
		},
		writable: true,
		configurable: true,
	});
}

// Obsidian adds Array.prototype.first (returns first element or undefined)
if (!Array.prototype.first) {
	Object.defineProperty(Array.prototype, "first", {
		value: function <T>(this: T[]): T | undefined {
			return this[0];
		},
		writable: true,
		configurable: true,
	});
}

// Obsidian adds HTMLElement.prototype.find / findAll / setText / empty
if (!HTMLElement.prototype.find) {
	HTMLElement.prototype.find = function (selector: string): HTMLElement {
		return this.querySelector(selector) as HTMLElement;
	};
}

if (!HTMLElement.prototype.findAll) {
	HTMLElement.prototype.findAll = function (selector: string): HTMLElement[] {
		return Array.from(this.querySelectorAll(selector)) as HTMLElement[];
	};
}

if (!HTMLElement.prototype.setText) {
	HTMLElement.prototype.setText = function (text: string): void {
		this.textContent = text;
	};
}

if (!HTMLElement.prototype.empty) {
	HTMLElement.prototype.empty = function (): void {
		this.innerHTML = "";
	};
}

// Obsidian adds HTMLElement.prototype.createEl
if (!HTMLElement.prototype.createEl) {
	// @ts-ignore
	HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		attrs?: { text?: string; cls?: string } & Partial<HTMLElementTagNameMap[K]>,
	): HTMLElementTagNameMap[K] {
		const el = document.createElement(tag);
		if (attrs?.text) el.textContent = attrs.text;
		if (attrs?.cls) el.className = attrs.cls;
		this.appendChild(el);
		return el as HTMLElementTagNameMap[K];
	};
}

// Obsidian adds HTMLElement.prototype.getCssPropertyValue
if (!HTMLElement.prototype.getCssPropertyValue) {
	HTMLElement.prototype.getCssPropertyValue = function (prop: string): string {
		return getComputedStyle(this).getPropertyValue(prop) ?? "";
	};
}

