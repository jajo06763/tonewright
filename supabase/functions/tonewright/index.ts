const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const APP_PASSCODE = Deno.env.get("APP_PASSCODE") ?? "";
const BUDGET_LIMIT_CENTS = Number(Deno.env.get("BUDGET_LIMIT_CENTS") ?? "200");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MODEL = "claude-haiku-4-5-20251001";
const CENTS_PER_INPUT_TOKEN = 100 / 1_000_000; // $1 / MTok
const CENTS_PER_OUTPUT_TOKEN = 500 / 1_000_000; // $5 / MTok

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-app-passcode",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};


function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function readBudget(): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tonewright_budget?id=eq.1&select=total_cents`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  const rows = await res.json();
  return Number(rows?.[0]?.total_cents ?? 0);
}

async function addToBudget(deltaCents: number): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/tonewright_increment_budget`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY!,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ delta: deltaCents }),
    },
  );
  const value = await res.json();
  return Number(Array.isArray(value) ? value[0] : value);
}

function buildPrompt(samples: string[], rules: string[], draft: string): string {
  const sampleBlock = samples.length
    ? samples.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join("\n\n")
    : "(No reference sample was given \u2014 rely only on the explicit rules below.)";
  const rulesBlock = rules.length
    ? rules.map((r) => `- ${r}`).join("\n")
    : "(No explicit rules were given \u2014 infer everything from the reference sample above.)";

  return `You are a professional editor performing a style-transfer rewrite.

TARGET STYLE \u2014 reference sample(s) written in the desired voice:
${sampleBlock}

EXPLICIT STYLE RULES (apply these literally, even where they conflict with an incidental quirk of the sample):
${rulesBlock}

TASK:
Rewrite the DRAFT below so it reads as if the same author who wrote the reference sample(s) wrote it, and so it follows every explicit rule. Preserve the draft's meaning, facts, and intent \u2014 do not add or remove information. Make the LIGHTEST edit that gets the tone and style to match: keep original wording, sentence structure, and order wherever they already fit the target style, and change only the words or phrases that actually need to change. Do not rephrase or restructure a sentence that already reads fine in the target style just to vary it.

DRAFT:
${draft}

OUTPUT FORMAT:
Return ONLY JSON matching this shape, nothing else:
{
  "notes": "one or two sentence summary of the overall tonal shift you made",
  "segments": [
    { "kind": "same", "text": "..." },
    { "kind": "changed", "before": "...", "after": "...", "reason": "short phrase, under 12 words, naming what changed and why" }
  ]
}

Rules for segments:
- Segments must appear in the same order as the draft.
- Concatenating every segment's "text" (kind:same) or "before" (kind:changed) in order must reproduce the DRAFT text EXACTLY, character for character, including all whitespace and punctuation.
- Concatenating every segment's "text" (kind:same) or "after" (kind:changed) in order produces the rewritten text.
- Only mark a segment "changed" where the wording actually differs \u2014 keep unchanged stretches, even whole sentences, as "same" segments.
- Prefer natural phrase- or sentence-level segments over single words.
- Do not include markdown fences or any text outside the JSON object.`;
}

async function handleBudget(): Promise<Response> {
  const totalCents = await readBudget();
  return json({ totalCents, limitCents: BUDGET_LIMIT_CENTS });
}

async function handleRewrite(req: Request): Promise<Response> {
  if (APP_PASSCODE && req.headers.get("x-app-passcode") !== APP_PASSCODE) {
    return json({ error: "bad_passcode", message: "Wrong passcode." }, 401);
  }

  let body: { samples?: string[]; rules?: string[]; draft?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Invalid request body." }, 400);
  }

  const draft = (body.draft ?? "").trim();
  if (!draft) {
    return json({ error: "bad_request", message: "No draft text given." }, 400);
  }
  const samples = (body.samples ?? []).map((s) => (s || "").trim()).filter(Boolean);
  const rules = (body.rules ?? []).map((r) => (r || "").trim()).filter(Boolean);
  if (!samples.length && !rules.length) {
    return json({ error: "bad_request", message: "No style profile given." }, 400);
  }

  const currentTotal = await readBudget();
  if (currentTotal >= BUDGET_LIMIT_CENTS) {
    return json({
      error: "budget_exceeded",
      message: `The group's $${(BUDGET_LIMIT_CENTS / 100).toFixed(2)} budget for this tool has been used up. Ask whoever set it up to raise the limit.`,
      totalCents: currentTotal,
      limitCents: BUDGET_LIMIT_CENTS,
    }, 402);
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "server_misconfigured", message: "No Anthropic API key is configured on the server." }, 500);
  }

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildPrompt(samples, rules, draft) }],
      }),
    });
  } catch {
    return json({ error: "upstream_error", message: "Couldn't reach Claude. Try again." }, 502);
  }

  if (!anthropicRes.ok) {
    if (anthropicRes.status === 429) {
      return json({
        error: "budget_exceeded",
        message: "This tool's Claude API budget has been used up for this billing period.",
      }, 402);
    }
    return json({ error: "upstream_error", message: `Claude API error (${anthropicRes.status}).` }, 502);
  }

  const data = await anthropicRes.json();
  const text = data?.content?.[0]?.text ?? "";
  const inputTokens = Number(data?.usage?.input_tokens ?? 0);
  const outputTokens = Number(data?.usage?.output_tokens ?? 0);
  const costCents = inputTokens * CENTS_PER_INPUT_TOKEN + outputTokens * CENTS_PER_OUTPUT_TOKEN;
  const newTotal = await addToBudget(costCents);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
    }
  }

  if (!parsed) {
    return json({ error: "parse_error", message: "Claude's response wasn't valid JSON. Try again." }, 502);
  }

  return json({ result: parsed, costCents, totalCents: newTotal, limitCents: BUDGET_LIMIT_CENTS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname.endsWith("/rewrite")) {
    return handleRewrite(req);
  }
  if (req.method === "GET" && url.pathname.endsWith("/budget")) {
    return handleBudget();
  }

  return json({
    message: "This is the Tonewright API. The app itself is served separately.",
  }, 200);
});
