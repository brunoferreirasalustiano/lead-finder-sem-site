import type { NormalizedLead } from '@lead-finder/shared';

export function calculateLeadScore(lead: NormalizedLead): number {
  let score = 0;
  if (lead.whatsapp) score += 30;
  if (lead.phone) score += 20;
  if (lead.instagram) score += 15;
  if (lead.email) score += 15;
  if (lead.address) score += 10;
  if (!lead.website) score += 10;
  const useful = [
    lead.name,
    lead.phone,
    lead.whatsapp,
    lead.email,
    lead.instagram,
    lead.address,
  ].filter(Boolean).length;
  if (useful < 2) score -= 30;
  if (lead.isClosed) score -= 50;
  return Math.max(0, Math.min(100, score));
}
