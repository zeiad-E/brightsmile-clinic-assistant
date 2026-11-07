import { describe, expect, it } from 'vitest';
import { clip, finishTrace, startAttempt, startTrace, summarizeTrace } from '../../../src/agent/trace.js';

/** The trace is a debugging record: it must be complete, bounded in size, and readable in one log line. */
describe('trace', () => {
  it('cuts long text and says how much was cut', () => {
    expect(clip('abc', 10)).toBe('abc');
    expect(clip('a'.repeat(15), 10)).toBe(`${'a'.repeat(10)}… [+5 chars]`);
    expect(clip({ a: 1 })).toBe('{"a":1}');
    expect(clip(undefined)).toBeNull();
  });

  it('timestamps each step of an attempt, and saves without the helper', () => {
    const trace = startTrace({ turn: 2, language: 'ar', message: 'سعر التبييض كام؟' });
    const attempt = startAttempt(trace, { model: 'chain', historyMessages: 4 });
    attempt.note({ type: 'ai', model: 'gemini', ms: 1200, finish: 'stop' });
    attempt.status = 'ok';

    const saved = finishTrace(trace, { outcome: 'answered', reply: 'تكلفته 4500 جنيه' });
    expect(saved.attempts[0]).toMatchObject({ attempt: 1, model: 'chain', status: 'ok', steps: [{ type: 'ai', model: 'gemini' }] });
    expect(saved.attempts[0].steps[0].at).toBeGreaterThanOrEqual(0);
    expect(saved.attempts[0]).not.toHaveProperty('note');
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved); // plain JSON, ready for the database
  });

  it('sums a turn up in one log line, naming why a review gave no verdict', () => {
    const trace = startTrace({ turn: 3, language: 'en', message: 'hi' });
    const attempt = startAttempt(trace, { model: 'chain' });
    attempt.note({ type: 'ai', model: 'gemini', ms: 1500, finish: 'tool_calls', toolCalls: [{ name: 'list_services' }] });
    attempt.note({ type: 'tool', name: 'list_services', ok: true });
    attempt.note({ type: 'ai', model: 'gemini', ms: 900, finish: 'stop' });
    attempt.note({ type: 'review', requested: 'gpt-oss-20b', model: 'openai/gpt-oss-20b', error: 'unreadable answer: no verdict' });
    trace.notes.push('sent although the reviewer objected');

    const line = summarizeTrace(trace, { conversationId: 'c1', outcome: 'answered', latencyMs: 4200 });
    expect(line).toContain('[trace] c1 turn 3 answered 4.2s');
    expect(line).toContain('ai(gemini 1.5s tool_calls → list_services)');
    expect(line).toContain('tool(list_services ok)');
    expect(line).toContain('review(openai/gpt-oss-20b no verdict: unreadable answer');
    expect(line).toContain('sent although the reviewer objected');
  });
});
