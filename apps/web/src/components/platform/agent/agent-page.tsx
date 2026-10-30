"use client";

import type { ChatMessage, Pair } from "@zethos/sdk";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  agent,
  INTENT_EVENT,
  takeQueuedIntent,
  useAgentFeed,
  useAgentIdentity,
  useAgentMarket,
  useMissions,
} from "../../../hooks/platform/use-agent";
import { interpretEnglish } from "../../../lib/agent/english";
import { parseIntent } from "../../../lib/agent/intent";
import {
  formatPrice,
  formatToken,
  isActive,
  type Mission,
  type MissionStatus,
  missionTotals,
} from "../../../lib/agent/runtime";
import { agentZethos, failureMessage } from "../../../lib/engine/sdk";
import { shortAddress } from "../../../lib/platform-config";
import { RiseHeading } from "../../landing/primitives";
import { WorldCanvas, type WorldState } from "../../world/world-canvas";
import { CommandBar } from "./command-bar";
import { MarketPanels } from "./market-rail";
import { MissionDetail, MissionStage, STATUS_LABEL } from "./mission-card";
import { SignalField } from "./signal-field";

const CONNECTION: Record<string, string> = {
  live: "Live",
  polling: "Polling",
  connecting: "Connecting",
  offline: "Engine offline",
  unconfigured: "No engine",
};

/** The world follows the agent: the hour and the depth curve say what it's doing. */
function worldFor(status: MissionStatus | undefined): WorldState {
  switch (status) {
    case "draft":
      return { day: 0.3, cam: 0.13, morph: 0, lake: 1 };
    case "armed":
      return { day: 0.82, cam: 0.13, morph: 0, lake: 1 };
    case "running":
    case "holding":
      return { day: 0.45, cam: 0.04, morph: 1, lake: 0 };
    case "measuring":
      return { day: 0.58, cam: 0.04, morph: 1, lake: 0 };
    case "done":
      return { day: 0.68, cam: 0.13, morph: 0, lake: 1 };
    case "stopped":
    case "failed":
      return { day: 1, cam: -0.05, morph: 0, lake: 1 };
    default:
      return { day: 0.05, cam: 0.13, morph: 0, lake: 1 };
  }
}

function LedgerRow({
  mission,
  focused,
  onFocus,
  onDismiss,
}: {
  mission: Mission;
  focused: boolean;
  onFocus: () => void;
  onDismiss: () => void;
}) {
  const totals = missionTotals(mission);
  const plan = mission.plan;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 border-t border-line py-3 md:grid-cols-[minmax(0,1fr)_16rem_7rem_auto]">
      <button
        type="button"
        data-cursor="hover"
        aria-current={focused}
        onClick={onFocus}
        className={`min-w-0 truncate text-left ${focused ? "font-medium" : "text-fg-soft hover:text-fg"}`}
      >
        {mission.text}
      </button>
      <span className="num-sm hidden text-sm text-fg-soft md:block">
        {plan && totals.filled > 0
          ? `${formatToken(totals.received)} ${plan.boughtSymbol} at ${totals.avgPrice === null ? "—" : formatPrice(totals.avgPrice)}`
          : ""}
      </span>
      <span className="flex items-center gap-2 text-sm">
        {isActive(mission.status) && (
          <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-fg" />
        )}
        {STATUS_LABEL[mission.status]}
      </span>
      {!isActive(mission.status) && mission.status !== "draft" ? (
        <button
          type="button"
          data-cursor="hover"
          className="hidden text-sm text-fg-soft hover:text-fg md:block"
          onClick={onDismiss}
        >
          Clear
        </button>
      ) : (
        <span className="hidden md:block" />
      )}
    </li>
  );
}

