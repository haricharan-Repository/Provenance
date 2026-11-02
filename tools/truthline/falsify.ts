import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { ROOT, TL, config, flag, inventory, runJson, flatten, today, write, type TestRun } from './lib';

type Runtime = { match: string; except?: string; kind: 'api-tamper' | 'element-remove'; [k: string]: unknown };
interface Edit { start: number; end: number; text: string }
interface Mutant { test: string; source: string; name: string; edits: Edit[]; use?: Omit<Runtime, 'match'>; path?: string }
export type Verdict = 'PROVEN' | 'HOLLOW' | 'HOLLOW→FIXED' | 'FLAKY' | 'BROKEN';
export interface Evidence {
  key: string;
  verdict: Verdict;
  mutations: { name: string; result: 'KILLED' | 'SURVIVED' | 'INVALID' }[];
  stability: string;
}

const parse = (path: string) =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const isExpect = (n: ts.Node): n is ts.CallExpression => {
  if (!ts.isCallExpression(n)) return false;
  const c = n.expression;
  return (ts.isIdentifier(c) && c.text === 'expect') ||
    (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'expect');
};

const walk = (root: ts.Node, visit: (n: ts.Node) => void) => {
  const go = (n: ts.Node) => { visit(n); ts.forEachChild(n, go); };
  go(root);
};

const testCalls = (sf: ts.SourceFile) => {
  const found: { title: string; call: ts.CallExpression; fn: ts.ArrowFunction | ts.FunctionExpression }[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'test') return;
    const [title] = n.arguments;
    const fn = n.arguments[n.arguments.length - 1];
    if (title && ts.isStringLiteralLike(title) && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      found.push({ title: title.text, call: n, fn });
    }
  });
  return found;
};

// Every assertion in a test: flip its expected value, or negate it if there is no literal to flip.
function assertionFlips(sf: ts.SourceFile, fn: ts.Node) {
  const flips: { name: string; edit: Edit }[] = [];
  walk(fn, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const matcher = n.expression.name.text;
    if (!matcher.startsWith('to')) return;
    const receiver = n.expression.expression;
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const name = `flip L${line} ${matcher}`;
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not' && isExpect(receiver.expression)) {
      flips.push({ name, edit: { start: receiver.expression.end, end: receiver.end, text: '' } });
    } else if (isExpect(receiver)) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        flips.push({ name, edit: { start: arg.getStart(sf), end: arg.end, text: JSON.stringify(`${arg.text} [mutated]`) } });
      } else if (arg && ts.isNumericLiteral(arg)) {
        flips.push({ name, edit: { start: arg.getStart(sf), end: arg.end, text: String(Number(arg.text) + 1) } });
      } else {
        flips.push({ name, edit: { start: receiver.end, end: receiver.end, text: '.not' } });
      }
    }
  });
  return flips;
}

// Top-level `await test.step(...)` statements holding an action. Steps with assertions are
// covered by the flips, and removing them would pass trivially.
function stepSkips(sf: ts.SourceFile, fn: ts.ArrowFunction | ts.FunctionExpression) {
  const skips: { name: string; edit: Edit }[] = [];
  if (!ts.isBlock(fn.body)) return skips;
  for (const st of fn.body.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isAwaitExpression(st.expression)) continue;
    const call = st.expression.expression;
    if (!ts.isCallExpression(call) || !call.expression.getText(sf).endsWith('test.step')) continue;
    const [label] = call.arguments;
    const stepName = label && ts.isStringLiteralLike(label) ? label.text : 'unnamed';
    let asserts = false;
    walk(call, (n) => { if (isExpect(n)) asserts = true; });
    if (asserts || /clean ?up|teardown/i.test(stepName)) continue;
    skips.push({ name: `skip step "${stepName}"`, edit: { start: st.getStart(sf), end: st.end, text: '' } });
  }
  return skips;
}

const lastImportEnd = (sf: ts.SourceFile) =>
  sf.statements.filter(ts.isImportDeclaration).reduce((end, s) => Math.max(end, s.end), 0);

function buildMutants(tests: TestRun[], runtime: Runtime[]): Mutant[] {
  const mutants: Mutant[] = [];
  for (const file of new Set(tests.map((t) => t.file))) {
    const source = join(ROOT, 'tests', file);
    const sf = parse(source);
    for (const { title, call, fn } of testCalls(sf)) {
      const inv = tests.find((t) => t.file === file && t.title === title);
      if (!inv) continue;
      const only: Edit = { start: call.expression.end, end: call.expression.end, text: '.only' };
      for (const m of [...assertionFlips(sf, fn), ...stepSkips(sf, fn)]) {
        mutants.push({ test: inv.key, source, name: m.name, edits: [only, m.edit] });
      }
      for (const { match, except, ...use } of runtime) {
        const excluded = except !== undefined && inv.tags.includes(except);
        if (!excluded && !inv.project.startsWith('api') && match.split(/\s+/).every((tag) => inv.tags.includes(tag))) {
          const name = use.kind === 'api-tamper'
            ? `tamper ${use.url} → ${use.status ?? 200} ${JSON.stringify(use.body ?? {})}`
            : `remove ${use.selector}`;
          const at = lastImportEnd(sf);
          mutants.push({
            test: inv.key, source, name, use,
            edits: [only, { start: at, end: at, text: `\ntest.use({ mutation: ${JSON.stringify(use)} as never });\n` }],
          });
        }
      }
    }
  }
  return mutants;
}

function materialize(m: Mutant, index: number) {
  const code = readFileSync(m.source, 'utf8');
  const mutated = [...m.edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, e) => text.slice(0, e.start) + e.text + text.slice(e.end), code);
  m.path = m.source.replace(/\.spec\.ts$/, `.mutant-${index}.spec.ts`);
  writeFileSync(m.path, mutated);
}

