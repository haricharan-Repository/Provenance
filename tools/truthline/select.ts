import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TL, flag } from './lib';

interface ImpactRule {
  glob: string;
  reqs: string[];
}

const ALWAYS = ['@risk-high', '@smoke'];
const IGNORED = /(^|\/)[^/]+\.md$|^truthline\/|^docs\/|^\.github\/|^\.claude\/|^\.vscode\//;

const toRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0/g, '.*')}$`,
  );

const specs = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((e) => e.isFile() && e.name.endsWith('.spec.ts'))
        .map((e) => join(e.parentPath, e.name))
    : [];

const reqTags = (text: string) => text.match(/@REQ-\d+/g) ?? [];

// Returns a --grep value, or '' for a full run. Anything it cannot map widens to a full run:
// a smart selection that misses a test is worse than a slow build.
export function selectTests(files: string[]): string {
  const rulesPath = join(TL, 'impact-map.json');
  const rules: ImpactRule[] = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : [];
  const allSpecs = specs('tests');
  const picked = new Set<string>(ALWAYS);

  for (const file of files.filter((f) => !IGNORED.test(f))) {
    if (file.endsWith('.spec.ts')) {
      reqTags(existsSync(file) ? readFileSync(file, 'utf8') : '').forEach((t) => picked.add(t));
    } else if (file.startsWith('tests/pages/')) {
      const name = basename(file, '.ts');
      const users = allSpecs.map((s) => readFileSync(s, 'utf8')).filter((s) => s.includes(name) || s.includes('fixtures/base'));
      users.flatMap(reqTags).forEach((t) => picked.add(t));
    } else {
      const hits = rules.filter((r) => toRegExp(r.glob).test(file));
      if (!hits.length) return '';
      hits.flatMap((r) => r.reqs).forEach((id) => picked.add(`@${id}`));
    }
  }
  return [...picked].join('|');
}

export function select(args: string[]) {
  const listed = flag(args, 'files');
  let files: string[];
  try {
    files = listed
      ? listed.split(',')
      : execFileSync('git', ['diff', '--name-only', `${flag(args, 'base') ?? 'origin/main'}...HEAD`], { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean);
  } catch {
    return; // No diff available, so print nothing: a full run.
  }
  console.log(selectTests(files));
}
