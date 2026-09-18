#!/usr/bin/env node
import { access, mkdtemp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const officialReleaseUrl = 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31';

// The bridge intentionally loads repository TypeScript files as ESM. Node 24
// emits a harmless MODULE_TYPELESS_PACKAGE_JSON warning for that temporary
// import; keep real process warnings visible while avoiding noisy output.
process.on('warning', (warning) => {
  if (warning.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(warning.stack || warning.message);
});

function parseArgs(argv) {
  const options = {
    rules: process.env.EINVOICE_RULES || '/tmp/bivaro-einvoice-review/rules',
    python: process.env.EINVOICE_PYTHON || '',
    output: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--rules') options.rules = argv[++index];
    else if (argument === '--python') options.python = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node --experimental-strip-types scripts/einvoice-validation/run.mjs [options]

Options:
  --rules DIR    extracted KoSIT configuration v2026-08-31 (or EINVOICE_RULES)
  --python PATH  Python with lxml+saxonche (or EINVOICE_PYTHON)
  --output DIR   preserve generated fixtures and results in DIR; default is a temporary directory

Official release: ${officialReleaseUrl}`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function choosePython(requested) {
  const candidates = requested
    ? [requested]
    : [
        '/tmp/bivaro-einvoice-review/venv/bin/python3',
        '/tmp/bivaro-einvoice-review/venv/bin/python',
        'python3',
      ];
  for (const candidate of candidates) {
    if (candidate.includes('/') && !(await exists(candidate))) continue;
    return candidate;
  }
  throw new Error(
    'No Python interpreter found. Install/use lxml and saxonche in an isolated environment, ' +
      'then pass --python /path/to/venv/bin/python3.',
  );
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!(await exists(options.rules))) {
    throw new Error(
      `Official rules directory does not exist: ${options.rules}\n` +
        `Download/extract release v2026-08-31 from ${officialReleaseUrl} and pass --rules DIR.`,
    );
  }
  const python = await choosePython(options.python);
  const outputDirectory = options.output
    ? path.resolve(options.output)
    : await mkdtemp(path.join(os.tmpdir(), 'bivaro-einvoice-validation-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const resultsPath = path.join(outputDirectory, 'results.json');
  const generatorModule = await import(pathToFileURL(path.join(scriptDirectory, 'generate-fixtures.mjs')).href);
  const manifest = await generatorModule.generateFixtures(outputDirectory);
  const checker = path.join(scriptDirectory, 'check-official.py');
  const exitCode = await run(
    python,
    [checker, '--rules', path.resolve(options.rules), '--manifest', manifestPath, '--output', resultsPath],
    repositoryRoot,
  );
  console.log(`Validation artefacts: ${outputDirectory}`);
  console.log(`Generated ${manifest.fixtures.length} fixtures using ${manifest.source}.`);
  console.log(`Results: ${resultsPath}`);
  if (exitCode !== 0) process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
