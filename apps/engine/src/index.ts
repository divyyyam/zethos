import type { Env } from "./durable/market";

export { Market } from "./durable/market";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.MARKET.get(env.MARKET.idFromName("main")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
