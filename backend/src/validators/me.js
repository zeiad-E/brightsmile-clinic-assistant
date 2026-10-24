import { z } from 'zod';
import { Language } from './common.js';

export const UpdateMeBody = z.object({ preferred_language: Language });
