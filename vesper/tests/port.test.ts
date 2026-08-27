import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNonstopOutput, usernameMatchesMethod, YEAR_ID_RANGES, FIRST_NAME_TOKENS } from '../server/scanner/usernameMethods';

/**
 * Differential test suite for the ported heuristics.
 *
 * Rather than asserting hand-written expectations (which would only prove the
 * port agrees with my reading of the source), this generates the expected
 * verdicts by running the ORIGINAL Python functions from pg (2).py and then
 * compares every case against the TypeScript implementation.
 *
 * Requires python3 on PATH; the suite skips cleanly if it is missing.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PY = path.resolve(ROOT, '..', 'pg_2.py');
const WORK = path.join(ROOT, '.tmp-tests');

const METHODS = [
  'random',
  'numberless',
  'numbers',
  'ends_in_123',
  'ends_in_1_digit',
  'ends_in_2_digits',
  'ends_in_4_digits',
  'year',
  'double',
  'real_name',
  'double_real_name',
  '4digits_real_name',
  'nonstop',
] as const;

function pythonAvailable(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Slices the pure-logic functions out of the desktop source without importing PyQt6. */
function buildHarness(src: string): string {
  const grab = (a: string, b: string) => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i);
    if (i < 0 || j < 0) throw new Error(`could not locate ${a} in the source`);
    return src.slice(i, j);
  };

  return (
    'import re, json\n' +
    grab('FIRST_NAME_TOKENS = {', '\n}\n') +
    '\n}\n' +
    grab('def count_trailing_digits', '\ndef username_matches_method') +
    grab('def username_matches_method', '\ndef parse_created_date') +
    grab('def _ends_in_exact_n_digits', '\n# ----------------- BADGE LOADER') +
    `
methods = ${JSON.stringify([...METHODS])}
names = json.load(open(${JSON.stringify(path.join(WORK, 'corpus.json'))}))
verdicts = []
for n in names:
    for m in methods:
        ok, _ = username_matches_method(n, m)
        verdicts.append({"name": n, "method": m, "match": bool(ok)})
json.dump(verdicts, open(${JSON.stringify(path.join(WORK, 'verdicts.json'))}, "w"))
json.dump({n: classify_nonstop_output(n) for n in names}, open(${JSON.stringify(path.join(WORK, 'nonstop.json'))}, "w"))
`
  );
}

/** A corpus built to touch every branch of the matcher. */
function buildCorpus(): string[] {
  const fixed = [
    'Shedletsky', 'builderman', 'telamon', 'erik.cassel', 'John', 'john123', 'john12', 'john1',
    'john1234', 'john12345', 'bennybenny', 'bennybenny55', 'lucylucy', 'alexalex99', 'david1990',
    'david1979', 'david2018', 'david2020', 'sam2005', 'sam1969', 'emma2017', 'noah1980', 'liam123',
    'olivia99', 'zoe1', 'abc', 'a1', 'xy12', 'katakata', 'testtest', 'abcabc12', 'aaaa1234',
    'dodo1212', 'xy1212', 'momo0011', 'xXsniperXx', 'Pro_Gamer2011', 'coolname', 'realname2020',
    'mary12', 'mary123', 'mary1234', 'mary12345', 'jos\u00e912', 'anna2010', '_under_', 'a_b_c12',
    '1234567', '99991234', 'name1970', 'name2017', 'name2018', 'doubleletter11', 'qq1122',
    'ab112233', 'sofia7', 'lucas0', 'pedro00', 'mia1', 'leo22', 'hugo333', 'iva4444',
  ];

  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const random: string[] = [];
  for (let i = 0; i < 140; i++) {
    const len = 3 + Math.floor(rnd() * 7);
    let n = '';
    for (let k = 0; k < len; k++) n += alpha[Math.floor(rnd() * alpha.length)];
    const tailLen = Math.floor(rnd() * 6);
    for (let k = 0; k < tailLen; k++) n += String(Math.floor(rnd() * 10));
    random.push(n);
  }

  const names = ['benny', 'lucy', 'sam', 'mary', 'anna', 'leo', 'hugo', 'david', 'emma', 'sofia'];
  const doubled: string[] = [];
  for (const nm of names) doubled.push(nm + nm, nm + nm + '12', nm + nm + '1234', nm + nm + '7', nm + nm + '99');
  for (const base of ['abc', 'xyz', 'test', 'cool']) doubled.push(base + base + '1', base + base + '12', base + base + '1234');

  return [...new Set([...fixed, ...random, ...doubled])].sort();
}

