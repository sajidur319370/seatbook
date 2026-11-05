import { z } from 'zod';
import { objectIdSchema } from './common';

export const addSeatSchema = z.object({ seatId: objectIdSchema });
