import { type Address, type Hex, verifyMessage } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { EngineError } from "../engine";

interface AuthState {
  nonces: Record<string, number>;
  sessions: Record<string, { address: Address; expiry: number }>;
}
export interface AuthStorage {
  load(): Promise<AuthState | null>;
  save(state: AuthState): Promise<void>;
}

export const COOKIE = "zethos_session";
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
const denied = () => new EngineError("unauthorized", 401, "Sign in with the operator wallet");

export class OperatorAuth {
  private state: AuthState = { nonces: {}, sessions: {} };
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      operator: Address;
      secret: string;
      origins: string[];
      chainId: number;
      storage?: AuthStorage;
    },
  ) {
    if (new TextEncoder().encode(options.secret).length < 32)
      throw new Error("SESSION_SECRET must be at least 32 bytes");
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      if (!this.loaded) {
        this.state = (await this.options.storage?.load()) ?? this.state;
        this.loaded = true;
      }
      return action();
    });
    this.queue = work.catch(() => {});
    return work;
  }

  nonce(now: number): Promise<string> {
    return this.serial(async () => {
      for (const [nonce, expiry] of Object.entries(this.state.nonces))
        if (expiry <= now) delete this.state.nonces[nonce];
      for (const [id, session] of Object.entries(this.state.sessions))
        if (session.expiry <= now) delete this.state.sessions[id];
      if (Object.keys(this.state.nonces).length >= 1000) throw new EngineError("rate_limited", 429);
      const nonce = random();
      this.state.nonces[nonce] = now + 300000;
      await this.save();
      return nonce;
    });
  }

  verify(
    input: unknown,
    now: number,
  ): Promise<{ token: string; expiry: number; address: Address }> {
    return this.serial(async () => {
      const parsed = z
        .object({
          message: z.string().max(8192),
          signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        })
        .safeParse(input);
      if (!parsed.success) throw denied();
      const { message, signature } = parsed.data;
      const siwe = parseSiweMessage(message);
      const nonce = siwe.nonce;
      const issued = siwe.issuedAt?.getTime();
      const expiry = siwe.expirationTime?.getTime();
      const origin = this.options.origins.find((o) => {
        const url = new URL(o);
        return (
          url.host === siwe.domain &&
          siwe.uri === o &&
          (siwe.scheme === undefined || siwe.scheme === url.protocol.slice(0, -1))
        );
      });
      if (
        !origin ||
        !nonce ||
        (this.state.nonces[nonce] ?? 0) <= now ||
        issued === undefined ||
        !Number.isFinite(issued) ||
        issued > now ||
        now - issued > 300000 ||
        expiry === undefined ||
        !Number.isFinite(expiry) ||
        expiry <= now ||
        expiry > now + 86400000 ||
        siwe.chainId !== this.options.chainId ||
        siwe.version !== "1" ||
        !validateSiweMessage({
          address: this.options.operator,
          domain: new URL(origin).host,
          nonce,
          message: siwe,
          time: new Date(now),
        })
      )
        throw denied();
      if (
        !(await verifyMessage({
          address: this.options.operator,
          message,
          signature: signature as Hex,
        }).catch(() => false))
      )
        throw denied();
      const previous = structuredClone(this.state);
      delete this.state.nonces[nonce];
      const id = random();
      this.state.sessions[id] = { address: this.options.operator, expiry };
      try {
        await this.save();
      } catch (error) {
        this.state = previous;
        throw error;
      }
      return { token: `${id}.${await this.mac(id)}`, expiry, address: this.options.operator };
    });
  }

  require(token: string | undefined, now: number): Promise<Address> {
    return this.serial(async () => {
      if (!token || token.length > 256) throw denied();
      const [id, signature] = token.split(".");
      if (!id || !signature || signature !== (await this.mac(id))) throw denied();
      const session = this.state.sessions[id];
      if (
        !session ||
        session.expiry <= now ||
        session.address.toLowerCase() !== this.options.operator.toLowerCase()
      )
        throw denied();
      return session.address;
    });
  }

  logout(token: string | undefined): Promise<void> {
    return this.serial(async () => {
      const id = token?.split(".")[0];
      if (id) delete this.state.sessions[id];
      await this.save();
    });
  }

  private async mac(id: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.options.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
    return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  }
  private async save(): Promise<void> {
    await this.options.storage?.save(structuredClone(this.state));
  }
}
