# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |
| Module checks | `specs/module-N/`, `scripts/check.mjs` | Each module's spec, instructions, rubric and acceptance tests; `npm run check` runs them |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`, except where a module has
   moved it to a database: Module 2 part 2 moves stock to a Supabase
   `inventory` table, read through `lib/copper/inventory.ts`. Facts that don't
   change daily (prices, colors) stay in the files.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Module 2: Ask Copper

**Summary:** A floating chat panel that answers price, cost and stock
questions by calling four read-only tools, and shows each step (thinking, tool
calls, results) as the answer streams in.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/page.tsx` | Mounts `<AskCopper />` and passes `isAiConfigured()` down. No new routes |
| Components | `components/copper/ask-copper.tsx`, `site-header.tsx` | Launcher, side sheet, Use tools switch, the rail of stations and tool cards; header link to `#ask` |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper({ messages, useTools })` returns a live `Progress` and reads `fullStream` in the background |
| Tools | `lib/copper/assistant/tools.ts` | `get_products`, `get_prices`, `calculate_cost`, `check_availability`; prices from the catalog, stock from `readInventory()` on every call |
| Extension tool | `lib/copper/assistant/tools.ts` (`extensionTools`) | `compare_billing`: Copper Plus monthly vs. yearly over 1 to 5 years, from catalog prices. Sent with the four spec tools, so this repo fails AC-M2.14 (exactly four tools) by design |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`, sent only when tools are on |
| AI calls | `lib/ai/call.ts` (`callStream`, module 2, feature `ask-copper`) | Default Gemini model, up to 5 steps, with thought summaries. One `[ai_calls]` row per question |

**Data flow:** shopper asks → panel calls `askCopper` with that conversation's
history → `callStream` → model picks tools → tools read catalog / stock →
model writes the reply → each change is pushed to the panel as a fresh
`Progress` copy.

**Decisions and trade-offs:** Tools on and off are separate conversations, so
the tools-off model can't copy an answer the tools worked out. With tools off
the model gets no instructions either, since "always use your tools" with no
tools makes it return nothing. The tools only read; they can't change anything.

**Risks and open questions:** With tools off the model invents prices; the
panel labels those answers "may be made up". Cost is one streamed call per
question, logged to `ai_calls`. Stock moves to Supabase in part 2.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```
