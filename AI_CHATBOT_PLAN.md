# AI Support Chatbot — plan

**Goal:** an embeddable chat widget that answers customer support questions the way we do,
learns from our own past enquiries, and — when it doesn't know — says so and raises a real ticket.

**Build order:** posupcrm first. Then the other CRMs (Peter to guide per-instance).

---

## 1. The two principles

Everything below follows from these.

1. **Know the location before answering.** An unknown visitor gets qualified first
   (which venue?). Once we know the venue, every answer is scoped to *their* hardware,
   modules, menu and open tickets. This is what makes it sound like someone who knows the
   site rather than a generic bot — and it's the thing competitors can't copy, because the
   knowledge lives in our CRM.
2. **Never guess.** If it can't ground an answer in our own material, it says
   *"I don't know — I'll raise this to the next level of support"* and opens a ticket.
   Worst case is a well-qualified ticket, which already beats a contact form.

---

## 2. What we're building on (already exists — verified 31 Jul 2026)

| Piece | Status |
|---|---|
| `ai_settings` table (api_key, model, tone, enabled) | exists, enabled |
| `ai-draft` edge function calling the Anthropic API | exists, working |
| `tickets` + `crm_activities` (63 tickets, 385 emails on posupcrm) | the training corpus |
| `locations`, `location_modules`, hardware records | the per-venue scoping data |
| `pgvector` | **available but not enabled** — one `create extension` away |

So we are not starting from zero: we reuse the API key, the model config and the ticket data.

**Model choice:** `ai-draft` uses Opus. For chat volume that's the wrong tier — plan is
**Sonnet for answers, Haiku for cheap classification** (see costs).

---

## 3. Data model (new)

```
kb_docs           id, source ('ticket'|'csv'|'manual'), title, question, answer,
                  category, location_id (nullable = applies to all), tags[],
                  active, created_at
kb_chunks         id, doc_id, content, embedding vector(1536)      -- what we search
chat_sessions     id, site_key, location_id, contact_id, visitor_name, visitor_email,
                  status ('open'|'escalated'|'closed'), ticket_id, started_at
chat_messages     id, session_id, role ('visitor'|'bot'|'agent'), content,
                  confidence, used_doc_ids[], created_at
chat_playbook     id, ask_first[], never_answer[], always_escalate[], persona_names[],
                  greeting, tone, updated_at
chat_sites        id, site_key, label, allowed_origins[], location_id (nullable), active
```

Notes:
- `kb_docs.location_id` is the scoping key: null = general, set = only for that venue.
- `chat_sites` gives each embed its own key + origin allow-list, so PSC's widget can
  never read POSUP's knowledge. **Multi-tenant isolation is enforced here, not in the prompt.**

---

## 4. The CSV import

**Columns wanted** (any order; blank tolerated):

`subject · question · answer · category · location · date · resolved`

**Import does:**
1. Strip signatures, quoted reply chains, and mask emails/phone numbers.
2. Drop duplicates and junk ("thanks", "ok").
3. Match `location` text to a real `locations` row where possible.
4. Write `kb_docs`, chunk the answer, embed the chunks.

Same importer then runs continuously over **resolved tickets**, so the bot keeps learning
with no extra work — closing a ticket today makes it better tomorrow.

---

## 5. The playbook (editable in the CRM, not in code)

A screen under **Settings → AI Assistant**:

- **Ask first** — location (always on), name, email
- **Never ask** — anything the CRM already knows for a known visitor
- **Never answer → escalate** — pricing, contracts, cancellation, refunds, legal
- **Always escalate immediately** — "we're down", card payments failing, data loss
- **Persona names** — reuses the support signature pool, so chat and email feel like one team
- **Greeting + tone**

Peter edits these like auto-replies today. No deploy needed to change behaviour.

---

## 6. How one answer works

```
visitor message
  → known visitor? (site key / logged-in link / email match)  → load location context
  → location unknown?  → ask for it FIRST, answer nothing else
  → classify intent (Haiku, cheap): question | outage | billing | chit-chat
  → hard rules first: billing/legal/outage  → escalate, no answer attempted
  → retrieve top ~5 kb_chunks, filtered to (location_id = venue OR null)
  → weak match?  → "I don't know" + escalate
  → answer with Sonnet: playbook + persona + retrieved docs + venue context + last turns
  → log message, confidence and which docs were used
```

**The confidence gate is a real threshold on retrieval score**, not the model's opinion of
itself. If the best match is below it, we don't answer. This is the single most important
safety property.

---

## 7. Escalation

When it escalates:
1. Creates a **ticket** in the CRM — subject from the conversation, channel `chat`,
   the venue and contact attached, full transcript in the body.
2. Tells the visitor the ticket number and that a person will pick it up.
3. Fires the normal new-ticket notifications, so it lands in the existing workflow.

Nothing new to monitor — escalated chats appear as ordinary tickets.

---

## 8. Voice

- Sounds like a named member of the team (from the persona pool), British English,
  short sentences, mirrors the customer's tone, no bullet-point essays, no "As an AI".
- **If asked directly whether they're talking to a bot, it answers honestly.** EU
  transparency rules require it and it protects trust — a human is about to take over
  anyway. Everything else about sounding natural stands.
- Style is taught by showing it ~20 of our best real replies, picked from the corpus.

---

## 9. Widget

One line on any site:

```html
<script src="https://<crm>/chat.js" data-site-key="psc_live_xxx" defer></script>
```

- Self-contained bubble, no dependencies, respects the host page's fonts/colours loosely.
- Origin-checked against `chat_sites.allowed_origins`.
- Works anonymously; upgrades to a known contact if an email is given or a signed link is used.

---

## 10. Cost

Per conversation (~8 turns, retrieval-augmented):

- Classification (Haiku): negligible
- Answers (Sonnet): roughly **1–3p per conversation**
- Embeddings: one-off pennies for the whole corpus, then trivial per new ticket

**Controls:** per-site monthly cap, per-session message cap, and it stops answering (not
silently — it escalates) when a cap is hit.

---

## 11. Phases

| Phase | What | Value |
|---|---|---|
| **1** | Widget + playbook + location qualification + escalate-to-ticket. **No knowledge base yet** | Already useful: qualified tickets, out of hours cover |
| **2** | CSV import + pgvector retrieval + confidence gate | Actually answers real questions |
| **3** | Review screen: read conversations, thumbs-down bad answers, promote good replies to `kb_docs` | Gets better weekly, with a human in the loop |
| **4** | Venue-aware actions (order status, open tickets, "is my till online?") | Deflects the highest-volume calls |
| **5** | Roll out to the other CRMs (per-instance playbook + knowledge, shared code) | Peter to guide |

Phase 1 is genuinely shippable on its own — that's deliberate.

---

## 12. Open questions for Peter

1. **The CSV** — drop it anywhere in the project folder and I'll shape the importer to what's
   actually in it rather than guessing.
2. **Where does the widget go first?** serv-os.app, or a venue-facing page?
3. **Out-of-hours** — should the bot behave differently when closed (it knows the hours already)?
4. **Persona names** — reuse the 5 support signature names, or a separate set for chat?
