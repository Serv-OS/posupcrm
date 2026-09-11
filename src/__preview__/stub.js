// In-memory Supabase for the design harness. Any query chain works; rows come from TABLES.
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const ts = (n, h = 0) => { const x = new Date(); x.setDate(x.getDate() + n); x.setHours(x.getHours() - h); return x.toISOString(); };
const ME = 'u-peter';
export const MEMBERS = [{ id: 'u-peter', display_name: 'Peter', email: 'peter@posup.co.uk', role: 'owner' }, { id: 'u-sarah', display_name: 'Sarah', email: 'sarah@posup.co.uk', role: 'editor' }, { id: 'u-james', display_name: 'James', email: 'james@posup.co.uk', role: 'editor' }];
const COMPANIES = [{ id: 'c1', name: 'Coffee Boy — Barnsley', country: 'GB' }, { id: 'c2', name: 'Lightspeed POS UK Ltd', country: 'GB' }, { id: 'c3', name: 'Lightspeed Netherlands B.V.', country: null }];
const LOCATIONS = [{ id: 'l1', name: 'Verde — Macclesfield', company_id: 'c3', status: 'live', phone: '01625 442 118', email: 'verde@example.com', address: '14 Mill Street', city: 'Macclesfield', postcode: 'SK11 6NN', venue_type: 'restaurant', covers: 80, go_live_date: '2026-03-14', owner_id: ME, created_at: ts(-200) }];
const LEADS = [{ id: 'lead1', name: 'Cafe Brigante - Leeds Center', stage: 'deal', deal_id: 'd1', source: 'website', priority: 'medium', venue_type: 'cafe', current_pos: 'Lightspeed', owner_id: ME, company_id: 'c1', location_id: 'l1', created_at: ts(-90) }];
const DEALS = [
  { id: 'd1', name: 'Coffee Boy — Barnsley Train Station', company_id: 'c1', stage: 'proposal_sent', owner_id: ME, hardware_value: 3200, services_value: 850, saas_arr: 1788, payments_arr: 2400, expected_close_date: d(12), created_at: ts(-40), updated_at: ts(-3) },
  { id: 'd2', name: 'Verde — second site', company_id: 'c2', stage: 'negotiation', owner_id: 'u-sarah', hardware_value: 5400, services_value: 1200, saas_arr: 3576, payments_arr: 4100, expected_close_date: d(5), created_at: ts(-60), updated_at: ts(-1) },
  { id: 'd3', name: 'Hare and Hounds — till refresh', company_id: 'c2', stage: 'qualified', owner_id: ME, hardware_value: 1800, saas_arr: 1788, expected_close_date: d(-6), created_at: ts(-90), updated_at: ts(-35) },
  { id: 'd4', name: 'Cafe Brigante — Leeds', company_id: 'c1', stage: 'demo_booked', value: 2400, expected_close_date: null, created_at: ts(-20), updated_at: ts(-20) },
  { id: 'd5', name: 'Evuna — closed', company_id: 'c2', stage: 'closed_won', hardware_value: 4000, saas_arr: 1788, closed_at: ts(-10), created_at: ts(-70), updated_at: ts(-10) },
];
const PROJECTS = [{ id: 'p1', name: 'Adyen Onboarding', status: 'active', subject_type: 'deal', subject_id: 'd1', owner_id: ME, due_date: d(9), created_at: ts(-6), updated_at: ts(0), phases: ['Account setup', 'Go live'] }, { id: 'p2', name: 'Verde refit', status: 'active', subject_type: 'location', subject_id: 'l1', owner_id: ME, due_date: d(20), created_at: ts(-3), updated_at: ts(0), phases: [] }];
const TASKS = [
  { id: 't1', title: 'Create Adyen company account', status: 'done', priority: 'P2', project_id: 'p1', phase: 'Account setup', owner_id: ME, due_date: d(-4), completed_at: ts(-4), created_at: ts(-6), updated_at: ts(-4), sort_order: 0 },
  { id: 't2', title: 'Upload KYC documents', status: 'done', priority: 'P2', project_id: 'p1', phase: 'Account setup', owner_id: 'u-sarah', due_date: d(-2), completed_at: ts(-1), created_at: ts(-6), updated_at: ts(-1), sort_order: 1 },
  { id: 't3', title: 'Unable to add sub account', status: 'in_progress', priority: 'P1', project_id: 'p1', phase: 'Account setup', owner_id: ME, due_date: d(0), description: 'Cannot add sub account — the button is missing from my account. Likely a permissions scope on the parent.', created_by: 'u-sarah', created_at: ts(-5), updated_at: ts(0, 1), sort_order: 2 },
  { id: 't4', title: 'Get access to live account', status: 'blocked', priority: 'P1', project_id: 'p1', phase: 'Go live', owner_id: ME, due_date: d(-2), blocked_reason: 'Adyen support ticket', created_at: ts(-5), updated_at: ts(0, 3), sort_order: 3 },
  { id: 't5', title: 'First live transaction test', status: 'todo', priority: 'P2', project_id: 'p1', phase: 'Go live', owner_id: 'u-sarah', due_date: d(9), depends_on_id: 't4', created_at: ts(-5), updated_at: ts(-5), sort_order: 4 },
  { id: 't6', title: 'Cool Guys — menu build', status: 'in_progress', priority: 'P2', project_id: 'p2', owner_id: 'u-james', due_date: d(3), created_at: ts(-2), updated_at: ts(0), sort_order: 0 },
  { id: 't7', title: 'Book install — Leeds', status: 'todo', priority: 'P2', project_id: 'p2', owner_id: ME, due_date: d(0), created_at: ts(-2), updated_at: ts(-1), sort_order: 1 },
  { id: 't8', title: 'Chase signed reseller agreement', status: 'todo', priority: 'P1', project_id: 'p2', owner_id: ME, due_date: d(-5), created_at: ts(-9), updated_at: ts(-2), sort_order: 2 },
  { id: 's1', title: 'Check parent verification', status: 'done', project_id: 'p1', parent_task_id: 't3', owner_id: ME, completed_at: ts(-1), created_at: ts(-2), updated_at: ts(-1), sort_order: 0 },
  { id: 's3', title: 'Raise Adyen support ticket', status: 'todo', project_id: 'p1', parent_task_id: 't3', owner_id: ME, created_at: ts(-2), updated_at: ts(-2), sort_order: 2 },
];
const W = (o) => ({ type: 'task', source_table: 'tasks', blocked_reason: null, created_by: ME, link: {}, ...o });
const WORK = [
  W({ type: 'ticket', source_table: 'tickets', source_id: 'k1', title: 'Card machine offline at lunch', subtitle: 'Verde — Macclesfield · 2.4 mi away', owner_id: ME, status: 'in_progress', priority: 'P1', due_at: new Date(Date.now() - 40 * 60e3).toISOString(), updated_at: ts(0) }),
  W({ type: 'onboarding', source_table: 'onboardings', source_id: 'o1', title: 'Fourelephants — hardware not shipped', subtitle: 'Stage 4 of 9', owner_id: ME, status: 'blocked', priority: 'P2', due_at: d(-11) + 'T00:00:00Z', updated_at: ts(-2) }),
  W({ type: 'approval', source_table: 'expenses', source_id: 'e1', title: 'Bill — Lightspeed POS UK Ltd', subtitle: '£2,480', owner_id: null, created_by: 'u-james', status: 'todo', priority: 'P2', due_at: d(0) + 'T09:00:00Z', updated_at: ts(0, 2) }),
  W({ source_id: 't3', title: 'Unable to add sub account', subtitle: 'Evuna — Northern Quarter · timer running', owner_id: ME, status: 'in_progress', priority: 'P1', due_at: d(0) + 'T00:00:00Z', updated_at: ts(0) }),
  W({ source_id: 't7', title: 'Book install — Leeds', subtitle: 'Cafe Brigante', owner_id: ME, status: 'todo', priority: 'P2', due_at: d(0) + 'T00:00:00Z', updated_at: ts(-1) }),
];
const TICKETS = [
  { id: 'k1', ticket_number: 1042, customer_email: 'dan@verde.example', channel: 'email', contact_id: 'ct1', subject: 'Card machine offline', priority: 'P1', stage: 'in_progress', location_id: 'l1', company_id: 'c2', sla_due_at: new Date(Date.now() - 40 * 60e3).toISOString(), first_response_due_at: new Date(Date.now() - 40 * 60e3).toISOString(), created_at: ts(0, 3) },
];
const ONBOARDINGS = [{ id: 'o2', name: 'LS FFA Onboarding', stage: 'quote_sent', location_id: 'l1', company_id: 'c2', created_at: ts(-4) }];
const CONTACTS = [{ id: 'ct1', first_name: 'Dan', last_name: 'Marsh', job_title: 'General manager', phone: '07700 900123', email: 'dan@verde.example' }];
const ASSOC = [{ from_type: 'location', from_id: 'l1', to_type: 'contact', to_id: 'ct1' }];
const NOTIFS = [
  { id: 'n1', type: 'mention', title: 'Sarah on FranPOS reseller agreement', body: '“@peter legal came back — needs your signature today”', entity_type: 'task', link_id: 't8', read_at: null, created_at: ts(0, 3), recipient_id: ME },
  { id: 'n2', type: 'reply', title: '#1039 — customer replied', body: 'Thanks, the terminal is back up now.', entity_type: 'ticket', link_id: 'k1', read_at: null, created_at: ts(0, 4), recipient_id: ME },
  { id: 'n3', type: 'assignment', title: 'You were assigned “Book install — Leeds”', body: null, entity_type: 'task', link_id: 't7', read_at: ts(-1), created_at: ts(-1), recipient_id: ME },
  { id: 'n4', type: 'system', title: 'Weekly digest is ready', body: null, entity_type: null, link_id: null, read_at: ts(-2), created_at: ts(-2), recipient_id: ME },
];
const BILLS = [
  { id: 'b1', bill_number: 4821, supplier_id: 's1', supplier: { name: 'Lightspeed POS UK Ltd' }, total: 2480, amount_paid: 0, status: 'to_pay', due_date: d(-4), supplier_ref: 'INV-4821', cost_context: 'ongoing', created_at: ts(-20) },
  { id: 'b2', bill_number: 4822, supplier_id: 's2', supplier: { name: 'Adyen N.V.' }, total: 612.4, amount_paid: 0, status: 'to_pay', due_date: d(9), cost_context: 'ongoing', recurring_id: 'r1', created_at: ts(-10) },
  { id: 'b3', bill_number: 4823, supplier_id: 's3', supplier: { name: 'Sumup Payments Ltd' }, total: 149, amount_paid: 0, status: 'draft', due_date: null, cost_context: 'deal', created_at: ts(-1) },
];
const QUOTES = [{ id: 'q1', quote_number: 118, status: 'draft', company_id: 'c2', contact_id: 'ct1', location_id: 'l1', currency: 'GBP', valid_until: d(30), payment_terms: 'deposit', deposit_percent: 25, terms: 'Payment 14 days from invoice.', notes: '', public_token: 'abc123', tax_rate: 20 }];
const QLINES = [
  { id: 'ql1', quote_id: 'q1', name: 'Lightspeed terminal', category: 'hardware', billing_type: 'one_off', qty: 2, unit_price: 390, discount: 0, tax_rate: 20, sort: 0 },
  { id: 'ql2', quote_id: 'q1', name: 'Card reader', category: 'hardware', billing_type: 'one_off', qty: 1, unit_price: 149, discount: 0, tax_rate: 20, sort: 1 },
  { id: 'ql3', quote_id: 'q1', name: 'Install & training', category: 'services', billing_type: 'one_off', qty: 4, unit_price: 60, discount: 10, tax_rate: 20, sort: 2 },
  { id: 'ql4', quote_id: 'q1', name: 'ServOS Growth', category: 'saas', billing_type: 'monthly', qty: 1, unit_price: 149, discount: 0, tax_rate: 20, line_total: 149, sort: 3 },
  { id: 'ql5', quote_id: 'q1', name: 'Card processing', category: 'payments', billing_type: 'annual', qty: 1, unit_price: 2400, discount: 0, tax_rate: null, line_total: 2400, sort: 4 },
];
const PRODUCTS = [{ id: 'pr1', name: 'Lightspeed terminal', category: 'hardware', billing_type: 'one_off', default_price: 390, active: true }, { id: 'pr2', name: 'Card reader', category: 'hardware', billing_type: 'one_off', default_price: 149, active: true }, { id: 'pr3', name: 'ServOS Growth', category: 'saas', billing_type: 'monthly', default_price: 149, active: true }];
const SERIALS = [{ id: 'sn1', serial: 'LS-88213', location_id: 'l1', product: { name: 'Lightspeed terminal' }, status: 'deployed' }, { id: 'sn2', serial: 'LS-88214', location_id: 'l1', product: { name: 'Lightspeed terminal' }, status: 'deployed' }, { id: 'sn3', serial: 'CR-1120', location_id: 'l1', product: { name: 'Card reader' }, status: 'deployed' }];
const ACTIVITIES = [
  { id: 'c1', type: 'call', direction: 'outbound', actor_id: ME, occurred_at: ts(0, 2), channel_metadata: { to: '+447700900123', duration_seconds: 182 }, contact_id: 'ct1', subject_type: 'contact', subject_id: 'ct1' },
  { id: 'c2', type: 'call', direction: 'inbound', actor_id: ME, occurred_at: ts(0, 5), channel_metadata: { from_number: '+441625442118', duration_seconds: 0 } },{ id: 'a1', type: 'note', is_internal: true, subject: 'Cannot add sub account button is missing from my account', body: 'Cannot add sub account button is missing from my account', actor_id: ME, occurred_at: ts(0, 0.05), subject_type: 'task', subject_id: 't3', created_at: ts(0, 0.05) }];
