// Chapter 6, "Let Effort choose". Effort's real rules run here, in the browser,
// on what the visitor types. Nothing is sent anywhere. Effort only picks an
// effort level; the model line is this guide's own rule and is labeled as such.
import { recommend } from '../../src/policy.mjs';

export interface Recommendation {
  effort: 'low' | 'medium' | 'high';
  reasons: string[];
  policyVersion: string;
  caveat: string;
  features: { critical: boolean; complex: boolean; mechanical: boolean };
}
export const EXAMPLES = [
  'Fix the typo in the README',
  'Add a dark mode toggle to the settings page',
  'Investigate an intermittent race condition in the job queue',
  'Refactor the payment retry logic and migrate the old records',
];

export function effortPick(prompt: string): Recommendation | null {
  try { return recommend({ prompt, provider: 'generic', maxEffort: 'high' }) as Recommendation; } catch { return null; }
}

/** The guide's model rule, independent of Effort: role tier from the same prompt signals. */
export function guideModelRole(f: Recommendation['features']): { role: 'fast' | 'daily' | 'frontier'; why: string } {
  if (f.critical && f.complex) return { role: 'frontier', why: 'The request is both high-stakes and tangled, which is where the most capable model earns its price.' };
  if (f.mechanical && !f.critical && !f.complex) return { role: 'fast', why: 'A short mechanical job does not need a big model. The lightest one is faster and far cheaper.' };
  return { role: 'daily', why: 'For most real work, start with the family’s “Start here” model and only move if the result disappoints.' };
}
