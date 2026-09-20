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
8. **Crafts log (public)** — admin records each crafted Elite: type,
   recipient, date, recorded-by. Subtracts recipe quantities from *stock*,
   never from anyone's contributions. Per-member cap: 2 rings, 2 earrings,
   1 necklace, 1 bracelet — the craft form warns, never blocks.
9. **Auth** — Discord login for upload; single admin allowlist (Discord IDs)
   for edits, recipe changes, crafts, sync. Every admin action is audited
   (who/what/before/after/when) and the audit log is public.
10. **Pages** — Progress (home), Contributors, Ledger, Member, Upload, Crafts,
    Admin.
11. **Dropped from v1** — TypeSafe AI (text-only input, can't see
    screenshots), Discord-bot uploader (later add-on), recipe-tree expansion,
    withdrawals, point/silver weights.

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
