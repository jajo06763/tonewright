# Tonewright (webapp)

A small shared tool: paste reference text + rules to define a target tone, then paste a
draft and get it rewritten to match, with a side-by-side diff of what changed.

Runs as a single Supabase Edge Function that serves the page **and** proxies calls to
the Anthropic API using a server-side key (never exposed to the browser). A Postgres
table tracks cumulative spend and stops new requests once your budget is used up.

## 1. One-time Supabase setup

You said you already have a Supabase account/project — use that project for the rest
of this.

```bash
cd ~/tonewright-webapp
supabase init          # creates supabase/config.toml — safe, won't touch the files already here
supabase login         # opens a browser to authenticate your Supabase account
supabase link --project-ref <your-project-ref>
```

Find `<your-project-ref>` in your Supabase dashboard URL
(`https://supabase.com/dashboard/project/<project-ref>`), or run `supabase projects list`.

## 2. Push the budget table

```bash
supabase db push
```

This creates a single-row `tonewright_budget` table (starts at $0.00) and an
`tonewright_increment_budget` function the Edge Function uses to add to it atomically.

## 3. Set secrets

Run these with your own values — nothing here should be typed anywhere but your own
terminal:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # your Anthropic API key
supabase secrets set APP_PASSCODE=some-shared-word      # optional but recommended — a word you share with your group
supabase secrets set BUDGET_LIMIT_CENTS=200             # $2.00; change any time and re-set
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` don't need to be set — Supabase injects
those automatically inside Edge Functions.

**Also set the real backstop:** in the Anthropic Console
([console.anthropic.com](https://console.anthropic.com)), create a workspace dedicated
to this project (Settings → Workspaces), generate the API key from inside it, and set
that workspace's monthly spend limit to $2 under Settings → Plans & Billing → Spending
Limits. That's enforced by Anthropic itself — once hit, the API returns errors no
matter what this app's own counter says. The app's own `tonewright_budget` counter is a
second, faster-reacting layer on top of that (it also lets everyone see usage on the
page itself), not a replacement for it.

## 4. Deploy

```bash
supabase functions deploy tonewright --no-verify-jwt
```

`--no-verify-jwt` makes the function reachable by a plain browser visit (no Supabase
login required) — that's what lets groupmates just open a link. It also means *anyone*
with the URL could call it, which is exactly why the passcode and the $2 cap both
exist: set `APP_PASSCODE` in step 3 if you don't want the URL alone to be enough.

The command prints your function's URL, something like:

```
https://<project-ref>.supabase.co/functions/v1/tonewright
```

That's the link to share with your group. Give them the passcode separately (chat,
not in the same message as the link).

## Updating later

- Change the budget: `supabase secrets set BUDGET_LIMIT_CENTS=<new value in cents>`
- Reset the spent counter: run `update tonewright_budget set total_cents = 0 where id = 1;`
  in the Supabase SQL editor.
- Change code: edit files under `supabase/functions/tonewright/`, then re-run the
  deploy command from step 4.

## Local preview (frontend only, no live rewrite)

`.claude/launch.json` runs a static file server over just the HTML/CSS/JS so you can
check the layout without deploying. The "Rewrite my text" button won't work there since
it has no backend to call — use the deployed URL for that.
