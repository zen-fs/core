import { defineConfig } from 'eslint/config';
import shared from './eslint.shared.js';

export default defineConfig(
	...shared,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		name: 'Enable typed checking',
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{ name: 'Ignores', ignores: ['tests/{fixtures,coverage}'] }
);
