import type { z } from "zod";
import { EngineError } from "./errors";

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new EngineError("invalid_request", 400, result.error.issues[0]?.message);
  return result.data;
}
