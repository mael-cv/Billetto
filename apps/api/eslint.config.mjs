import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.strict, {
  ignores: ['dist/**'],
  rules: {
    // Les modules NestJS sont des classes vides décorées.
    '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
  },
});