const TIME = [{ id: 'te1', profile_id: ME, subject_type: 'task', subject_id: 't3', started_at: ts(0, 1), ended_at: null, duration_seconds: 1440 }];
const STAGE_HISTORY = [
  { id: 'sh1', object_type: 'deal', object_id: 'd1', to_stage: 'proposal_sent', changed_at: ts(-3), changed_by: ME },
  { id: 'sh2', object_type: 'deal', object_id: 'd3', to_stage: 'qualified', changed_at: ts(-35), changed_by: ME },
];
const PROC_ACCOUNTS = [{ id: 'pa1', label: 'Coffee Boy rate card', company_id: 'c1', location_id: 'l1' }];
// £100k/mo at 1.20% against a 0.90% buy, plus 8,000 txns at 5p vs 3p.
// margin = (1200 + 400) - (900 + 240) = £460/mo -> £5,520 a year.
const PROC_RATES = [
  { id: 'pr1', account_id: 'pa1', category: 'visa_mc_cp', monthly_volume: 100000, monthly_txns: 8000, current_rate_pct: 1.6, our_rate_pct: 1.2, buy_rate_pct: 0.9, our_txn_fee: 5, buy_txn_fee: 3 },
];
const WEIGHTS = [{ stage: 'qualified', probability: 0.25 }, { stage: 'demo_booked', probability: 0.4 }, { stage: 'proposal_sent', probability: 0.7 }, { stage: 'negotiation', probability: 0.85 }];
// Harness only: a long email ticket, so the scroll, Reply all and note edit fixes can be seen.
// The latest email copies Kate and the ops inbox, and copies our own mailbox in capitals.
const TICKET_THREAD = [
  { id: 'e1', type: 'email', direction: 'inbound', subject: 'Card machine offline', body: 'Hi, our terminal went offline this morning. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', contact_id: 'ct1', is_internal: false, occurred_at: ts(0, 30), created_at: ts(0, 30), channel_metadata: { from: 'Dan Marsh <dan@verde.example>', gmail_message_id: 'gm-e1' } },
  { id: 'e2', type: 'email', direction: 'outbound', subject: 'Re: Card machine offline', body: 'Thanks Dan, we are looking into it now. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', actor_id: ME, is_internal: false, occurred_at: ts(0, 29), created_at: ts(0, 29), channel_metadata: { from: 'support@posup.co.uk', to: 'dan@verde.example', gmail_message_id: 'gm-e2' } },
  { id: 'n1', type: 'note', body: 'Checked the terminal logs, it loses Wi-Fi every 20 minutes.', subject_type: 'ticket', subject_id: 'k1', actor_id: 'u-sarah', is_internal: true, occurred_at: ts(0, 28), created_at: ts(0, 28), channel_metadata: {} },
  { id: 'e3', type: 'email', direction: 'inbound', subject: 'Card machine offline', body: 'It happened again at lunch. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', contact_id: 'ct1', is_internal: false, occurred_at: ts(0, 26), created_at: ts(0, 26), channel_metadata: { from: 'Dan Marsh <dan@verde.example>', gmail_message_id: 'gm-e3' } },
  { id: 'e4', type: 'email', direction: 'outbound', subject: 'Re: Card machine offline', body: 'Could you try the ethernet cable in the box? The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', actor_id: ME, is_internal: false, occurred_at: ts(0, 25), created_at: ts(0, 25), channel_metadata: { from: 'support@posup.co.uk', to: 'dan@verde.example', gmail_message_id: 'gm-e4' } },
  { id: 'e5', type: 'email', direction: 'inbound', subject: 'Card machine offline', body: 'Ethernet is in, still dropping. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', contact_id: 'ct1', is_internal: false, occurred_at: ts(0, 20), created_at: ts(0, 20), channel_metadata: { from: 'Dan Marsh <dan@verde.example>', gmail_message_id: 'gm-e5' } },
  { id: 'e6', type: 'email', direction: 'outbound', subject: 'Re: Card machine offline', body: 'We will send a replacement unit. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', actor_id: ME, is_internal: false, occurred_at: ts(0, 19), created_at: ts(0, 19), channel_metadata: { from: 'support@posup.co.uk', to: 'dan@verde.example', gmail_message_id: 'gm-e6' } },
  { id: 'n2', type: 'note', body: 'Chased Adyen, waiting on a replacment terminal.', subject_type: 'ticket', subject_id: 'k1', actor_id: 'u-peter', is_internal: true, occurred_at: ts(0, 18), created_at: ts(0, 18), channel_metadata: {} },
  { id: 'e7', type: 'email', direction: 'inbound', subject: 'Card machine offline', body: 'Any update on the replacement? The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', contact_id: 'ct1', is_internal: false, occurred_at: ts(0, 10), created_at: ts(0, 10), channel_metadata: { from: 'Dan Marsh <dan@verde.example>', gmail_message_id: 'gm-e7' } },
  { id: 'e8', type: 'email', direction: 'outbound', subject: 'Re: Card machine offline', body: 'It ships today, tracking to follow. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', actor_id: ME, is_internal: false, occurred_at: ts(0, 9), created_at: ts(0, 9), channel_metadata: { from: 'support@posup.co.uk', to: 'dan@verde.example', gmail_message_id: 'gm-e8' } },
  { id: 'e9', type: 'email', direction: 'inbound', subject: 'Card machine offline', body: 'Copying Kate who runs the floor and our ops inbox. The card machine keeps dropping its connection during service and staff are taking cash instead. The card machine keeps dropping its connection during service and staff are taking cash instead.', subject_type: 'ticket', subject_id: 'k1', contact_id: 'ct1', is_internal: false, occurred_at: ts(0, 2), created_at: ts(0, 2), channel_metadata: { from: 'Dan Marsh <dan@verde.example>', gmail_message_id: 'gm-e9', to: 'support@posup.co.uk, ops@verde.example', cc: 'Kate Lowe <kate@verde.example>, SUPPORT@POSUP.CO.UK' } },
  { id: 'n3', type: 'note', body: 'Tracking number sent to Dan.', subject_type: 'ticket', subject_id: 'k1', actor_id: 'u-peter', is_internal: true, occurred_at: ts(0, 0.2), created_at: ts(0, 0.2), channel_metadata: {} },
];
ACTIVITIES.push(...TICKET_THREAD);
export const TABLES = { gmail_connections_safe: [{ email: 'support@posup.co.uk' }], user_integrations: [{ profile_id: ME, provider: 'google', email: 'peter@posup.co.uk' }], ticket_email_threads: [], deal_stage_weights: WEIGHTS, deal_trading: [], location_modules: [], modules: [], feature_requests: [], profiles: MEMBERS, companies: COMPANIES, locations: LOCATIONS, deals: DEALS, crm_projects: PROJECTS, tasks: TASKS, work_items: WORK, tickets: TICKETS, onboardings: ONBOARDINGS, contacts: CONTACTS, associations: ASSOC, notifications: NOTIFS, bills: BILLS, quotes: QUOTES, quote_line_items: QLINES, products: PRODUCTS, inv_serials: SERIALS, crm_activities: ACTIVITIES, time_entries: TIME, expenses: [], bill_schedules: [], recurring_bills: [], suppliers: [{ id: 's1', name: 'Lightspeed POS UK Ltd' }, { id: 's2', name: 'Adyen N.V.' }, { id: 's3', name: 'Sumup Payments Ltd' }], expense_categories: [{ id: 'ec1', label: 'Software', active: true, sort: 1 }], attachments: [], processing_accounts: PROC_ACCOUNTS, processing_rates: PROC_RATES, leads: LEADS, stage_history: STAGE_HISTORY };
export const MEMBERS_LIST = MEMBERS;

