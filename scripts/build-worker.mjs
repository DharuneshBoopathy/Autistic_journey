/**
 * Bundle the standalone Node entry points for deployment.
 *
 * The app ships as Next's `standalone` output, which does not include `src/` — so
 * the worker, the migration runner and the backup scripts need their own build.
 *
 * Bundling rather than shipping TypeScript keeps `tsx` (and the esbuild it carries)
 * out of the production image entirely: the runtime needs Node and the production
 * dependencies, no compiler. It also resolves the `@/` path alias at build time,
 * which is the one thing a plain `node` cannot do.
 *
 * `--packages=external` leaves node_modules alone: `sharp` and `@node-rs/argon2`
 * are native, and bundling them would produce a file that cannot load.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

const workerFiles = (await readdir(path.join(root, 'src/worker')))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => `src/worker/${f}`);

const entryPoints = [...workerFiles, 'src/db/migrate.ts', 'src/db/seed.ts'];

await build({
  entryPoints: entryPoints.map((f) => path.join(root, f)),
  outdir: path.join(root, 'dist'),
  outbase: path.join(root, 'src'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // `.mjs` so Node treats these as ES modules regardless of the package's own
  // "type" field — the alternative is a startup warning on every run.
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  // esbuild does not read tsconfig `paths` for aliases it cannot infer, so the one
  // alias this codebase uses is declared here.
  alias: { '@': path.join(root, 'src') },
  banner: {
    // `postgres` and other CJS dependencies reach for these in an ESM bundle.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_from } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_from(__filename);',
    ].join('\n'),
  },
});

console.warn(`Built ${entryPoints.length} entry points into dist/`);
