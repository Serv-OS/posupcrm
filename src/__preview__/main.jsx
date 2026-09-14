import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import TodayPanel from '../components/crm/TodayPanel.jsx';
import TaskDetail from '../components/crm/TaskDetail.jsx';
import TicketDetail from '../components/crm/TicketDetail.jsx';
import ProjectDetail from '../components/crm/ProjectDetail.jsx';
import ProjectList from '../components/crm/ProjectList.jsx';
import TaskList from '../components/crm/TaskList.jsx';
import Timeline from '../components/crm/Timeline.jsx';
import WorkCalendar from '../components/crm/WorkCalendar.jsx';
import WorkBoard from '../components/crm/WorkBoard.jsx';
import BillsPanel from '../components/finance/BillsPanel.jsx';
import QuoteBuilder from '../components/crm/QuoteBuilder.jsx';
import MobileInbox from '../components/crm/MobileInbox.jsx';
import CallLogPanel from '../components/crm/CallLogPanel.jsx';
import LeadDetail from '../components/crm/LeadDetail.jsx';
import DealDetail from '../components/crm/DealDetail.jsx';
import ReportingDashboard from '../components/crm/ReportingDashboard.jsx';
import LocationDetail from '../components/crm/LocationDetail.jsx';
import OnboardingDetail from '../components/crm/OnboardingDetail.jsx';
import InvoiceBuilder from '../components/crm/InvoiceBuilder.jsx';
import InvoicesPanel from '../components/crm/InvoicesPanel.jsx';
import CreditNoteModal from '../components/crm/CreditNoteModal.jsx';
import ApplyCreditModal from '../components/crm/ApplyCreditModal.jsx';
import { balanceDue, creditAvailable } from '../lib/creditNotes.js';
import MobileNav from '../components/MobileNav.jsx';
import QuickAddCommand from '../components/crm/QuickAddCommand.jsx';
import { OfflineBanner } from '../components/crm/ui.jsx';
import { TABLES } from './stub.js';

// Harness only: answer edge-function calls with canned Gmail data and record
// what each composer sent, so Reply and Reply all can be checked without Gmail.
if (!window.__fnPatched) {
  window.__fnPatched = true; window.__fnCalls = [];
  const realFetch = window.fetch.bind(window);
  const ok = (obj) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const LIST = [
    { id: 'm1', threadId: 'th-1', from: 'Dan Marsh <dan@verde.example>', to: 'peter@posup.co.uk', subject: 'Menu changes for the weekend', date: iso(6), snippet: 'Can we add the brunch specials?', unread: false },
    { id: 'm2', threadId: 'th-1', from: 'Kate Lowe <kate@verde.example>', to: 'Peter <peter@posup.co.uk>, Dan Marsh <dan@verde.example>', subject: 'Re: Menu changes for the weekend', date: iso(1), snippet: 'Adding ops so they can update the kiosk.', unread: true },
    { id: 'm3', threadId: 'th-2', from: 'Adyen <no-reply@adyen.com>', to: 'peter@posup.co.uk', subject: 'Payout completed', date: iso(3), snippet: 'Your payout has been sent.', unread: false },
  ];
  const THREAD = [
    { id: 'm1', threadId: 'th-1', messageId: '<m1@verde.example>', from: 'Dan Marsh <dan@verde.example>', to: 'peter@posup.co.uk', cc: '', replyTo: '', references: '', subject: 'Menu changes for the weekend', date: iso(6), unread: false, text: 'Can we add the brunch specials for Saturday and Sunday?', html: '' },
    { id: 'm2', threadId: 'th-1', messageId: '<m2@verde.example>', from: 'Kate Lowe <kate@verde.example>', to: 'Peter <peter@posup.co.uk>, Dan Marsh <dan@verde.example>', cc: 'ops@verde.example, PETER@posup.co.uk', replyTo: '', references: '<m1@verde.example>', subject: 'Re: Menu changes for the weekend', date: iso(1), unread: true, text: 'Adding ops so they can update the kiosk menu too.', html: '' },
  ];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (!u.includes('/functions/v1/')) return realFetch(url, opts);
    const fn = u.split('/functions/v1/')[1].split('?')[0];
    let body = {}; try { body = JSON.parse(opts.body || '{}'); } catch { /* not json */ }
    window.__fnCalls.push({ fn, body });
    if (fn === 'gmail-personal') {
      if (body.action === 'list') return ok({ messages: LIST });
      if (body.action === 'thread') return ok({ messages: THREAD, subject: 'Re: Menu changes for the weekend' });
      if (body.action === 'send') return ok({ success: true, id: 'sent-1', threadId: body.threadId || 'th-1' });
      return ok({ success: true });
    }
    // credit-note-send: stamps the note as the function does with its service
    // role, and answers with the same shape. window.__cnSendFail = 'text'
    // makes it refuse, to see an issued note whose email did not go.
    if (fn === 'credit-note-send') {
      const fail = (error, status) => Promise.resolve(new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } }));
      if (window.__cnSendFail) return fail(window.__cnSendFail, 422);
      const note = TABLES.credit_notes.find((c) => c.id === body.credit_note_id);
      if (!note) return fail('Credit note not found', 404);
      const to = String(body.to || note.email_to || '').trim();
      note.sent_at = new Date().toISOString(); note.email_to = to;
      return ok({ success: true, to, sent_at: note.sent_at });
    }
    if (fn === 'gmail-send') {
      if (body.action === 'recipients') return ok({ from: 'Dan Marsh <dan@verde.example>', to: 'ops@verde.example', cc: 'kate@verde.example', reply_to: null });
      return ok({ success: true });
    }
    return ok({});
  };
}

