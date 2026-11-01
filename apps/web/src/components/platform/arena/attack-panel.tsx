"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createZethos, type Pair } from "@zethos/sdk";
import { useEffect, useRef, useState } from "react";
import { useEngineStatus } from "../../../hooks/platform/use-platform";
import { type AttackMode, type Attempt, runAttack } from "../../../lib/arena/attack";
import { failureMessage } from "../../../lib/engine/sdk";
import { formatNumber, platformConfig, shortAddress } from "../../../lib/platform-config";
import { Select } from "../select";

const modes = [
  { value: "naive", label: "Naive" },
  { value: "sniper", label: "Sniper" },
  { value: "rotating", label: "Rotating" },
] as const;

export function AttackPanel() {
  const status = useEngineStatus();
  const queries = useQueryClient();
  const [mode, setMode] = useState<AttackMode>("naive");
  const [pair, setPair] = useState<Pair>("HSK/USDT");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const control = useRef<AbortController | null>(null);
  const latest = attempts.at(-1);
  const engine = platformConfig.engineUrl
    ? createZethos({
        engineUrl: platformConfig.engineUrl,
        chainId: platformConfig.chain.id === 133 ? 133 : 177,
        client: `sniper/${mode}`,
        credentials: "include",
      })
    : null;
  const takers = useQuery({
    queryKey: ["engine", "arenaTakers", "attack"],
    queryFn: () => {
      if (!engine) throw new Error("Engine unavailable");
      return engine.arenaTakers();
    },
    enabled: Boolean(engine && latest),
    refetchInterval: running ? 2000 : false,
    retry: false,
  });
  const taker = takers.data?.find((t) => t.address.toLowerCase() === latest?.address.toLowerCase());
  useEffect(() => () => control.current?.abort(), []);
  async function launch() {
    if (!engine || control.current) return;
    const controller = new AbortController();
    control.current = controller;
    setAttempts([]);
    setError(null);
    setRunning(true);
    try {
      await runAttack({
        engine,
        mode,
        pair,
        signal: controller.signal,
        onAttempt: (attempt) => {
          queries.setQueryData<Attempt[]>(["arena", "sessionAttempts"], (previous = []) => [
            ...previous.filter((a) => a.address !== attempt.address || a.index !== attempt.index),
            attempt,
          ]);
          setAttempts((previous) => [
            ...previous.filter((a) => a.index !== attempt.index),
            attempt,
          ]);
          if (attempt.outcome === "filled") {
            for (const key of ["fills", "arena", "arenaTakers"])
              void queries.invalidateQueries({ queryKey: ["engine", key] });
          }
        },
      });
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      control.current = null;
      setRunning(false);
    }
  }
  const count = (outcome: Attempt["outcome"]) =>
    attempts.filter((a) => a.outcome === outcome).length;
  return (
    <section
      className="p-card p-arena-action-card mb-6"
      id="launch-attack"
      aria-label="Launch attack"
    >
      <div className="p-card-header">
        <h2>Launch attack</h2>
        <span className="p-pill">Paper</span>
      </div>
      <p>
        Try the desk for 60 seconds, at most 30 quotes per minute. These simulated fills use local
        identities and move no tokens.
      </p>
      <div className="p-attack-controls">
        <div className="p-select-field">
          <span>Mode</span>
          <Select
            ariaLabel="Attack mode"
            disabled={running}
            value={mode}
            options={modes}
            onChange={setMode}
          />
        </div>
        <div className="p-select-field">
          <span>Pair</span>
          <Select
            ariaLabel="Attack pair"
            disabled={running}
            value={pair}
            options={(status.data?.pairs ?? []).map((p) => ({
              value: p.pair,
              label: `${p.base.label ?? p.base.symbol} / ${p.quote.label ?? p.quote.symbol}`,
            }))}
            onChange={setPair}
          />
        </div>
        <button
          type="button"
          className="p-button p-button-primary"
          disabled={running || !engine || !status.data}
          onClick={() => void launch()}
        >
          Launch attack
        </button>
        {running && (
          <button type="button" className="p-button" onClick={() => control.current?.abort()}>
            Stop
          </button>
        )}
      </div>
      <p>
        {mode === "naive"
          ? "Naive fills every valid quote."
          : mode === "sniper"
            ? "Sniper waits for the market mid to move past the quoted price in its favour."
            : "Rotating fills every valid quote and changes identity after every three fills."}
      </p>
      {error && (
        <p role="alert" className="p-form-error">
          {error}
        </p>
      )}
      {!!attempts.length && (
        <>
          <p role="status">
            {attempts.length} attempts · {count("filled")} filled · {count("declined")} declined ·{" "}
            {count("refused")} refused{running ? " · Running" : " · Finished"}
          </p>
          {latest && (
            <p>
              Current taker: {shortAddress(latest.address)} · Tier:{" "}
              {taker?.tier ?? "Awaiting engine"} · Score:{" "}
              {taker ? formatNumber(taker.score, 3) : "Unavailable"}
            </p>
          )}
          {!running && count("filled") === 0 && (
            <p>
              {count("refused")
                ? "No fills. The request refusals are listed below."
                : "No fills: the market gave no edge during this run."}
            </p>
          )}
          <div className="p-table-wrap">
            <table className="p-table" aria-label="Attack attempts">
              <thead>
                <tr>
                  <th>Attempt / identity</th>
                  <th>Price</th>
                  <th>Edge</th>
                  <th>Result</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {attempts
                  .slice()
                  .reverse()
                  .map((a) => (
                    <tr key={a.index}>
                      <td>
                        {a.index} · {shortAddress(a.address)}
                      </td>
                      <td>{a.price === null ? "—" : formatNumber(a.price, 8)}</td>
                      <td>{a.edge === null ? "—" : `${formatNumber(a.edge * 100, 4)}%`}</td>
                      <td>{a.outcome}</td>
                      <td>{a.reason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
