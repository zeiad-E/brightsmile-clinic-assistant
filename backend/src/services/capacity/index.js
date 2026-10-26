import { config } from '../../config/index.js';
import { supabaseAdmin } from '../../db/supabase.js';
import { startOfDayInZone } from '../../utils/clinicTime.js';
import { createLimiter } from './limiter.js';
import { createAbuseTracker } from './abuseTracker.js';
import { createBudget } from './budget.js';
import { createCircuitBreaker } from './circuitBreaker.js';

/**
 * The chat's capacity guards, one shared instance each for the whole server.
 */

/** Today's clinic-wide token use, from agent_runs (so a restart doesn't reset the budget). */
async function loadClinicUsage(day) {
  if (!supabaseAdmin) return 0;
  const { data, error } = await supabaseAdmin
    .from('agent_runs')
    .select('tokens_in, tokens_out')
    .gte('created_at', startOfDayInZone(day).toISOString())
    .limit(20000);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);
}

export const limiter = createLimiter({
  max: config.chat.maxConcurrent,
  queueMax: config.chat.queueMax,
  maxWaitMs: config.chat.queueWaitMs,
});

export const abuse = createAbuseTracker();

export const budget = createBudget({
  perPersonMessages: config.chat.dailyMessagesPerPerson,
  perPersonTokens: config.chat.dailyTokensPerPerson,
  clinicTokens: config.chat.dailyTokensClinic,
  loadClinicUsage,
});

export const breaker = createCircuitBreaker();

/** Who a limit applies to: the signed-in user and/or the visitor's IP address. */
export const personKeys = ({ userId, ip }) => [userId ? `user:${userId}` : null, ip ? `ip:${ip}` : null].filter(Boolean);

export const capacityStatus = () => ({ queue: limiter.stats(), ai: breaker.stats(), budget: budget.stats() });
