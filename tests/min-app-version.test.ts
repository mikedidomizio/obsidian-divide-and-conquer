/**
 * The declared minimum Obsidian version is a promise to users - the community
 * browser will not install the plugin below it. Built as this is on undocumented
 * internals, that promise is only worth what the E2E suite exercises, so the
 * suite has to keep running against the version the manifest names.
 */

import { describe, it, expect } from "vitest";
import manifest from "../manifest.json";
import versions from "../versions.json";
import { DEFAULT_OBSIDIAN_VERSIONS, isAtLeast } from "./e2e/obsidian-versions.mjs";

/**
 * wdio-obsidian-service throws before it downloads anything older than this, so
 * no suite can cover a lower floor however much we would like to claim one.
 */
const HARNESS_FLOOR = "1.0.3";

/** The lowest of the pinned versions - the one `minAppVersion` has to name. */
const oldestTested = DEFAULT_OBSIDIAN_VERSIONS.reduce(
	(oldest, version) => (isAtLeast(version, oldest) ? oldest : version),
);

describe("the minimum Obsidian version the manifest promises", () => {
	it("is a version the end-to-end suite runs against", () => {
		expect(DEFAULT_OBSIDIAN_VERSIONS).toContain(manifest.minAppVersion);
	});

	it("is the oldest version the end-to-end suite runs against", () => {
		expect(manifest.minAppVersion).toBe(oldestTested);
	});

	it("is one the test harness can actually launch", () => {
		expect(isAtLeast(manifest.minAppVersion, HARNESS_FLOOR)).toBe(true);
	});

	it("matches what versions.json tells the community browser", () => {
		expect(versions[manifest.version as keyof typeof versions]).toBe(manifest.minAppVersion);
	});
});
