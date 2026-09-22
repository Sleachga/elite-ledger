# elite-ledger — architecture & decisions

Public, verifiable ledger of who deposits Elite-craft materials into a Quinfall
guild bank. Members upload bank-log screenshots; Claude vision extracts rows;
the site shows progress toward the next Elite and who contributed what.
Leadership uses the data to decide who receives crafted Elites.

## Locked decisions (from design grill, 2026-09-20)

1. **Stack** — Next.js (App Router) on Vercel + Supabase (Postgres, Discord
   OAuth, screenshot storage). Anthropic SDK (`claude-opus-5`, vision +
   structured outputs) in a server route. Public Google Sheet is a one-way
   mirror of Postgres (Ledger, Contributors, Progress, Crafts, Audit tabs),
   synced on every commit (debounced) plus hourly.
2. **Ledger is flat and honest** — one row per deposit as seen in the log
   (character, member, item, qty, game timestamp, uploader, screenshot). The
   recipe lives in a separate table and is tree-capable, but v1 shows flat
   totals only.
3. **Deposits only** — the green ▲ plus "Deposit" text is the signal. Withdraw
   rows are dropped. Silver Coin rows print the amount inline
   (`500,000,000`) rather than overlaid on the icon; `qty` is BIGINT.
4. **No dedup** — every parsed row is an individual deposit; members are told
   to avoid overlapping screenshots. Only byte-identical re-uploads of the same
   file are rejected.
5. **Uploader = contributor** — people upload their own deposits. If a
   screenshot shows more than one character name, ask which is theirs; other
   names' rows are skipped.
6. **Verify before commit** — upload → extract → verify screen (screenshot
   beside editable rows, item limited to the tracked list, low-confidence rows
   highlighted, manual add) → commit. Nothing enters the ledger unverified.
7. **Recipes** — four Elite types (Ring, Earring, Necklace, Bracelet). Each
   needs 100 of its own blueprint fragment; all other materials are shared:
   Nyxium 100 · Gold/Silver/Copper/Cobalt/Iron Ingot 20,000 each (total incl.
   Nyxium's own cost) · Obsidian 20,000 · Veltryn 2,500 · Mithrilium Ingot
   2,500 · Ruby 2,000 · Silver Coin 10,000,000,000. No point weights.
   Codex names differ slightly ("Purified Veltryn", "Mithrilium"); the catalog
   keeps Sandy's names as aliases. **Unverified:** the codex Nyxium recipe
   implies 600 Obsidian per Nyxium (60,000 per Elite); Sandy's list says
   20,000 and is used until he checks in-game.
8. **Crafts log (public)** — admin records each crafted Elite: type,
   recipient, date, recorded-by. Subtracts recipe quantities from *stock*,
   never from anyone's contributions. Per-member cap: 2 rings, 2 earrings,
   1 necklace, 1 bracelet — the craft form warns, never blocks.
9. **Auth** — Discord login for upload; single admin allowlist (Discord IDs)
   for edits, recipe changes, crafts, sync. Every admin action is audited
   (who/what/before/after/when) and the audit log is public.
10. **Pages** — Progress (home), Contributors, Ledger, Member, Upload, Crafts,
    Admin.
11. **Jev (TypeSafe AI) judge — parked (#15)** — Jev's input is text/JSON
    only (`noul`, `choice`, `score`), so it cannot read screenshots. The idea
    was a second opinion over the extractor's per-row icon description, but
    with a human verify step on every upload it is mostly redundant. Revisit
    only if the fixture eval (#7) or verify-screen correction rates show the
    extractor is worse than expected. The extractor still emits
    `iconDescription` per row so the judge can be added without a schema
    change.
12. **Dropped from v1** — Discord-bot uploader (later add-on), recipe-tree
    expansion, withdrawals, point/silver weights.

## UI & workflow

- **UI kit** — Radix Themes (simple, default-ish theme) + Framer Motion for
  interactions and page/element transitions. No custom design system.

### Design decisions (design grill, 2026-09-20)

- **Dark only** — Radix `appearance="dark"`, `grayColor="slate"`,
  `accentColor="amber"`. Game flavor comes only from item icons and their
  rarity-colored borders; chrome stays neutral. Typography = Radix default.
- **Header** — guild name as the wordmark (small amber mark + name);
  "Elite Ledger" is the tagline/page title. Guild name: **Carpe Rektem**
  (`NEXT_PUBLIC_GUILD_NAME`, set on Vercel).
- **Mobile-first** — every screen designed at 390px first; Radix responsive
  props; a page never scrolls sideways. Desktop: top bar (Progress ·
  Contributors · Ledger · Crafts · Audit, "Upload" as the one filled amber
  button, avatar menu holds Admin/sign-out). Mobile: bottom tab bar —
  Progress · Contributors · **Upload** (center) · Ledger · More.
- **Progress home** — hero strip (Elites crafted · % to next · Elites' worth
  of shared mats · last synced), then "Shared materials" bars sorted by %
  complete ascending (bottleneck on top), then "Blueprint fragments" (4 bars,
  "→ N craftable"), then Recent deposits. Bars stack full-width on mobile;
  hero becomes 2×2.
- **Tables** — dense: Radix `Table size="1"`, sticky header, right-aligned
  numbers with separators, row hover, click → screenshot side panel (desktop)
  / bottom sheet (mobile). On phones the Ledger becomes a list (icon · qty ·
  character · time-ago); Contributors stays a table with the member column
  pinned and materials scrolling inside the table.
- **Verify screen** — desktop: screenshot left, rows right. Mobile:
  screenshot on top (pinch-zoom), rows below, sticky Confirm bar.
- **ItemChip** — one component everywhere: 20–24px icon (40px in Progress
  bars) with a 1px rarity-colored border, name, optional qty badge, full name
  on hover. Rarity → Radix color mapping lives in the catalog, never
  per-component.
- **Motion (Framer Motion, 200–300ms ease-out, honors reduced-motion)** —
  bars fill from 0 on load and tween on change; hero numbers count up; verify
  rows stagger in; confirmed rows slide into the Ledger, deleted rows
  collapse; side panel slides from the right; pages fade/slide; low-confidence
  rows pulse once then hold a static highlight. Nothing else moves.
- **Testing** — verify UI changes in the built-in browser (Claude desktop
  browser pane), not just unit tests. Mute any audio first.
- **Implementation** — use subagents for parallelisable slice work; keep the
  main session for integration and review.
- **PRs** — solo repo: the main session verifies a slice branch (lint,
  typecheck, test, build, browser check for UI), opens the PR, and merges it
  without waiting for review. Use merge commits, not squash, so stacked slice
  branches keep a clean history.
- **Secrets** — never in chat or commits. 1Password (`op`) holds them; `.env`
  is filled with `op inject` from `.env.tpl` references. Env var names are
  fixed in issue #3.

## Reference data

- Item catalog + icons: https://thequinfall-codex.com/items renders every item
  server-side with `/items/icons/{type}_icon1_{id}.png` and a rarity CSS var.
  Only the ~13 tracked items are needed; store them as a vendored catalog with
  icon files for the extraction prompt.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `Sleachga/elite-ledger`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