const previous = (): Evidence[] => {
  const path = join(TL, 'falsification.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { tests: Evidence[] }).tests : [];
};

function render(tests: Evidence[]) {
  const count = (v: Verdict) => tests.filter((t) => t.verdict === v).length;
  const rows = tests.flatMap((t) =>
    (t.mutations.length ? t.mutations : [{ name: 'none applicable', result: 'SURVIVED' }]).map(
      (m) => `| ${t.key.replaceAll('|', '\\|')} | ${m.name.replaceAll('|', '\\|')} | ${m.result} | ${t.verdict} | ${t.stability} |`,
    ),
  );
  return `# Falsification Evidence\n\nGenerated by \`tl falsify\` on ${today()}.\n\n` +
    `Proven: ${count('PROVEN')}. Hollow fixed: ${count('HOLLOW→FIXED')}. Hollow: ${count('HOLLOW')}. Flaky: ${count('FLAKY')}. Broken: ${count('BROKEN')}.\n\n` +
    `| Test | Mutation | Result | Verdict | Stability |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function falsify(args: string[]) {
  const grep = flag(args, 'grep');
  const filter = grep ? ['--grep', grep] : [];
  const projects = ['--project=chromium', '--project=api'];
  const repeat = config().stability.repeatEach;
  const fast = { TRUTHLINE_FAST_FAIL: '1' };

  const tests = inventory([...projects, ...filter]);
  if (!tests.length) throw new Error('No tests matched.');
  const mutationsFile = join(TL, 'mutations.json');
  const runtime: Runtime[] = existsSync(mutationsFile) ? JSON.parse(readFileSync(mutationsFile, 'utf8')) : [];

  // Baseline under the same short timeouts, so a mutant is only "killed" by the mutation.
  console.log(`Baseline: ${tests.length} test(s), ${repeat}x stability on every project.`);
  const stability = flatten(runJson([...filter, `--repeat-each=${repeat}`], fast));

  const mutants = buildMutants(tests, runtime);
  mutants.forEach(materialize);
  console.log(`Running ${mutants.length} mutant(s).`);
  let mutantRuns: TestRun[] = [];
  try {
    if (mutants.length) {
      const paths = mutants.map((m) => m.path!.slice(ROOT.length + 1));
      mutantRuns = flatten(runJson([...projects, ...paths], { TRUTHLINE_MUTATING: '1' }));
    }
  } finally {
    mutants.forEach((m) => m.path && rmSync(m.path, { force: true }));
  }

  const history = new Map(previous().map((e) => [e.key, e.verdict]));
  const evidence = tests.map((t): Evidence => {
    const runs = stability.filter((r) => r.key === t.key);
    const passes = runs.filter((r) => r.outcome === 'expected').length;
    const mutations = mutants.filter((m) => m.test === t.key).map((m) => {
      const run = mutantRuns.find((r) => r.file.endsWith(basename(m.path!)) && r.title === t.title);
      const result = !run || run.outcome === 'skipped' ? 'INVALID' as const
        : run.outcome === 'expected' ? 'SURVIVED' as const : 'KILLED' as const;
      return { name: m.name, result };
    });
    const killed = mutations.some((m) => m.result === 'KILLED');
    const hollow = !killed || mutations.some((m) => m.result === 'SURVIVED');
    const prior = history.get(t.key);
    const verdict: Verdict =
      passes === 0 ? 'BROKEN'
      : hollow ? 'HOLLOW'
      : passes < runs.length ? 'FLAKY'
      : prior === 'HOLLOW' || prior === 'HOLLOW→FIXED' ? 'HOLLOW→FIXED'
      : 'PROVEN';
    return { key: t.key, verdict, mutations, stability: `${passes}/${runs.length}` };
  });

  // A partial run must not forget evidence for tests it did not touch.
  // Evidence for deleted tests is dropped so it cannot inflate the Truth Score.
  const live = new Set(inventory().map((t) => t.key));
  const merged = [...previous().filter((e) => live.has(e.key) && !evidence.some((n) => n.key === e.key)), ...evidence];
  write(join(TL, 'falsification.json'), `${JSON.stringify({ date: today(), tests: merged }, null, 2)}\n`);
  write(join(TL, 'falsification.md'), render(merged));
  for (const e of evidence) {
    const killed = e.mutations.filter((m) => m.result === 'KILLED').length;
    console.log(`${e.verdict.padEnd(12)} ${killed}/${e.mutations.length} killed, ${e.stability} stable  ${e.key}`);
  }
  if (evidence.some((e) => e.verdict !== 'PROVEN' && e.verdict !== 'HOLLOW→FIXED')) process.exitCode = 1;
}

const assertionFingerprints = (path: string) => {
  const sf = parse(path);
  const prints: string[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const matcher = n.expression.name.text;
    const receiver = n.expression.expression;
    const negated = ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not';
    if (!matcher.startsWith('to') || !isExpect(negated ? (receiver as ts.PropertyAccessExpression).expression : receiver)) return;
    prints.push(`${negated ? 'not.' : ''}${matcher}(${n.arguments.map((a) => a.getText(sf)).join(', ')})`);
  });
  return prints.sort();
};

// Prime directive 3. Subjects may change (that is locator healing), matchers and expected values may not.
export function compareAssertions(before: string, after: string) {
  const a = assertionFingerprints(before);
  const b = [...assertionFingerprints(after)];
  const removed = a.filter((p) => {
    const i = b.indexOf(p);
    if (i < 0) return true;
    b.splice(i, 1);
    return false;
  });
  return removed;
}