const P = { id: 'u-peter', display_name: 'Peter', email: 'peter@posup.co.uk', role: 'owner' };

// #creditnote: the raise screen open on INV-1045 (seeded in stub.js), on its
// own so it can be screenshotted at phone width. Issuing runs the in-memory
// issue_credit_note; Close or issue shows a button to open it again, with
// the invoice as it now stands.
function CreditNoteView() {
  const [open, setOpen] = useState(true);
  const [round, setRound] = useState(0);
  const [said, setSaid] = useState('');
  const inv = TABLES.invoices.find((i) => i.id === 'inv1045');
  const lines = TABLES.invoice_line_items.filter((l) => l.invoice_id === inv.id);
  // What the invoice's issued credit notes already used, as loadCreditBasis reads it.
  const issuedIds = TABLES.credit_notes.filter((c) => c.invoice_id === inv.id && c.status === 'issued').map((c) => c.id);
  const creditedLines = TABLES.credit_note_lines.filter((l) => issuedIds.includes(l.credit_note_id));
  return (
    <div style={{ minHeight: '100vh', background: 'var(--scene-bg)', padding: 16 }}>
      <div style={{ maxWidth: 420, margin: '0 auto', fontSize: 13 }} className="space-y-3 text-paper">
        <div>INV-{inv.invoice_number}: credited {inv.amount_credited} of {inv.total}.</div>
        {said && <div data-harness-said>{said}</div>}
        {!open && <button type="button" className="btn-glass px-4 py-2 rounded-xl text-sm" onClick={() => { setRound((r) => r + 1); setOpen(true); }}>Raise a credit note again</button>}
      </div>
      {open && (
        <CreditNoteModal key={round} invoice={{ ...inv }} invoiceLines={lines.map((l) => ({ ...l }))} creditedLines={creditedLines.map((l) => ({ ...l }))} defaultEmail={inv.email_to}
          onClose={() => setOpen(false)}
          onIssued={(note, { emailed, emailError }) => {
            setOpen(false);
            setSaid(`CN-${note.credit_number} issued for ${note.total}${emailed ? `, sent to ${emailed}` : ''}${emailError ? `, email failed: ${emailError}` : ''}.`);
          }} />
      )}
    </div>
  );
}

// #allocate: the apply screen on CN-1003 (Coffee Boy's £224 of credit
// available, seeded in stub.js), on its own so it can be screenshotted at
// phone width. INV-1050 is that customer's one unpaid invoice, so it is picked
// already and the amount starts at £224. Applying runs the in-memory
// allocate_credit; afterwards the invoice it went to opens on its Credit
// applied row, or the screen opens again with the credit as it now stands.
function AllocateView() {
  const [open, setOpen] = useState(true);
  const [round, setRound] = useState(0);
  const [said, setSaid] = useState('');
  const [appliedTo, setAppliedTo] = useState(null);
  const [showing, setShowing] = useState(null);
  const note = TABLES.credit_notes.find((c) => c.id === 'cn1003');
  const target = TABLES.invoices.find((i) => i.id === appliedTo);
  if (showing) return <InvoiceView id={showing} />;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--scene-bg)', padding: 16 }}>
      <div style={{ maxWidth: 420, margin: '0 auto', fontSize: 13 }} className="space-y-3 text-paper">
        <div>CN-{note.credit_number}: {creditAvailable(note)} credit available of {note.refund_due}.</div>
        {said && <div data-harness-said>{said}</div>}
        {!open && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-glass px-4 py-2 rounded-xl text-sm" onClick={() => { setRound((r) => r + 1); setOpen(true); }}>Apply credit again</button>
            {target && <button type="button" className="btn-glass px-4 py-2 rounded-xl text-sm" onClick={() => setShowing(target.id)}>Open INV-{target.invoice_number}</button>}
          </div>
        )}
      </div>
      {open && (
        <ApplyCreditModal key={round} note={{ ...note }}
          onClose={() => setOpen(false)}
          onApplied={(row) => {
            const inv = TABLES.invoices.find((i) => i.id === row.invoice_id);
            setOpen(false);
            setAppliedTo(row.invoice_id);
            setSaid(`${row.amount} applied from CN-${note.credit_number} to INV-${inv?.invoice_number}, which now has ${balanceDue(inv)} to pay.`);
          }} />
      )}
    </div>
  );
}

