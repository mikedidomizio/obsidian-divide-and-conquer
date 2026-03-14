/**
 * Utility tests: keep helper invariants stable while naming UI-facing helpers
 * in terms of observable settings-tab behavior.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { simpleCalc, makeArray, compose, queryText, getSnippetItems } from "../src/util";

// ─── simpleCalc ──────────────────────────────────────────────────────────────

describe("Logic guard: simpleCalc", () => {
	it("returns the string unchanged when there is no calc() expression", () => {
		expect(simpleCalc("50%")).toBe("50%");
		expect(simpleCalc("red")).toBe("red");
		expect(simpleCalc("")).toBe("");
	});

	it("resolves calc(a% + b%)", () => {
		expect(simpleCalc("calc(30% + 20%)")).toBe("50%");
		expect(simpleCalc("calc(0% + 100%)")).toBe("100%");
	});

	it("resolves calc(a% - b%)", () => {
		expect(simpleCalc("calc(80% - 30%)")).toBe("50%");
		expect(simpleCalc("calc(100% - 0%)")).toBe("100%");
	});

	it("replaces only the calc() portion of a larger string", () => {
		const result = simpleCalc("color: calc(60% + 10%) solid");
		expect(result).toBe("color: 70% solid");
	});

	it("resolves calc() even when operators are surrounded by multiple spaces (\\s* is greedy)", () => {
		// \s* in the regex matches zero-or-more whitespace, so extra spaces still resolve
		expect(simpleCalc("calc(30%  +  20%)")).toBe("50%");
	});
});

// ─── makeArray ───────────────────────────────────────────────────────────────

describe("Logic guard: makeArray", () => {
	it("converts an HTMLCollection to a plain array", () => {
		const container = document.createElement("div");
		container.innerHTML = "<span></span><span></span><span></span>";
		const arr = makeArray(container.children);
		expect(Array.isArray(arr)).toBe(true);
		expect(arr).toHaveLength(3);
		arr.forEach((el) => expect(el.tagName).toBe("SPAN"));
	});

	it("returns an empty array for an empty HTMLCollection", () => {
		const container = document.createElement("div");
		const arr = makeArray(container.children);
		expect(arr).toEqual([]);
	});
});

// ─── compose ─────────────────────────────────────────────────────────────────

describe("Logic guard: compose", () => {
	it("runs chained steps in order", async () => {
		const order: number[] = [];
		const f1 = () => order.push(1);
		const f2 = () => order.push(2);
		const f3 = () => order.push(3);

		const composed = compose({}, f1, f2, f3);
		await composed();

		expect(order).toEqual([1, 2, 3]);
	});

	it("binds functions to the provided context", async () => {
		const ctx = { value: 42 };
		let capturedValue: number | undefined;

		const f = function (this: typeof ctx) {
			capturedValue = this.value;
		};

		const composed = compose(ctx, f);
		await composed();

		expect(capturedValue).toBe(42);
	});

	it("allows chained steps to ignore prior resolved values", async () => {
		// compose() starts with Promise.resolve() and then calls each func;
		// each func receives the resolved value of the previous step as its
		// first argument, but the functions themselves don't need to use it.
		let called = false;
		const composed = compose({}, () => {
			called = true;
		});
		await composed();
		expect(called).toBe(true);
	});

	it("waits for async steps before continuing", async () => {
		const order: number[] = [];
		const f1 = async () => {
			await new Promise((r) => setTimeout(r, 5));
			order.push(1);
		};
		const f2 = () => order.push(2);

		const composed = compose({}, f1, f2);
		await composed();

		expect(order).toEqual([1, 2]);
	});
});

// ─── queryText ───────────────────────────────────────────────────────────────

describe("Settings Tab: finding sections by heading text", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
		container.innerHTML = `
      <h2 class="heading">First heading</h2>
      <h2 class="heading">Second heading</h2>
      <h2 class="heading">Third heading</h2>
    `;
	});

	it("finds the section whose visible title contains the search text", () => {
		const el = queryText(container, ".heading", "Second");
		expect(el).not.toBeUndefined();
		expect(el!.innerText).toContain("Second");
	});

	it("returns undefined when the requested section title is not present", () => {
		const el = queryText(container, ".heading", "Missing");
		expect(el).toBeUndefined();
	});

	it("supports partial title matches", () => {
		const el = queryText(container, ".heading", "Third");
		expect(el).not.toBeUndefined();
	});
});

// ─── getSnippetItems ─────────────────────────────────────────────────────────

describe("Settings Tab: snippet item region detection", () => {
	it("collects snippet rows under the final heading in the Appearance tab", () => {
		const containerEl = document.createElement("div");
		containerEl.innerHTML = `
      <div class="setting-item-heading">Header 1</div>
      <div class="snippet-item">Snippet A</div>
      <div class="setting-item-heading">CSS snippets</div>
      <div class="snippet-item">Snippet B</div>
      <div class="snippet-item">Snippet C</div>
    `;
		const fakeTab = { containerEl } as any;
		const items = getSnippetItems(fakeTab);

		// The implementation returns the last heading AND all elements after it
		// (compareDocumentPosition returns 0 for the heading itself, which passes the !(...FOLLOWING) filter)
		expect(items).toHaveLength(3); // last heading + Snippet B + Snippet C
		expect((items[1] as HTMLElement).textContent).toContain("Snippet B");
		expect((items[2] as HTMLElement).textContent).toContain("Snippet C");
	});

	it("returns only the heading when no snippet rows exist yet", () => {
		const containerEl = document.createElement("div");
		containerEl.innerHTML = `
      <div class="setting-item-heading">CSS snippets</div>
    `;
		const fakeTab = { containerEl } as any;
		const items = getSnippetItems(fakeTab);
		// The heading itself is returned (same compareDocumentPosition === 0 logic)
		expect(items).toHaveLength(1);
	});
});



