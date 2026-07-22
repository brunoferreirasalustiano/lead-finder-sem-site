import type { SuppressionEntry } from './types.js';

export function suppressionChannel(entry: SuppressionEntry): 'EMAIL' | 'WHATSAPP' | null {
  if (entry.suppressionType !== 'OPT_OUT_CHANNEL') return null;
  if (!entry.channel) throw new Error('CHANNEL_SCOPE_INVALID');
  return entry.channel;
}
