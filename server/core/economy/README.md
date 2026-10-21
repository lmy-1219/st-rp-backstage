# Economy pure core

- `index.mjs` exports the synchronous `rebuildEconomy(input)` function for deterministic, single-currency reconstruction from a complete synthetic source view.
- `display.mjs` exports the synchronous `adaptEconomyDisplay(input)` function. It strictly validates an already filtered visibility envelope and converts only the supplied account fields and operations to fixed neutral display labels.

The modules perform no I/O and own no persistence, source collection, recipient authorization, binding decisions, pricing, or external account behavior. Display context and recipient fields are typed data, not authorization credentials; callers remain responsible for filtering and current-request checks.
