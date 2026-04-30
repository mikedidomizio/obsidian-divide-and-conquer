import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		environment: "happy-dom",
		globals: true,
		include: ["tests/**/*.test.ts"],
		setupFiles: ["tests/setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			reporter: ['lcov']
		},
	},
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "tests/__mocks__/obsidian.ts"),
			"monkey-around": path.resolve(__dirname, "tests/__mocks__/monkey-around.ts"),
			tinycolor2: path.resolve(__dirname, "tests/__mocks__/tinycolor2.ts"),
		},
	},
});



