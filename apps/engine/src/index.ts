import { serverEnvSchema } from "./config";
import { app } from "./server";

const { PORT } = serverEnvSchema.parse(Bun.env);
const server = Bun.serve({ port: PORT, fetch: app.fetch });

console.info(`Zethos engine listening on ${server.url}`);
