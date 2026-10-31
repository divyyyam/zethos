import type { Env } from "./api/market";

export { Market } from "./api/market";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.MARKET.get(env.MARKET.idFromName("main")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
