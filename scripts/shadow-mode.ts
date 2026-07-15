import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ShadowRunStore, createShadowReport, evaluateShadowGoNoGo } from '@lead-finder/shared';
const [command = 'help', runId = randomUUID()] = process.argv.slice(2); const dir = join(process.cwd(), '.shadow-runs'); await mkdir(dir, { recursive: true }); const file = join(dir, `${runId}.json`);
if (command === 'start') { const store = new ShadowRunStore(); const run = store.start({ runId, segment: process.env.SHADOW_SEGMENT ?? 'unconfigured', region: process.env.SHADOW_REGION ?? 'unconfigured', source: process.env.SHADOW_SOURCE ?? 'unconfigured', now: new Date() }); await writeFile(file, JSON.stringify(run, null, 2)); console.log(JSON.stringify({ runId, status: 'ACTIVE' })); }
else if (command === 'status') console.log(await readFile(file, 'utf8'));
else console.error('Usage: shadow-mode start [runId] | status <runId>. Use runtime API to finish, abort, or generate a report.');
