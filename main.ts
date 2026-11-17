// Token Radar, model radar-2 (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every rankable pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies
// this repository's dashboard/ and screenshots/ to /output. Last, it writes
// /output/dossier.json with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is deliberately small and deterministic: the same snapshot
// in gives the same board, data.js, dashboard and dossier out, byte for
// byte, on every run. It reads nothing from the network, writes nothing
// outside the output directory, and refuses to write a board the gate
// would refuse, instead of handing the grader a broken entry.
//
// Usage:
//   node main.ts [--input <snapshot.json|directory>] [--output <dir>]
//   node main.ts --help

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A screenshot's PNG signature: the first eight bytes of a real PNG. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Print the usage and stop: --help is the one flag that writes nothing. */
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'token radar: score the sealed snapshot and write the ranked board\n' +
      'usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>]\n' +
      '  --input   snapshot file or the directory holding snapshot.json (default /input)\n' +
      '  --output  directory to write board.json, data.js, dashboard/, screenshots/ and dossier.json to\n' +
      '            (default $MAKEFUN_OUTPUT_DIR, else /output)\n' +
      '  --help    print this usage and stop\n',
  );
  process.exit(0);
}

/** --name <value> out of the arguments, or the fallback.
 *
 * Both spellings are accepted: `--input <value>` and `--input=<value>`.
 * A flag with no value after it falls back, rather than reading the
 * next flag as a path.
 */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
// The output directory is the flag first, then the environment, then
// the grader's own /output: the same program runs in the container
// and on a developer's machine without a code change.
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
// The gate's own check, run before anything is written: a board that
// misses the watchlist, ranks out of order, or carries a bad farm step
// is refused here, with the reason, instead of being handed on.
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot.
 *
 * The copy is flat and explicit: dashboard/ and screenshots/ are both
 * flat directories, and a nested directory would be silently dropped
 * rather than copied half-way. The returned names are the files the
 * caller then validates, so a missing directory is an empty list, not
 * an error, and the screenshot count below is the check that fires.
 */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  // A screenshot is a PNG by the gate's own rule: check the signature
  // here, while the file is in hand, instead of letting a JPEG through
  // and failing the dossier build further down.
  const bytes = readFileSync(join(here, 'screenshots', name));
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    process.stderr.write(`token radar: screenshots/${name}: not a PNG file\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
