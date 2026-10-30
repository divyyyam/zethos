import { ZethosError } from "@zethos/sdk";

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (error instanceof ToolError || error instanceof ZethosError)
    return { error: error.code, message: error.message };
  return {
    error: "internal_error",
    message: "The MCP request failed. No fill will be retried automatically.",
  };
}
