import type { Request, RequestHandler } from 'express';
import { z } from 'zod';

export type ReqSchemas = { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };

export type Valid<S extends ReqSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

/** Parses body/query/params. A ZodError becomes 400 VALIDATION_ERROR in the error handler. */
export function validate(schemas: ReqSchemas): RequestHandler {
  return (req, _res, next) => {
    req.valid = {
      body: schemas.body?.parse(req.body ?? {}),
      query: schemas.query?.parse(req.query),
      params: schemas.params?.parse(req.params),
    };
    next();
  };
}

/** Typed access to the parsed values: `const { body } = valid(req, createEventReq)`. */
export function valid<S extends ReqSchemas>(req: Request, _schemas: S): Valid<S> {
  return req.valid as Valid<S>;
}
