import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, inventory } from './lib';

const BANNED: [RegExp, string][] = [
  [/waitForTimeout\s*\(/, 'waitForTimeout is banned'],
  [/\bxpath=|locator\(\s*['"`]\/\//, 'XPath locators are banned'],
  [/\.only\s*\(/, '.only must not be committed'],
];
const SECRET = /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"`](?!\$)[^'"`\s]{4,}['"`]/i;

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((e) => e.isFile() && /\.(ts|groovy)$|Jenkinsfile$/.test(e.name))
        .map((e) => join(e.parentPath, e.name))
    : [];

export function doctor() {
  const problems: string[] = [];
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version: string | undefined = pkg.devDependencies?.['@playwright/test'];

  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) problems.push(`@playwright/test must be an exact version, found ${version}`);
  const jenkins = join(ROOT, 'Jenkinsfile');
  if (existsSync(jenkins)) {
    const image = /mcr\.microsoft\.com\/playwright:v([\d.]+)/.exec(readFileSync(jenkins, 'utf8'))?.[1];
    if (image !== version) problems.push(`Jenkinsfile image v${image} does not match @playwright/test ${version}`);
  } else {
    problems.push('Jenkinsfile is missing');
  }

  const files = [...walk(join(ROOT, 'tests')), jenkins].filter(existsSync);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    for (const [pattern, message] of BANNED) if (pattern.test(text)) problems.push(`${rel}: ${message}`);
    if (SECRET.test(text)) problems.push(`${rel}: possible hardcoded secret`);
    if (rel.endsWith('.spec.ts')) {
      const titles = text.match(/\btest\(\s*['"`]/g)?.length ?? 0;
      const links = text.match(/type: 'requirement'/g)?.length ?? 0;
      const steps = text.match(/test\.step\(/g)?.length ?? 0;
      if (links < titles) problems.push(`${rel}: ${titles - links} test(s) missing the requirement annotation`);
      if (steps < titles) problems.push(`${rel}: tests must use test.step()`);
    }
    if (rel.startsWith('tests/pages/') && /\bexpect\(/.test(text)) {
      problems.push(`${rel}: assertions belong in tests, where falsification can reach them`);
    }
  }

  try {
    inventory();
  } catch (e) {
    problems.push(`Playwright cannot list tests: ${(e as Error).message}`);
  }

  problems.forEach((p) => console.log(`FAIL ${p}`));
  console.log(problems.length ? `${problems.length} problem(s).` : `OK: Playwright ${version}, image pinned, code rules clean.`);
  if (problems.length) process.exitCode = 1;
}
