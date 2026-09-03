import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    // `dist/**` is bundler output (npm run build:worker), not source.
    ignores: ['.next/**', 'dist/**', 'node_modules/**', 'drizzle/**', 'var/**', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The worker and migration runner legitimately write to stdout.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
];

export default config;
