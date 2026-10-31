# Platform components

Each page owns its components and page-specific hooks in one folder:

- `swap/`: the form, quote review, preferences, token picker, recent swaps and controller.
- `arena/`: paper Arena queries, chart and presentation helpers.
- `operator/`: access gate, dashboard, inventory, journal and operator controller.
- `stats/`: the public statistics page.
- `overview/`: dashboard panels, chart, tape, mission list and page presentation helpers.
- `agent/`: command entry, mission ticket, progress, slices, results and market rail.
- `shell/`: shared navigation and shell controls.

`primitives.tsx` and `price-anatomy.tsx` remain shared. Controllers preserve the original
hook order; view components add no wrapper DOM. App route files import each page from its folder.

The browser agent lives in `src/lib/agent/runtime/`. Its facade preserves the old
`runtime.ts` import path and subscription callbacks. Feed sensing, mission state, controls,
reports, scheduling, slice execution and markout measurement share one tab-local state.
The slice execution loop keeps pricing, verification, guards and paper settlement together
so cancellation, the hold deadline and the single expiry retry keep their original order.