function generateReference(): { verdicts: { name: string; method: string; match: boolean }[]; nonstop: Record<string, string | null> } {
  fs.mkdirSync(WORK, { recursive: true });
  const corpus = buildCorpus();
  fs.writeFileSync(path.join(WORK, 'corpus.json'), JSON.stringify(corpus));
  // The desktop source is CRLF-encoded. Python's text-mode open() silently
  // normalises that; Node's readFileSync does not, so normalise explicitly or
  // every '\n'-anchored marker below fails to match.
  const source = fs.readFileSync(SOURCE_PY, 'utf-8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(WORK, 'reference.py'), buildHarness(source));
  execFileSync('python3', [path.join(WORK, 'reference.py')], { stdio: 'ignore' });
  return {
    verdicts: JSON.parse(fs.readFileSync(path.join(WORK, 'verdicts.json'), 'utf-8')),
    nonstop: JSON.parse(fs.readFileSync(path.join(WORK, 'nonstop.json'), 'utf-8')),
  };
}

const canRun = pythonAvailable() && fs.existsSync(SOURCE_PY);

test('username methods match the original Python on every case', { skip: canRun ? false : 'python3 or pg_2.py not available' }, () => {
  const { verdicts } = generateReference();
  assert.ok(verdicts.length > 1000, `expected a large corpus, got ${verdicts.length}`);

  const mismatches: string[] = [];
  for (const v of verdicts) {
    const got = usernameMatchesMethod(v.name, v.method).matches;
    if (got !== v.match) mismatches.push(`${v.name} / ${v.method}: python=${v.match} ts=${got}`);
  }
  assert.deepEqual(mismatches, [], `${mismatches.length} of ${verdicts.length} verdicts differ`);
});

test('nonstop classification matches classify_nonstop_output', { skip: canRun ? false : 'python3 or pg_2.py not available' }, () => {
  const { nonstop } = generateReference();
  const mismatches: string[] = [];
  for (const [name, want] of Object.entries(nonstop)) {
    const got = classifyNonstopOutput(name);
    if ((want ?? null) !== got) mismatches.push(`${name}: python=${want} ts=${got}`);
  }
  assert.deepEqual(mismatches, [], `${mismatches.length} classifications differ`);
});

test('year ranges and name tokens were extracted from the source intact', () => {
  assert.equal(Object.keys(YEAR_ID_RANGES).length, 21, 'expected 21 year buckets including Any year');
  assert.deepEqual(YEAR_ID_RANGES['Any year'], [1, 9000000000]);
  assert.deepEqual(YEAR_ID_RANGES['2006'], [1, 11386]);
  assert.deepEqual(YEAR_ID_RANGES['2025'], [7794159195, 9000000000]);
  const years = Object.keys(YEAR_ID_RANGES).filter((y) => y !== 'Any year');

  // Buckets must be ordered and each must be a valid (lo <= hi) range.
  for (const y of years) {
    const [lo, hi] = YEAR_ID_RANGES[y];
    assert.ok(lo <= hi, `${y} has lo ${lo} > hi ${hi}`);
  }
  for (let i = 1; i < years.length; i++) {
    assert.ok(
      YEAR_ID_RANGES[years[i]][0] > YEAR_ID_RANGES[years[i - 1]][0],
      `${years[i]} does not start after ${years[i - 1]}`,
    );
  }

  // KNOWN SOURCE DEFECT, reproduced deliberately: in pg (2).py the 2022 bucket
  // ends at 4195844718 while 2023 begins at 4195844712, so 7 IDs belong to both
  // years. The port keeps the original numbers rather than silently "fixing"
  // them; this assertion pins the overlap so any future edit is intentional.
  const overlap = YEAR_ID_RANGES['2022'][1] - YEAR_ID_RANGES['2023'][0] + 1;
  assert.equal(overlap, 7, 'the documented 2022/2023 overlap changed');

  // No other pair may overlap.
  for (let i = 1; i < years.length; i++) {
    if (years[i] === '2023') continue;
    assert.ok(
      YEAR_ID_RANGES[years[i]][0] > YEAR_ID_RANGES[years[i - 1]][1],
      `unexpected overlap between ${years[i - 1]} and ${years[i]}`,
    );
  }
  assert.ok(FIRST_NAME_TOKENS.size > 500, `expected 500+ name tokens, got ${FIRST_NAME_TOKENS.size}`);
  for (const n of ['benny', 'lucy', 'mary', 'david', 'sofia']) {
    assert.ok(FIRST_NAME_TOKENS.has(n), `missing expected token ${n}`);
  }
});
