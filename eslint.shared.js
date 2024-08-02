/*
	Shared eslint rules
*/

import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default {
	name: 'ZenFS',
	extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
	files: ['src/**/*.ts', 'tests/**/*.ts'],
	languageOptions: {
		globals: { ...globals.browser, ...globals.node },
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	plugins: { stylistic },
	rules: {
		'no-useless-escape': 'warn',
		'stylistic/no-mixed-spaces-and-tabs': 'warn',
		'no-unreachable': 'warn',
		'stylistic/no-extra-semi': 'warn',
		'no-fallthrough': 'warn',
		'no-empty': 'warn',
		'no-case-declarations': 'warn',
		'prefer-const': 'warn',
		'prefer-rest-params': 'warn',
		'prefer-spread': 'warn',
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': 'warn',
		'@typescript-eslint/no-inferrable-types': 'off',
		'@typescript-eslint/no-this-alias': 'off',
		'@typescript-eslint/no-unsafe-function-type': 'warn',
		'@typescript-eslint/no-wrapper-object-types': 'warn',
		'@typescript-eslint/triple-slash-reference': 'warn',
		'@typescript-eslint/no-non-null-assertion': 'off',
		'@typescript-eslint/no-namespace': 'warn',
		'@typescript-eslint/prefer-as-const': 'warn',
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/consistent-type-assertions': 'warn',
		'@typescript-eslint/consistent-type-imports': 'warn',
		'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
		'@typescript-eslint/require-await': 'warn',
		'@typescript-eslint/no-unsafe-return': 'warn',
		'@typescript-eslint/no-unsafe-assignment': 'warn',
		'@typescript-eslint/no-unsafe-member-access': 'warn',
		'@typescript-eslint/no-unsafe-argument': 'warn',
		'@typescript-eslint/no-redundant-type-constituents': 'warn',
		'@typescript-eslint/no-unsafe-call': 'warn',
	},
};