export function AgentPage() {
  useAgentFeed();
  const market = useAgentMarket();
  const missions = useMissions();
  const identity = useAgentIdentity();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pairName, setPairName] = useState<Pair>("HSK/USDT");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const interpretation = useRef(0);
  const languageHistory = useRef<ChatMessage[]>([]);
  const languageIdentity = useRef(identity?.address);
  useEffect(() => {
    if (languageIdentity.current === identity?.address) return;
    languageIdentity.current = identity?.address;
    interpretation.current++;
    languageHistory.current = [];
    setInterpreting(false);
  }, [identity?.address]);

  const pairs = market.status?.pairs ?? [];
  const pair = pairs.find((row) => row.pair === pairName) ?? null;
  const draft = missions.find((mission) => mission.status === "draft");
  const focus = draft ?? missions.find((mission) => mission.id === focusId) ?? missions[0];

  const world = useRef<WorldState>(worldFor(undefined));
  const focusStatus = focus?.status;
  const [phase, setPhase] = useState<"day" | "night">("day");
  const worldWindow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = worldFor(focusStatus);
    Object.assign(world.current, target);
    setPhase(target.day >= 0.6 ? "night" : "day");
  }, [focusStatus]);
  useEffect(() => {
    const element = worldWindow.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      world.current.idle = !entry?.isIntersecting;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const run = useCallback(
    async (sentence: string) => {
      if (!identity) return;
      const attempt = ++interpretation.current;
      let intent = parseIntent(sentence).intent;
      if (intent.kind === "unknown" || languageHistory.current.length > 0) {
        if (!agentZethos) {
          setRefusal("Connect the engine to interpret English quote requests.");
          return;
        }
        setInterpreting(true);
        setRefusal(null);
        try {
          intent = await interpretEnglish(
            sentence,
            identity.address,
            agentZethos,
            languageHistory.current,
          );
        } catch (error) {
          if (attempt === interpretation.current) {
            const message =
              error && typeof error === "object" && "code" in error
                ? failureMessage(error)
                : error instanceof Error
                  ? error.message
                  : failureMessage(error);
            setRefusal(message);
            languageHistory.current = [
              ...languageHistory.current,
              { role: "user", content: sentence },
              { role: "assistant", content: message },
            ].slice(-10) as ChatMessage[];
          }
          return;
        } finally {
          if (attempt === interpretation.current) setInterpreting(false);
        }
      }
      if (attempt !== interpretation.current) return;
      languageHistory.current = [];
      const { refusal: refused, missions: created } = agent.submitIntent(
        sentence,
        identity.address,
        intent,
      );
      setRefusal(refused);
      if (!refused) {
        setText("");
        setFocusId(created[0]?.id ?? null);
      }
      const plan = created[0]?.plan;
      if (plan) setPairName(plan.pair);
      // Asking for a quote authorizes a read, never a fill. The runtime's dry-run
      // path fetches and verifies real engine quotes and cannot settle them.
      if (intent.kind === "swap" && intent.dryRun && created[0]) agent.authorize(created[0].id);
      input.current?.focus({ preventScroll: true });
      // The window is the stage: bring the whole mission into view, as the landing frames its own.
      if (created.length > 0) {
        worldWindow.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }
    },
    [identity],
  );

  // Sentences from the palette or the overview. Drafting waits for the first market read, and a
  // draft still needs the user's go-ahead here.
  const ready = market.status !== null;
  useEffect(() => {
    if (!ready || !identity) return;
    const drain = () => {
      const sentence = takeQueuedIntent();
      if (sentence) run(sentence);
    };
    drain();
    window.addEventListener(INTENT_EVENT, drain);
    return () => window.removeEventListener(INTENT_EVENT, drain);
  }, [ready, identity, run]);

  useEffect(() => {
    // Deep link: /agent?intent=… fills the bar and leaves the decision to the user.
    const shared = new URLSearchParams(window.location.search).get("intent");
    if (shared) setText(shared.slice(0, 200));
    input.current?.focus();
  }, []);

  useEffect(() => {
    const focusBar = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focusBar);
    return () => window.removeEventListener("keydown", focusBar);
  }, []);

  const offline = market.connection === "offline";
  const unconfigured = market.connection === "unconfigured";
  return (
    <MotionConfig reducedMotion="user">
      <div data-landing data-phase={phase} className="a-page">
        <div aria-hidden className="world-fallback world-fallback-day" />
        <div aria-hidden className="world-fallback world-fallback-night" />
        <WorldCanvas state={world} className="world-canvas" />

        <section aria-labelledby="agent-title" className="relative sect overflow-clip py-4">
          <div
            ref={worldWindow}
            className={`world-window relative flex scroll-mt-[84px] flex-col ${focus ? "min-h-[max(560px,calc(100svh-100px))]" : "min-h-[max(520px,calc(100svh-110px))]"}`}
          >
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-[inherit] transition-colors duration-700 ${
                focus
                  ? "bg-[rgb(13_11_43/0.5)]"
                  : "bg-[linear-gradient(to_top,rgb(13_11_43/0.82),rgb(13_11_43/0.42)_50%,rgb(13_11_43/0.3))]"
              }`}
            />
            <div
              className={`relative flex flex-1 flex-col p-inset ${focus ? "" : "justify-center"}`}
            >
              {!focus && (
                <div className="ink-light mx-auto mb-6 w-full max-w-[920px] px-7">
                  <RiseHeading
                    as="h1"
                    id="agent-title"
                    lines={["Say what you want.", "*Zethos does the rest.*"]}
                    className="display t-statement text-fg"
                  />
                  <p className="mt-3 max-w-[620px] text-[15px] text-fg-soft">
                    Plain words become a plan with hard limits. Authorize it once, and the agent
                    prices off live order books, checks its own quote, settles, then measures how
                    the fill aged.
                  </p>
                </div>
              )}
              {focus && (
                <h1 id="agent-title" className="sr-only">
                  Agent
                </h1>
              )}
              <CommandBar
                ref={input}
                value={text}
                onChange={(value) => {
                  setText(value);
                  setRefusal(null);
                }}
                onSubmit={(sentence) => {
                  void run(sentence ?? text);
                }}
                disabled={interpreting || !identity}
                placeholder={
                  interpreting ? "Understanding your request…" : "Ask for a quote in your own words"
                }
                onEmptyEnter={() => {
                  if (draft) agent.authorize(draft.id);
                }}
                onEscape={() => {
                  if (text) setText("");
                  else if (draft) agent.discard(draft.id);
                  setRefusal(null);
                }}
                refusal={refusal}
                pairs={pairs}
                hasDraft={Boolean(draft)}
              />
              {focus && (
                <div className="mt-block flex-1">
                  <MissionStage
                    key={focus.id}
                    mission={focus}
                    onAuthorize={() => agent.authorize(focus.id)}
                    onDiscard={() => agent.discard(focus.id)}
                    onStop={() => agent.stop(focus.id)}
                    onRun={run}
                  />
                </div>
              )}
            </div>

            <dl className="ink-light relative flex flex-wrap items-end gap-x-block gap-y-3 px-inset pb-inset">
              <div>
                <dt className="sr-only">Pair</dt>
                <dd className="flex gap-3 pb-1">
                  {(["HSK/USDT", "ETH/USDT"] as const).map((name) => (
                    <button
                      type="button"
                      key={name}
                      aria-pressed={pairName === name}
                      data-cursor="hover"
                      className={`text-sm ${pairName === name ? "font-medium underline underline-offset-4" : "text-fg-soft"}`}
                      onClick={() => setPairName(name)}
                    >
                      {name}
                    </button>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-fg-soft">Fused mid</dt>
                <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
                  {pair?.mid != null ? formatPrice(pair.mid) : "—"}
                </dd>
              </div>
              {pair?.halfSpread && pair.mid != null && (
                <>
                  <div>
                    <dt className="text-sm text-fg-soft">Bid</dt>
                    <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
                      {formatPrice(pair.mid * (1 - pair.halfSpread.sell))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-fg-soft">Ask</dt>
                    <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
                      {formatPrice(pair.mid * (1 + pair.halfSpread.buy))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-fg-soft">Spread</dt>
                    <dd className="num mt-1.5 text-[max(1.75rem,calc(var(--cw)*0.026))]">
                      {((pair.halfSpread.buy + pair.halfSpread.sell) * 10_000).toFixed(1)}
                      <span className="ml-1 font-sans text-sm tracking-normal">bps</span>
                    </dd>
                  </div>
                </>
              )}
              <div className="ml-auto flex items-center gap-2 pb-1">
                <span className="text-sm text-fg-soft">
                  {identity?.source === "wallet" ? "Wallet" : "Browser ID"}{" "}
                  <span className="num-sm text-fg">
                    {identity ? shortAddress(identity.address) : "…"}
                  </span>
                  <span className="mx-2 opacity-50">·</span>
                </span>
                {market.connection === "live" && (
                  <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-white" />
                )}
                <span className="text-sm text-fg-soft">{CONNECTION[market.connection]}</span>
              </div>
            </dl>
          </div>
        </section>

        {(offline || unconfigured) && (
          <p role="alert" className="relative sect bg-white pt-6 font-medium">
            {unconfigured
              ? "No engine is configured, so the agent can read sentences but can’t act on them."
              : `${market.error ?? "The engine isn’t responding."} The numbers here are the last ones received, not live.`}
          </p>
        )}

        <div className="relative bg-white">
          {focus && (focus.quote || focus.log.length > 0) && (
            <section aria-label="Mission detail" className="sect pt-head">
              <MissionDetail mission={focus} />
            </section>
          )}

          {missions.length > 1 && (
            <section aria-label="Missions" className="sect pt-head">
              <p className="eyebrow pb-4 text-fg-soft">Missions this session</p>
              <ol className="min-w-0">
                {missions.map((mission) => (
                  <LedgerRow
                    key={mission.id}
                    mission={mission}
                    focused={mission.id === focus?.id}
                    onFocus={() => setFocusId(mission.id)}
                    onDismiss={() => agent.dismiss(mission.id)}
                  />
                ))}
              </ol>
            </section>
          )}

          <section aria-label="Exchange prices" className="sect pt-head">
            <h2 className="t-title text-fg">
              Every exchange, <em>fused into one</em>
            </h2>
            <div className="mt-6">
              <SignalField
                venues={market.venues[pairName] ?? {}}
                fills={market.tape.filter((fill) => fill.pair === pairName)}
                order={pair?.sources.map((source) => source.venue) ?? []}
              />
            </div>
            <div className="mt-block pb-head">
              <MarketPanels market={market} pair={pair} />
            </div>
          </section>
        </div>
      </div>
    </MotionConfig>
  );
}
