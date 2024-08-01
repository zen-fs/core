import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslint from '@eslint/js';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*', 'tests/**/*'],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			ecmaVersion: 'latest',
			sourceType: 'module',
		},
		rules: {
			'no-useless-escape': 'warn',
			'no-unused-vars': 'off',
			'no-mixed-spaces-and-tabs': 'warn',
			'no-unreachable': 'warn',
			'no-extra-semi': 'warn',
			'no-fallthrough': 'off',
			'no-empty': 'warn',
			'no-case-declarations': 'off',
			'prefer-const': 'warn',
			'prefer-rest-params': 'warn',
			'prefer-spread': 'warn',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-inferrable-types': 'off',
			'@typescript-eslint/no-this-alias': 'off',
			//'@typescript-eslint/ban-types': 'warn',
			'@typescript-eslint/triple-slash-reference': 'warn',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-namespace': 'warn',
			'@typescript-eslint/prefer-as-const': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/consistent-type-assertions': 'warn',
			'@typescript-eslint/consistent-type-imports': 'warn',
		},
	},
	{
		files: ['src/emulation/{sync,async,promises}.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{ ignores: ['tests/fixtures'] }
);
