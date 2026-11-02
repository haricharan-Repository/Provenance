import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { compareAssertions } from './falsify';
import { TL, WORK, flag, flatten, positional, readReport, today, write } from './lib';

export type FailureClass = 'LOCATOR_DRIFT' | 'TIMING' | 'TEST_DATA' | 'ENVIRONMENT' | 'PRODUCT_DEFECT' | 'REQUIREMENT_CHANGE';

interface Failure {
  name: string;
  file: string;
  tags: string[];
  reqs: string[];
  error: string;
  steps: string[];
  attachments: string[];
}

const ACTIONS: Record<FailureClass, string> = {
  LOCATOR_DRIFT: 'Heal: regenerate the locator from a live snapshot.',
  TIMING: 'Heal: use a web-first assertion or wait for state.',
  TEST_DATA: 'Heal: fix the factory or test isolation.',
  ENVIRONMENT: 'Do not heal. Report the environment issue and retry once.',
  PRODUCT_DEFECT: 'Do not heal. File the bug below.',
  REQUIREMENT_CHANGE: 'Do not heal. Ask the human to confirm the new requirement.',
};

const ENV = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|net::ERR_|socket hang up|Executable doesn't exist|browser has been closed|Target (page, context or browser )?closed|\b50[234]\b.*(gateway|unavailable)/i;
const DATA = /factory failed|already exists|duplicate key|test data/i;
// Do not match Playwright's call log ("waiting for getByRole"): it also appears on real value mismatches.
const NOT_FOUND = /element\(s\) not found|strict mode violation|locator\.\w+: Timeout/i;
const MISMATCH = /Expected[^\n]*:[\s\S]*Received[^\n]*:/;
const TIMEOUT = /Test timeout of|Timeout \d+ms exceeded/i;

// A proposal from the error text. REQUIREMENT_CHANGE is never proposed: only a human can decide
// that the requirement moved. A mismatch may be that too, which is why confidence is reported.
export function classify(error: string): { cls: FailureClass; confidence: 'high' | 'medium' | 'low'; why: string } {
  if (ENV.test(error)) return { cls: 'ENVIRONMENT', confidence: 'high', why: 'Connection or browser infrastructure error.' };
  if (DATA.test(error)) return { cls: 'TEST_DATA', confidence: 'medium', why: 'Failure raised while creating test data.' };
  if (NOT_FOUND.test(error)) return { cls: 'LOCATOR_DRIFT', confidence: 'medium', why: 'Target element missing or ambiguous. Confirm it was not removed by a defect.' };
  if (MISMATCH.test(error)) return { cls: 'PRODUCT_DEFECT', confidence: 'medium', why: 'The app returned a value that differs from the expected business value.' };
  if (TIMEOUT.test(error)) return { cls: 'TIMING', confidence: 'low', why: 'Timed out with no assertion mismatch. Check the trace for a slow or stuck state.' };
  return { cls: 'PRODUCT_DEFECT', confidence: 'low', why: 'Unrecognized failure. Treated as a defect until a human shows otherwise.' };
}

function fromJunit(path: string): Failure[] {
  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(readFileSync(path, 'utf8'));
  const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const suites = list(xml.testsuites?.testsuite ?? xml.testsuite) as { testcase?: unknown }[];
  const cases = suites.flatMap((s) => list(s.testcase)) as { name: string; classname?: string; failure?: unknown; error?: unknown }[];
  return cases.filter((c) => c.failure !== undefined || c.error !== undefined).map((c) => {
    const f = list(c.failure ?? c.error)[0] as string | { '#text'?: string; message?: string };
    const error = typeof f === 'string' ? f : `${f.message ?? ''}\n${f['#text'] ?? ''}`;
    const tags = c.name.match(/@[\w-]+/g) ?? [];
    return { name: c.name, file: c.classname ?? '', tags, reqs: tags.filter((t) => t.startsWith('@REQ-')).map((t) => t.slice(1)), error, steps: [], attachments: [] };
  });
}

function fromJson(path: string): Failure[] {
  return flatten(readReport(path))
    .filter((t) => t.outcome === 'unexpected' || t.outcome === 'flaky')
    .map((t) => ({ name: `[${t.project}] ${t.title}`, file: t.file, tags: t.tags, reqs: t.reqs, error: t.error, steps: t.steps, attachments: t.attachments }));
}

