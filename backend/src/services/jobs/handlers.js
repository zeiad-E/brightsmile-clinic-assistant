import { registerJob } from './jobRunner.js';
import * as memoryService from '../memoryService.js';

/** Every background job type and the function that runs it. */
export function registerJobHandlers() {
  registerJob('summarize_conversation', memoryService.summarizeOlderMessages);
  registerJob('finalize_conversation', memoryService.finalizeConversation);
  registerJob('consolidate_memories', memoryService.consolidateMemories);
}
