import { Request, Response, NextFunction } from "express";

import { AnyZodObject } from "zod";

export const validate =
  (schema: AnyZodObject) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body as unknown,
        query: req.query as unknown,
        params: req.params as unknown,
      });

      next();
    } catch (error) {
      next(error);
    }
  };
