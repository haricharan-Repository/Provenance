import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ROOT = process.cwd();
export const TL = join(ROOT, 'truthline');
export const WORK = join(TL, '.work');
export const REQ_DIR = join(TL, 'requirements');

export interface Config {
  riskBands: { high: number; medium: number };
  stability: { repeatEach: number };
  verdict: { goMinScore: number; noGoBelowScore: number };
}

export const config = (): Config => JSON.parse(readFileSync(join(TL, 'config.json'), 'utf8'));

export const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

export const today = () => new Date().toISOString().slice(0, 10);

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export const positional = (args: string[], valueFlags: string[] = []) =>
  args.filter(
    (a, i) => !a.startsWith('--') && !valueFlags.some((f) => args[i - 1] === `--${f}`),
  );

export type RiskBand = 'high' | 'medium' | 'low';

export interface Requirement {
  id: string;
  title: string;
  impact: number;
  likelihood: number;
  changeFrequency: number;
  score: number;
  band: RiskBand;
  notCoveredReason: string;
  body: string;
}

export const bandFor = (score: number, c = config()): RiskBand =>
  score >= c.riskBands.high ? 'high' : score >= c.riskBands.medium ? 'medium' : 'low';

export function loadRequirements(): Requirement[] {
  if (!existsSync(REQ_DIR)) return [];
  return readdirSync(REQ_DIR)
    .filter((f) => /^REQ-\d+\.md$/.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(REQ_DIR, f), 'utf8');
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
      if (!match) throw new Error(`${f}: missing front matter`);
      const meta = Object.fromEntries(
        match[1]!.split('\n').map((l) => {
          const at = l.indexOf(':');
          return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
        }),
      );
      const scale = (key: string, max: number) => {
        const n = Number(meta[key]);
        if (!Number.isInteger(n) || n < 1 || n > max) {
          throw new Error(`${f}: ${key} must be an integer from 1 to ${max}`);
        }
        return n;
      };
      const impact = scale('impact', 5);
      const likelihood = scale('likelihood', 5);
      const changeFrequency = scale('change_frequency', 3);
      const score = impact * likelihood * changeFrequency;
      return {
        id: meta.id ?? f.replace('.md', ''),
        title: meta.title ?? '',
        impact,
        likelihood,
        changeFrequency,
        score,
        band: bandFor(score),
        notCoveredReason: meta.not_covered_reason ?? '',
        body: match[2]!,
      };
    });
}

// Reads the data rows of the first markdown table in a file.
export function tableRows(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().startsWith('|'));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const header = cells(lines[0] ?? '');
  return lines
    .slice(2)
    .map((l) => Object.fromEntries(cells(l).map((c, i) => [header[i] ?? String(i), c])));
}

export interface Clarification {
  ID: string;
  REQ: string;
  Question: string;
  Status: string;
}

export const clarifications = () =>
  tableRows(join(TL, 'clarifications.md')) as unknown as Clarification[];

export function openHighRisk(reqs = loadRequirements()) {
  const high = new Set(reqs.filter((r) => r.band === 'high').map((r) => r.id));
  return clarifications().filter((c) => c.Status === 'OPEN' && high.has(c.REQ));
}

export interface TestRun {
  key: string;
  file: string;
  title: string;
  tags: string[];
  reqs: string[];
  project: string;
  outcome: string; // expected | unexpected | flaky | skipped
  error: string;
  statuses: string[];
  steps: string[];
  attachments: string[];
}

interface PwTest {
  projectName: string;
  status?: string;
  results?: {
    status?: string;
    error?: { message?: string };
    errors?: { message?: string }[];
    attachments?: { path?: string }[];
    steps?: { title: string }[];
  }[];
}
interface PwSpec {
  title: string;
  file: string;
  tags?: string[];
  tests: PwTest[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
  stats?: { unexpected?: number };
  errors?: { message?: string }[];
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

export function flatten(report: PwReport): TestRun[] {
  const rows: TestRun[] = [];
  const walk = (suite: PwSuite) => {
    suite.suites?.forEach(walk);
    for (const spec of suite.specs ?? []) {
      const tags = [
        ...new Set([
          ...(spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)),
          ...(spec.title.match(/@[\w-]+/g) ?? []),
        ]),
      ];
      for (const t of spec.tests) {
        if (t.projectName === 'setup') continue;
        const results = t.results ?? [];
        const failing = results.find((r) => r.error || r.errors?.length);
        rows.push({
          key: `${spec.file} › ${spec.title}`,
          file: spec.file,
          title: spec.title,
          tags,
          reqs: tags.filter((x) => /^@REQ-\d+$/.test(x)).map((x) => x.slice(1)),
          project: t.projectName,
          outcome: t.status ?? 'unknown',
          error: stripAnsi(failing?.error?.message ?? failing?.errors?.[0]?.message ?? ''),
          statuses: results.map((r) => r.status ?? 'unknown'),
          steps: (failing ?? results[0])?.steps?.map((s) => s.title) ?? [],
          attachments: results.flatMap((r) => r.attachments ?? []).flatMap((a) => a.path ?? []),
        });
      }
    }
  };
  report.suites?.forEach(walk);
  return rows;
}

export const readReport = (path: string): PwReport => JSON.parse(readFileSync(path, 'utf8'));

export function playwright(args: string[], env: Record<string, string> = {}) {
  return spawnSync('npx', ['playwright', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

// Runs Playwright through the JSON reporter and returns the parsed report.
export function runJson(args: string[], env: Record<string, string> = {}): PwReport {
  const output = join(WORK, 'run.json');
  mkdirSync(WORK, { recursive: true });
  const res = playwright(['test', '--reporter=json', ...args], {
    PLAYWRIGHT_JSON_OUTPUT_NAME: output,
    ...env,
  });
  if (!existsSync(output)) throw new Error(`Playwright produced no report:\n${res.stderr}`);
  return readReport(output);
}

// One row per spec: the static test inventory, without running anything.
export function inventory(args: string[] = []) {
  const res = playwright(['test', '--list', '--reporter=json', ...args]);
  if (!res.stdout.trim().startsWith('{')) throw new Error(`Listing failed:\n${res.stdout}\n${res.stderr}`);
  return flatten(JSON.parse(res.stdout) as PwReport);
}
