import { doctor } from './doctor';
import { falsify } from './falsify';
import { lint, newReq, risk, trace } from './requirements';
import { select } from './select';
import { gate, healCheck, triage } from './triage';
import { verdict } from './verdict';

const commands: Record<string, (args: string[]) => void> = {
  doctor,
  'new-req': newReq,
  lint,
  risk,
  trace,
  falsify,
  triage,
  'heal-check': healCheck,
  select,
  gate,
  verdict,
};

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.log(`Usage: npm run tl -- <${Object.keys(commands).join(' | ')}>`);
  process.exit(name ? 1 : 0);
}
try {
  command(args);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
