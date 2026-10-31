import { parseUnits } from "viem";
import { z } from "zod";
import { PAIRS, type Pair, type SniperMode, VENUE_IDS, type VenueId } from "./types.js";

const uint256Regex = /^[1-9]\d*$/;
const UINT256_MAX = 2n ** 256n - 1n;

export interface ParsedSniperOptions {
  mode: SniperMode;
  pair: Pair;
  amount: string;
  edge: number;
  rotate: number;
  chain: 177 | 133;
  record?: string | undefined;
  heldOut: boolean;
  description?: string | undefined;
  scenariosDir?: string | undefined;
  venues?: VenueId[] | undefined;
  pollIntervalMs: number;
  durationSec?: number | undefined;
  maxRecords?: number | undefined;
  maxFills?: number | undefined;
  captureOnly: boolean;
}

export function parseRawFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--") || arg === "--") continue;

    const body = arg.slice(2);
    if (body.includes("=")) {
      const eqIdx = body.indexOf("=");
      flags.set(body.slice(0, eqIdx), body.slice(eqIdx + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(body, next);
        i++;
      } else {
        // Boolean flag without value
        flags.set(body, "true");
      }
    }
  }
  return flags;
}

export function resolveAmountIn(amount: string, decimals: number, symbol = "token"): string {
  const match = /^\d+(?:\.(\d+))?$/.exec(amount);
  if (!match || (match[1]?.length ?? 0) > decimals) {
    throw new Error(`Invalid ${symbol} amount: ${amount} (max ${decimals} decimals)`);
  }
  const raw = parseUnits(amount, decimals).toString();
  if (!uint256Regex.test(raw)) {
    throw new Error(`Amount must resolve to a positive base-10 integer string, got: ${raw}`);
  }
  const n = BigInt(raw);
  if (n <= 0n || n > UINT256_MAX) {
    throw new Error(`AmountIn exceeds uint256 range: ${raw}`);
  }
  return raw;
}

export function parseSniperOptions(argv: string[] = process.argv.slice(2)): ParsedSniperOptions {
  const flags = parseRawFlags(argv);

  const captureOnlyFlag = flags.get("capture-only") === "true" || flags.get("quiet") === "true";
  let modeRaw = flags.get("mode") ?? (captureOnlyFlag ? "capture-only" : "sniper");
  if (modeRaw === "quiet") modeRaw = "capture-only";

  const venuesRaw = flags.get("venues");
  let parsedVenues: VenueId[] | undefined;
  if (venuesRaw) {
    const list = venuesRaw.split(",").map((v) => v.trim());
    for (const v of list) {
      if (!VENUE_IDS.includes(v as VenueId)) {
        throw new Error(`Unknown venue: ${v}. Supported: ${VENUE_IDS.join(", ")}`);
      }
    }
    parsedVenues = list as VenueId[];
  }

  const schema = z.object({
    mode: z.enum(["naive", "sniper", "latecomer", "rotating", "capture-only"]),
    pair: z.enum(PAIRS),
    amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a decimal string"),
    edge: z.coerce.number().nonnegative(),
    rotate: z.coerce.number().int().positive(),
    chain: z.coerce.number().pipe(z.union([z.literal(177), z.literal(133)])),
    record: z.string().min(1).optional(),
    heldOut: z.boolean(),
    description: z.string().min(1).optional(),
    scenariosDir: z.string().min(1).optional(),
    pollIntervalMs: z.coerce.number().int().positive(),
    durationSec: z.coerce.number().int().positive().optional(),
    maxRecords: z.coerce.number().int().positive().optional(),
    maxFills: z.coerce.number().int().positive().optional(),
    captureOnly: z.boolean(),
  });

  const parsed = schema.parse({
    mode: modeRaw,
    pair: flags.get("pair") ?? "ETH/USDT",
    amount: flags.get("amount") ?? "100",
    edge: flags.get("edge-bps") ?? 1,
    rotate: flags.get("rotate") ?? 3,
    chain: flags.get("chain") ?? process.env.ZETHOS_CHAIN_ID ?? "177",
    record: flags.get("record"),
    heldOut: flags.get("held-out") === "true" || flags.get("heldout") === "true",
    description: flags.get("description"),
    scenariosDir: flags.get("scenarios-dir"),
    pollIntervalMs: flags.get("poll-ms") ?? flags.get("poll-interval-ms") ?? 2000,
    durationSec: flags.get("duration-sec"),
    maxRecords: flags.get("max-records"),
    maxFills: flags.get("max-fills"),
    captureOnly: captureOnlyFlag || modeRaw === "capture-only",
  });

  return {
    ...parsed,
    venues: parsedVenues,
  };
}
