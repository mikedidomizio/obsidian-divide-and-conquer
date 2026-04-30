import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
	{ ignores: ["node_modules/**", "dist/main.js"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: true,
				tsconfigRootDir: __dirname
			},
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			"curly": "error",
			"no-console": "off",
			"no-magic-numbers": "warn",
		}
	}
);

