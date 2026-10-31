import type { OperatorAuth } from "../auth";
import type { Engine } from "../engine";
import type { Assistant } from "../llm";
export interface AppOptions {
  engine: () => Promise<Engine>;
  corsOrigins: string[];
  waitUntil: (promise: Promise<unknown>) => void;
  auth?: () => Promise<OperatorAuth>;
  assistant?: Assistant;
  clock?: () => number;
  adminToken?: string | null | (() => string | null | Promise<string | null>);
}

export interface RouteOptions {
  engine: AppOptions["engine"];
  auth: AppOptions["auth"];
  assistant: AppOptions["assistant"];
  clock: () => number;
  adminToken?: AppOptions["adminToken"];
}
