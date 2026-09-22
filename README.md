# Tonewright (webapp)

A small shared tool: paste reference text + rules to define a target tone, then paste a
draft and get it rewritten to match, with a side-by-side diff of what changed.

**Live app:** https://jajo06763.github.io/tonewright/
**API:** https://puyzurvbozufyxlqbkca.supabase.co/functions/v1/tonewright

## How it's split

Two pieces, because Supabase's shared `*.supabase.co` domain refuses to serve a
working interactive HTML page (it forces `text/plain` + a locked-down CSP as an
anti-phishing measure — there's no way around this short of a Pro plan + custom
domain, which isn't worth it here):

- **`docs/index.html`** — the page itself, static HTML/CSS/JS, hosted for free on
  GitHub Pages from this repo's `main` branch. No secrets in it; it just calls the
  API below over `fetch`.
- **`supabase/functions/tonewright/`** — a Supabase Edge Function that holds your
  Anthropic API key as a secret and proxies calls to Claude Haiku 4.5. Tracks
  cumulative spend in a Postgres table (`tonewright_budget`) and refuses new
  requests once the group hits the budget cap.

## Updating the API (backend)

```bash
cd ~/tonewright-webapp
npx supabase functions deploy tonewright --no-verify-jwt
```

`--no-verify-jwt` is required — it's what lets the page call the API without every
groupmate needing a Supabase login.

Secrets already set on the linked project (`puyzurvbozufyxlqbkca`, workspace
`GM@W`): `ANTHROPIC_API_KEY`, `APP_PASSCODE`, `BUDGET_LIMIT_CENTS`. Change any of
them with:

```bash
npx supabase secrets set BUDGET_LIMIT_CENTS=<new value in cents>
```

Reset the spent counter back to $0 by running this in the Supabase SQL editor:

```sql
update tonewright_budget set total_cents = 0 where id = 1;
```

**The real hard cap** is the Anthropic Console workspace spend limit (`tonewright-group`
workspace, set to $2/month) — that's enforced by Anthropic itself. The in-app counter
above is a second, faster-reacting layer on top of it, not a replacement.

## Updating the page (frontend)

Edit `docs/index.html` directly, then:

```bash
git add docs/index.html
git commit -m "describe the change"
git push
```

GitHub Pages rebuilds automatically (usually under a minute — check
`gh api repos/jajo06763/tonewright/pages/builds/latest`). If a change doesn't seem
to show up, it's almost always a stale browser cache — hard-reload or add a `?v=`
query param.

If the API's URL ever changes (e.g. moved to a different Supabase project), update
the `API_BASE` constant near the top of the `<script>` block in `docs/index.html`.

## Sharing with the group

Give groupmates the live app link above and the passcode (`Ankie`) separately —
not in the same message as the link. The repo itself is public (required for GitHub
Pages to be viewable without a GitHub login), but it contains no secrets — the API
key only ever lives in Supabase's secret store.
