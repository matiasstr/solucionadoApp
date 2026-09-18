import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/generated/**', '**/next-env.d.ts', '**/.cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals.map((config) => ({ ...config, files: ['apps/web/**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
