import tseslint from 'typescript-eslint';
import shared from './eslint.shared.js';

export default tseslint.config(
	shared,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		name: 'Enable typed checking',
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		name: 'Allow explicit any in primary emulation layer files',
		files: ['src/emulation/{sync,async,promises}.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{ name: 'Ignore test fixtures', ignores: ['tests/fixtures'] }
);
