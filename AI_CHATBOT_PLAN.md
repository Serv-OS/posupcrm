# AI Support Chatbot — plan

**Goal:** one support brain that answers questions the way we do — on the website, over
email and over SMS — learns from our own past enquiries, and, when it doesn't know, says so
and raises a real ticket for a person.

The widget is phase 1; **email and SMS run through the same engine** (section 12).

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
ai_channels       channel ('chat'|'email'|'sms'), mode ('off'|'suggest'|'auto'),
                  confidence_min, daily_send_cap, out_of_hours_ok, updated_at
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
| **4** | **Email + SMS in Suggest mode** — drafts land on the ticket, humans send | Speeds up every reply, and measures accuracy safely |
| **5** | **Auto-send** for the categories the data says are safe | Real deflection, out-of-hours cover |
| **6** | Venue-aware actions (order status, open tickets, "is my till online?") | Deflects the highest-volume calls |
| **7** | Roll out to the other CRMs (per-instance playbook + knowledge, shared code) | Peter to guide |

Phase 1 is genuinely shippable on its own — that's deliberate.

---

## 12. Same brain on email + SMS

The widget is just one mouth. The knowledge, playbook, confidence gate and escalation are
channel-agnostic, so inbound **email** and **SMS** run through the same engine.

**Where it hooks in:** `gmail-check` / `ms-check` / `twilio-inbound-sms` already create the
ticket and log the inbound message. The AI step runs immediately after that — no new polling.

### Why these channels are *easier* in one way

We usually already know who's writing: the email address or mobile matches a contact, which
gives us the location. **No qualification round-trip needed** — it can answer properly on the
first reply, which is the opposite of an anonymous website visitor.

### And *harder* in another — this drives the design

A wrong chat message gets corrected in the next breath. A wrong **email** is sent, permanent,
and written under a real person's name. So autonomous sending needs a higher bar than chat.

### Three modes, set per channel

| Mode | Behaviour |
|---|---|
| **Off** | Nothing changes |
| **Suggest** | Drafts the reply into the ticket; a human presses send |
| **Auto-send** | Sends with no human, but only if **every** gate below passes |

`Suggest` is not a stepping stone to skip — it is how we measure whether auto-send is safe
(see rollout).

### Gates for auto-send — all must pass

1. Retrieval confidence above the **auto-send threshold** (deliberately higher than chat's)
2. Intent not in *never answer* (billing, contracts, refunds, legal, outage)
3. Sender resolves to a **known contact at a known location**
4. No anger/complaint signals detected
5. Under the per-day auto-send cap
6. Channel mode is `auto-send` for that channel

Fail any one → it does not send. It drafts, flags the ticket for a human, and (for the
customer) either stays silent or sends the honest holding line, depending on setting.

### Always true, regardless of mode

- Every AI reply is **logged and labelled AI-sent** in the thread — visible to us, not to the
  customer.
- The **ticket stays open**. The bot never resolves or closes a ticket in v1; a human or the
  customer's confirmation does that.
- **One reply per inbound message**, hard rate-limited — no possibility of a loop with an
  auto-responder on the other end.
- A **global kill switch** in Settings stops all autonomous sending instantly.

### SMS specifics

- 160-character discipline; long answers become "I'll email you the detail" + escalate.
- Costs real money per send, so the per-day cap matters more here.
- Existing STOP/opt-out handling is untouched.
- US instances need A2P registration to be live first (see PSC).

### Rollout — measured, not faith-based

1. **Suggest-only** for ~2 weeks on email. Log, for every draft, whether the agent sent it
   unchanged.
2. Read the numbers per category. Anything with a high "sent unchanged" rate is a safe
   candidate.
3. Turn on **auto-send for those 2–3 categories only** (typically the how-do-I questions).
4. Widen category by category. Never a big-bang switch.

This gives a real answer to "can it be trusted yet?" instead of a guess, and out-of-hours is
where it pays for itself first.

---

## 13. Open questions for Peter

1. **The CSV** — drop it anywhere in the project folder and I'll shape the importer to what's
   actually in it rather than guessing.
2. **Where does the widget go first?** serv-os.app, or a venue-facing page?
3. **Out-of-hours** — should the bot behave differently when closed (it knows the hours already)?
4. **Persona names** — reuse the 5 support signature names, or a separate set for chat?