// #invoice-credits (INV-1045, with its issued and cancelled credit notes) and
// #invoice-paid (INV-1046, paid, so a credit on it owes a refund), and
// #invoice-allocated (INV-1049, with CN-1004's £224 applied to it). Mounted as
// the Shell mounts an invoice: invoice screens are not work views, so no
// .work class, which would stop the header from wrapping on a phone.
function InvoiceView({ id }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--scene-bg)' }}>
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden lg:flex lg:flex-col">
        <InvoiceBuilder key={id} invoiceId={id} profile={P} onClose={() => {}} onNavigate={() => {}} />
      </main>
    </div>
  );
}

function App() {
  const [v, setV] = useState(() => (location.hash || '#today').slice(1));
  useEffect(() => { const f = () => setV(location.hash.slice(1) || 'today'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const nav = () => {};
  if (v === 'creditnote') return <CreditNoteView />;
  if (v === 'invoice-credits' || v === 'invoice-paid') return <InvoiceView id={v === 'invoice-paid' ? 'inv1046' : 'inv1045'} />;
  if (v === 'allocate') return <AllocateView />;
  if (v === 'invoice-allocated') return <InvoiceView id="inv1049" />;
  return (
    <div className="work" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--scene-bg)' }}>
      <main className="work flex-1 min-w-0 overflow-hidden lg:flex lg:flex-col">
        {v !== 'inbox' && <OfflineBanner onView={() => { location.hash = 'inbox'; }} />}
        <div className="contents lg:block lg:flex-1 lg:min-h-0">
        {v === 'today' && <TodayPanel profile={P} onNavigate={nav} />}
        {v === 'task' && <TaskDetail taskId="t3" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'ticket' && <TicketDetail ticketId="k1" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'project' && <ProjectDetail projectId="p1" profile={P} onClose={nav} onSelectTask={nav} onNavigate={nav} />}
        {v === 'projects' && <ProjectList profile={P} onSelect={nav} onNavigate={nav} />}
        {v === 'tasks' && <TaskList profile={P} onNavigate={nav} />}
        {v === 'timeline' && <Timeline profile={P} onNavigate={nav} />}
        {v === 'calendar' && <WorkCalendar profile={P} onNavigate={nav} />}
        {v === 'board' && <WorkBoard profile={P} onNavigate={nav} initialTab="board" />}
        {v === 'bills' && <BillsPanel profile={P} onNavigate={nav} />}
        {v === 'quote' && <QuoteBuilder quoteId="q1" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'reporting' && <ReportingDashboard profile={P} onNavigate={nav} />}
        {v === 'invoices' && <InvoicesPanel profile={P} onNavigate={nav} />}
        {v === 'deal' && <DealDetail dealId="d1" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'onboarding' && <OnboardingDetail onboardingId="o2" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'lead' && <LeadDetail leadId="lead1" profile={P} onClose={nav} onNavigate={nav} />}
        {v === 'calls' && <CallLogPanel profile={P} onNavigate={nav} />}
        {v === 'inbox' && <MobileInbox profile={P} onNavigate={nav} />}
        {v === 'site' && <LocationDetail locationId="l1" profile={P} onClose={nav} onNavigate={nav} onCreateLead={nav} />}
        </div>
      </main>
      <MobileNav profile={P} view={v === 'project' ? 'projects' : v === 'site' ? 'locations' : v} onGo={(k) => { location.hash = k === 'locations' ? 'site' : k; }} />
      <QuickAddCommand profile={P} onNavigate={nav} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
