import type { z } from "zod";
import { EngineError } from "../engine";
import type { AppOptions } from "./types";
export const CLIENT_HEADER = "X-Zethos-Client";
export const body = async (request: Request) =>
  request.json().catch(() => {
    throw new EngineError("invalid_request", 400, "Body must be JSON");
  });
export const limit = (value: string | undefined, fallback: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 1), 100);
export const validated = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new EngineError("invalid_request", 400, parsed.error.issues[0]?.message);
  return parsed.data;
};
export async function authentication(auth: AppOptions["auth"]) {
  if (!auth) throw new EngineError("unauthorized", 401, "Operator access is not configured");
  return auth();
}