const load = (path: string) => (path.endsWith('.xml') ? fromJunit(path) : fromJson(path));

const firstLines = (s: string, n: number) => s.trim().split('\n').slice(0, n).join('\n');

export function triage(args: string[]) {
  const input = positional(args, ['build'])[0];
  if (!input) throw new Error('Usage: tl triage <results.json | junit.xml> [--build N]');
  const build = flag(args, 'build') ?? `local-${today()}`;
  const failures = load(input);

  const sections = failures.map((f) => {
    const { cls, confidence, why } = classify(f.error);
    const severity = f.tags.includes('@risk-high') ? 'Critical' : f.tags.includes('@risk-medium') ? 'Major' : 'Minor';
    const bug = cls === 'PRODUCT_DEFECT'
      ? `\n**Draft bug**\n- Title: ${f.reqs[0] ?? 'NO REQ'}: ${f.name}\n- Requirement: ${f.reqs.join(', ') || 'NOT TRACED'}\n- Severity: ${severity}\n` +
        `- Steps: ${f.steps.join(' → ') || 'See trace'}\n- Evidence: ${f.attachments.join(', ') || 'none attached'}\n`
      : '';
    return `## ${f.name}\n\n- Class: \`${cls}\` (${confidence} confidence, proposed from the error text)\n- Why: ${why}\n- Action: ${ACTIONS[cls]}\n- File: ${f.file}\n\n\`\`\`\n${firstLines(f.error, 12)}\n\`\`\`\n${bug}`;
  });

  const path = join(TL, 'triage', `${build}.md`);
  write(path, `# Triage: build ${build}\n\nSource: ${input}. Failures: ${failures.length}. Confirm each class against its trace before healing.\n\n${sections.join('\n') || 'No failures.\n'}`);
  failures.forEach((f) => console.log(`${classify(f.error).cls.padEnd(16)} ${f.name}`));
  console.log(`Wrote ${path}`);
}

export function gate(args: string[]) {
  const quarantinePath = flag(args, 'quarantine');
  const blockingPath = positional(args, ['quarantine'])[0];
  if (!blockingPath) throw new Error('Usage: tl gate <results.json> [--quarantine <results.json>]');
  if (!existsSync(blockingPath)) {
    console.log(`FAILURE: ${blockingPath} is missing, so nothing proves this build.`);
    process.exitCode = 1;
    return;
  }
  const blocking = load(blockingPath);
  const quarantined = quarantinePath && existsSync(quarantinePath) ? load(quarantinePath) : [];
  const report = readReport(blockingPath);
  const runs = flatten(report);
  // Setup-project failures and global errors never reach a test row, yet they skip whole shards.
  if (report.errors?.length || (report.stats?.unexpected ?? 0) > blocking.length) {
    console.log('FAILURE: setup or global errors prevented tests from running.');
    process.exitCode = 1;
  } else if (!runs.some((r) => r.outcome === 'expected')) {
    console.log('FAILURE: no blocking test passed, so nothing proves this build.');
    process.exitCode = 1;
  } else if (blocking.length) {
    console.log(`FAILURE: ${blocking.length} blocking failure(s).`);
    process.exitCode = 1;
  } else if (quarantined.length) {
    console.log(`UNSTABLE: ${quarantined.length} quarantine failure(s) only.`);
    process.exitCode = 2;
  } else {
    console.log('SUCCESS');
  }
}

export function healCheck(args: string[]) {
  const spec = positional(args, ['before'])[0];
  const before = flag(args, 'before');
  if (!spec || !before) throw new Error('Usage: tl heal-check <spec> --before <git-ref | file>');
  let beforePath = before;
  if (!existsSync(before)) {
    beforePath = join(WORK, 'heal-before.spec.ts');
    write(beforePath, execFileSync('git', ['show', `${before}:${spec}`], { encoding: 'utf8' }));
  }
  const removed = compareAssertions(beforePath, spec);
  if (removed.length) {
    console.log('REFUSED: this heal changes or removes assertions (prime directive 3):');
    removed.forEach((r) => console.log(`  - ${r}`));
    process.exitCode = 1;
  } else {
    console.log('OK: every assertion and expected value is intact.');
  }
}
