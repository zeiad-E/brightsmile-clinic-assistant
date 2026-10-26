import { z } from 'zod';
import { requireAdmin } from '../../db/supabase.js';
import * as catalogService from '../../services/catalogService.js';
import * as knowledgeGapModel from '../../models/knowledgeGapModel.js';
import { retrieve } from '../../rag/retrieve.js';
import { bestMatch } from '../../utils/text.js';
import { logger } from '../../utils/logger.js';
import { defineTool, toolError } from './define.js';

/** Facts about the clinic: the knowledge base, treatments and prices, doctors. */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const searchKnowledge = defineTool({
  name: 'search_knowledge',
  description:
    "Search the clinic's knowledge base (services, prices, hours, insurance, policies, preparation, location). Use it for any factual question about the clinic, and cite the source titles in your answer.",
  schema: z.object({ query: z.string().min(2).max(300).describe('The question to look up, in the patient’s words.') }),
  run: async ({ query }, ctx) => {
    const results = await retrieve(query, { topK: 4, language: ctx.language });
    if (!results.length) {
      knowledgeGapModel
        .record(requireAdmin(), { question: query, language: ctx.language, conversationId: ctx.conversation.id })
        .catch((err) => logger.warn(`Knowledge gap not recorded: ${err.message}`));
      return { results: [], note: 'Nothing found. Say you do not have that information and offer to connect them with staff.' };
    }
    return { results: results.map((r) => ({ source: r.source, language: r.language, text: r.text })) };
  },
});

/**
 * The assistant notes a clinic question it couldn't answer from its sources. The owner sees
 * these (most asked first) and adds the missing information to the knowledge base.
 */
export const noteKnowledgeGap = defineTool({
  name: 'note_knowledge_gap',
  description:
    'Call when the patient asked a CLINIC question (services, prices, policies, facilities…) that your tools could not answer. Records it for the clinic owner to add to the knowledge base. Not for off-topic or medical questions.',
  schema: z.object({ question: z.string().min(5).max(300).describe('The question, in the patient’s words (no personal details).') }),
  run: async ({ question }, ctx) => {
    await knowledgeGapModel.record(requireAdmin(), { question, language: ctx.language, conversationId: ctx.conversation.id });
    return { noted: true, next: 'Tell the patient you do not have that information yet and offer to connect them with staff.' };
  },
});

export const listServices = defineTool({
  name: 'list_services',
  description: 'List the treatments the clinic offers with their duration and price in EGP. Prices must come from here.',
  run: async (_args, ctx) => {
    const services = await catalogService.listServices(ctx.db);
    return {
      currency: 'EGP',
      services: services.map((s) => ({
        name_en: s.name_en,
        name_ar: s.name_ar,
        slug: s.slug,
        duration_minutes: s.duration_minutes,
        price_egp: s.price_egp,
      })),
    };
  },
});

export const listDoctors = defineTool({
  name: 'list_doctors',
  description: 'List the clinic’s doctors and hygienists, the services each offers and the days they work. Optionally only those offering one service.',
  schema: z.object({ service: z.string().max(80).optional().describe('Service name or slug, to filter by.') }),
  run: async ({ service }, ctx) => {
    const [doctors, services] = await Promise.all([catalogService.listDoctors(ctx.db), catalogService.listServices(ctx.db)]);
    let filtered = doctors;
    if (service) {
      const match = bestMatch(services, service, ['slug', 'name_en', 'name_ar']);
      if (!match) return toolError('service_not_found', `No service matches "${service}".`, { services: services.map((s) => s.name_en) });
      filtered = doctors.filter((d) => d.service_ids.includes(match.id));
    }
    const nameOf = new Map(services.map((s) => [s.id, s.name_en]));
    return {
      doctors: filtered.map((d) => ({
        name_en: d.full_name_en,
        name_ar: d.full_name_ar,
        title: d.title,
        services: d.service_ids.map((id) => nameOf.get(id)).filter(Boolean),
        working_days: [...new Set(d.working_hours.map((h) => WEEKDAYS[h.weekday]))],
        hours: d.working_hours.map((h) => `${WEEKDAYS[h.weekday]} ${h.start_time}–${h.end_time}`),
      })),
    };
  },
});