function makeQuery(table) {
  let rows = (TABLES[table] || []).slice(); let head = false; let single = false; let patch = null; let inserted = null;
  // Harness only: an update changes the rows the filters matched and an insert
  // adds rows, the way the database would, so note edits and new notes show up.
  const res = () => {
    if (inserted) { (TABLES[table] = TABLES[table] || []).push(...inserted); rows = inserted; inserted = null; }
    if (patch) {
      rows.forEach((r) => { const textChanged = table === 'crm_activities' && 'body' in patch && patch.body !== r.body; Object.assign(r, patch); if (textChanged) r.edited_at = new Date().toISOString(); });
      patch = null;
    }
    return { data: single ? (rows[0] ?? null) : head ? null : rows, error: null, count: rows.length };
  };
  const filt = (fn) => { rows = rows.filter(fn); return proxy; };
  const api = {
    select: (_c, o) => { if (o?.head) head = true; return proxy; },
    eq: (k, v) => filt(r => r[k] === v), neq: (k, v) => filt(r => r[k] !== v), in: (k, a) => filt(r => a.includes(r[k])),
    is: (k, v) => filt(r => (v === null ? r[k] == null : r[k] === v)), not: () => proxy, or: () => proxy, gte: () => proxy, lte: () => proxy, gt: () => proxy, lt: () => proxy, ilike: () => proxy, like: () => proxy, contains: () => proxy, textSearch: () => proxy,
    order: () => proxy, limit: (n) => { rows = rows.slice(0, n); return proxy; }, range: () => proxy,
    single: () => { single = true; return proxy; }, maybeSingle: () => { single = true; return proxy; },
    insert: (v) => { const now = new Date().toISOString(); inserted = (Array.isArray(v) ? v : [v]).map((r) => ({ id: `stub-${Math.random().toString(36).slice(2, 9)}`, created_at: now, occurred_at: now, ...r })); return proxy; },
    update: (v) => { patch = v; return proxy; }, upsert: () => proxy, delete: () => proxy,
    then: (r, j) => Promise.resolve(res()).then(r, j), catch: (j) => Promise.resolve(res()).catch(j), finally: (f) => Promise.resolve(res()).finally(f),
  };
  const proxy = new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => proxy) });
  return proxy;
}
const chan = { on() { return chan; }, subscribe() { return chan; }, unsubscribe() {} };
export const supabase = {
  from: makeQuery,
  rpc: () => Promise.resolve({ data: null, error: null }),
  channel: () => chan, removeChannel: () => {}, removeAllChannels: () => {},
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: ME } } } }), getUser: () => Promise.resolve({ data: { user: { id: ME } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: '#' }, error: null }), remove: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '#' } }) }) },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
};
export const APP_URL = 'http://localhost:5198';
