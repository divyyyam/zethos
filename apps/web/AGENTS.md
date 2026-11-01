<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Zethos web app

Read the root [`AGENTS.md`](../../AGENTS.md) first for the product, the final feature list and
the invariants. The frontend ↔ engine ↔ vault contract is in [`INTEGRATION.md`](./INTEGRATION.md).

- The UI is complete. Work here is wiring, not redesign: connect to the real engine and the
  deployed vault, and keep every existing safety check in `src/lib/engine/` and
  `src/hooks/platform/use-swap-execution.ts`.
- Do not touch any landing component file in `src/components/landing/` unless the user
  explicitly requests a landing-page change. Preserve the horizon, world windows, scroll
  transitions, animations and all landing sections. This also protects `src/components/world/`,
  `src/app/(marketing)/`, `src/content/landing.ts` and landing styles in `src/app/globals.css`.
  Engine integration, deployment configuration and data cleanup must not hide, remove, replace
  or redesign landing sections, or condition their visibility on `NEXT_PUBLIC_ENGINE_URL`.
- `src/lib/engine/{client,verify-quote,types}.ts` will be extracted into `packages/sdk`. Keep
  them free of React and Next imports.
- `/agent` uses the landing's design system (`[data-landing]`, serif display, world windows,
  the quote ticket), not the platform cards. Keep it that way. Its parser refuses what it can't
  fully read; don't make it guess, because users authorize what it compiles.
- Every platform page renders inside the dashboard shell (`components/platform/shell`, `app/(app)/shell.css`).
  The shell re-points `--cw` and `--edge`, so size page content from those, not from `100vw`.
- Sample data lives only in `src/content/*.mock.ts` and is always labeled.
