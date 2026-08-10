import { readFile } from 'node:fs/promises';
import { manifestContentSchema, manifestSchema, type SuppressionManifest } from './types.js';
import { sha256 } from './canonical.js';

const MAX_BYTES = 16 * 1024 * 1024;
const forbidden = new Set(['name', 'phone', 'telephone', 'whatsapp', 'email', 'address', 'cnpj', 'payload', 'message', 'token', 'secret', 'connectionstring', 'databaseurl']);
function rejectForbidden(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(rejectForbidden);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key.replace(/[_-]/gu, '').toLowerCase())) throw new Error('FORBIDDEN_PII_FIELD');
    rejectForbidden(child);
  }
}
const targetKey = (entry: SuppressionManifest['entries'][number]) => `${entry.leadId ?? `${entry.stableIdentity?.osmType}:${entry.stableIdentity?.osmId}`}|${entry.suppressionType}|${entry.channel ?? '*'}`;
export function validateManifestValue(value: unknown): SuppressionManifest {
  rejectForbidden(value);
  const manifest = manifestSchema.parse(value);
  const { digest, ...content } = manifest;
  manifestContentSchema.parse(content);
  if (sha256(content) !== digest) throw new Error('MANIFEST_DIGEST_MISMATCH');
  if (manifest.counts.total !== manifest.entries.length) throw new Error('MANIFEST_COUNTS_MISMATCH');
  const actual = Object.fromEntries(Object.keys(manifest.counts.byType).map((type) => [type, manifest.entries.filter((entry) => entry.suppressionType === type).length]));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.counts.byType)) throw new Error('MANIFEST_COUNTS_MISMATCH');
  if (manifest.precontactPermanent.counts.fingerprints !== manifest.precontactPermanent.fingerprints.length
    || manifest.precontactPermanent.counts.events !== manifest.precontactPermanent.events.length) throw new Error('MANIFEST_COUNTS_MISMATCH');
  const seen = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (Date.parse(entry.occurredAt) > Date.parse(manifest.cutoffAt)) throw new Error('TIMESTAMP_AFTER_CUTOFF');
    const key = targetKey(entry); const encoded = JSON.stringify(entry);
    if (seen.has(key) && seen.get(key) !== encoded) throw new Error('CONFLICTING_DUPLICATE');
    if (seen.has(key)) throw new Error('DUPLICATE_ENTRY');
    seen.set(key, encoded);
  }
  const fingerprintSet = new Set<string>();
  for (const fingerprint of manifest.precontactPermanent.fingerprints) {
    if (fingerprintSet.has(fingerprint)) throw new Error('DUPLICATE_PRECONTACT_FINGERPRINT');
    fingerprintSet.add(fingerprint);
  }
  const eventSet = new Map<string, string>();
  for (const event of manifest.precontactPermanent.events) {
    if (Date.parse(event.occurredAt) > Date.parse(manifest.cutoffAt)) throw new Error('TIMESTAMP_AFTER_CUTOFF');
    if (!fingerprintSet.has(event.identityFingerprint)) throw new Error('PRECONTACT_EVENT_IDENTITY_MISSING');
    const encoded = JSON.stringify(event);
    if (eventSet.has(event.eventFingerprint) && eventSet.get(event.eventFingerprint) !== encoded) throw new Error('CONFLICTING_PRECONTACT_EVENT');
    if (eventSet.has(event.eventFingerprint)) throw new Error('DUPLICATE_PRECONTACT_EVENT');
    eventSet.set(event.eventFingerprint, encoded);
  }
  return manifest;
}
export async function loadManifest(path: string): Promise<SuppressionManifest> {
  const buffer = await readFile(path);
  if (buffer.byteLength > MAX_BYTES) throw new Error('MANIFEST_SIZE_LIMIT');
  let value: unknown; try { value = JSON.parse(buffer.toString('utf8')); } catch { throw new Error('INVALID_MANIFEST_JSON'); }
  return validateManifestValue(value);
}
