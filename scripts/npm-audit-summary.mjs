import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['audit', '--json'],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error('npm audit did not return valid JSON');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(2);
}

const severityOrder = ['critical', 'high', 'moderate', 'low', 'info'];
const vulnerabilities = Object.entries(report.vulnerabilities ?? {})
  .map(([name, item]) => {
    const via = Array.isArray(item.via)
      ? item.via.map((entry) => typeof entry === 'string'
        ? { package: entry }
        : {
            package: typeof entry.name === 'string' ? entry.name : name,
            title: typeof entry.title === 'string' ? entry.title : undefined,
            severity: typeof entry.severity === 'string' ? entry.severity : undefined,
            range: typeof entry.range === 'string' ? entry.range : undefined,
          })
      : [];
    return {
      name,
      severity: item.severity,
      isDirect: item.isDirect === true,
      range: item.range,
      effects: Array.isArray(item.effects) ? item.effects : [],
      via,
      fixAvailable: item.fixAvailable ?? false,
    };
  })
  .sort((left, right) => {
    const severity = severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity);
    return severity || left.name.localeCompare(right.name);
  });

const counts = report.metadata?.vulnerabilities ?? {};
const summary = {
  generatedAt: new Date().toISOString(),
  counts,
  vulnerabilities,
};

await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/npm-audit-summary.json',
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

console.log('npm audit summary');
console.log(`critical=${counts.critical ?? 0} high=${counts.high ?? 0} moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`);
for (const item of vulnerabilities) {
  const fix = item.fixAvailable === false
    ? 'no-fix'
    : typeof item.fixAvailable === 'object'
      ? `fix:${item.fixAvailable.name ?? item.name}@${item.fixAvailable.version ?? 'unknown'}${item.fixAvailable.isSemVerMajor ? ':major' : ''}`
      : 'fix-available';
  const causes = item.via
    .map((entry) => entry.title ?? entry.package)
    .filter(Boolean)
    .join(' | ');
  console.log(`[${item.severity}] ${item.name} direct=${item.isDirect} range=${item.range ?? 'unknown'} ${fix}${causes ? ` via=${causes}` : ''}`);
}

const blocking = Number(counts.high ?? 0) + Number(counts.critical ?? 0);
if (blocking > 0) {
  console.error(`npm audit gate failed with ${blocking} high/critical vulnerabilities`);
  process.exit(1);
}
