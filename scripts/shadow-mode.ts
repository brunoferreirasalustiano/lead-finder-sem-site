import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseShadowIdentifier, ShadowRunStore, type ShadowRun } from '@lead-finder/shared';
const [command = 'help', rawRunId = randomUUID()] = process.argv.slice(2);
const runId = parseShadowIdentifier(rawRunId, 'run id');
const dir = resolve(process.cwd(), '.shadow-runs');
await mkdir(dir, { recursive: true });
const file = resolve(dir, `${runId}.json`);
if (dirname(file) !== dir) throw new Error('INVALID_SHADOW_RUN_PATH');
if (command === 'start') {
  const store = new ShadowRunStore();
  const run = store.start({ runId, segment: process.env.SHADOW_SEGMENT ?? 'unconfigured', region: process.env.SHADOW_REGION ?? 'unconfigured', source: process.env.SHADOW_SOURCE ?? 'unconfigured', now: new Date() });
  await writeFile(file, JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ runId: run.runId, status: run.status }));
}
else if (command === 'status') {
  const run = JSON.parse(await readFile(file, 'utf8')) as ShadowRun;
  console.log(JSON.stringify({ runId: parseShadowIdentifier(run.runId, 'run id'), status: run.status,
    startedAt: run.startedAt, finishedAt: run.finishedAt, abortReason: run.abortReason }));
}
else console.error('Usage: shadow-mode start [runId] | status <runId>. Use runtime API to finish, abort, or generate a report.');
