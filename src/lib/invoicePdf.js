// One-click invoice → PDF. Pure client-side (jsPDF), lazy-loaded by the
// InvoiceBuilder so jsPDF stays out of the main bundle. buildInvoiceDoc is kept
// pure (returns the doc) so it can be unit-tested in Node; downloadInvoicePdf
// wraps it with the browser save().
//
// A credit note is printed by the same layout (renderDoc below), not a copy of
// it: buildCreditNoteDoc and buildInvoiceDoc only decide WHAT goes in the
// header, the totals and the text blocks, so a change to the branding or the
// line table lands on both documents at once.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  amountPaid, balanceDue, creditableLeft, creditNoteLabel, creditNoteStatusKind, creditNoteStatusLabel, creditState, creditTotals, creditUse, settledAmount,
} from './creditNotes'

const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [21, 194, 106]
}

const fmtDate = (d, locale = 'en-US') => {
  if (!d) return ''
  const date = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
  if (isNaN(date)) return String(d)
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Best-effort: turn a remote logo URL into a data URL for embedding. Returns
// null on any failure (CORS, 404, non-image) so the PDF falls back to text.
async function toDataUrl(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const r = new FileReader()
      r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// The layout both documents share. The caller decides the words and figures:
//   title       'INVOICE' or 'CREDIT NOTE', top right in the brand colour
//   fallbackName  shown top left when there is no seller name or logo
//   meta        [[label, value]] under the title
//   pill        { t, bg, fg } status pill under the meta, or null
//   billLabel   heading over the customer block
//   intro       [{ title?, text, strong? }] text blocks between the customer and the lines
//   totals      [{ label, value, bold?, color?, rule?, minus?, note? }] down the right
//   blocks      [[title, text]] notes under the totals
//   ref         the document number in the footer
async function renderDoc({
  seller = {}, billTo = {}, lines = [], money, taxLabel, title, fallbackName, meta = [], pill = null,
  billLabel = 'BILL TO', intro = [], totals = [], blocks = [], ref = '',
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 48
  const [ar, ag, ab] = hexToRgb(seller.accent)
  let y = M

  // ── Header: seller (left) + document meta (right) ──────────────────────────
  const logoData = seller.logo_url ? await toDataUrl(seller.logo_url) : null
  let leftBottom = y
  if (logoData) {
    try {
      const props = doc.getImageProperties(logoData)
      const h = 40
      const w = Math.min(180, (props.width / props.height) * h)
      doc.addImage(logoData, props.fileType || 'PNG', M, y, w, h, undefined, 'FAST')
      leftBottom = y + h + 8
    } catch {
      // fall through to text name
    }
  }
  if (leftBottom === y) {
    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(20, 20, 20)
    doc.text(seller.name || fallbackName, M, y + 16)
    leftBottom = y + 28
  }
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110)
  const leftW = 300 // keep seller text clear of the right-hand meta column
  const sellerLines = []
  if (seller.address) sellerLines.push(...doc.splitTextToSize(String(seller.address), leftW))
  const sellerContact = [seller.email, seller.phone].filter(Boolean).join('   ·   ')
  if (sellerContact) sellerLines.push(...doc.splitTextToSize(sellerContact, leftW))
  let sy = leftBottom + 3
  for (const line of sellerLines) { doc.text(line, M, sy); sy += 12 }
  leftBottom = sy

  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(ar, ag, ab)
  doc.text(title, W - M, y + 16, { align: 'right' })
  doc.setFontSize(10).setFont('helvetica', 'normal')
  let ry = y + 38
  for (const [k, v] of meta) {
    doc.setTextColor(150, 150, 150).text(k, W - M - 140, ry)
    doc.setTextColor(40, 40, 40).text(String(v), W - M, ry, { align: 'right' })
    ry += 15
  }

  if (pill) {
    ry += 4
    doc.setFont('helvetica', 'bold').setFontSize(9)
    // 78pt fits PAID and OVERDUE; USED ON INV-1050 and CANCELLED need more.
    // Words too long for the space right of the seller's details (credit used
    // on several invoices) give way to pill.short when there is one.
    const text = pill.short && doc.getTextWidth(pill.t) + 20 > 190 ? pill.short : pill.t
    const pw = Math.max(78, doc.getTextWidth(text) + 20)
    doc.setFillColor(...pill.bg).roundedRect(W - M - pw, ry - 11, pw, 18, 4, 4, 'F')
    doc.setTextColor(...pill.fg).text(text, W - M - pw / 2, ry + 1, { align: 'center' })
    ry += 16
  }

  y = Math.max(leftBottom, ry) + 14

  // ── Bill To / Service location ─────────────────────────────────────────────
  doc.setDrawColor(232).line(M, y, W - M, y)
  y += 20
  const col2 = M + (W - 2 * M) / 2
  const billW = col2 - M - 16   // wrap each column to its own width so they never collide
  const locW = (W - M) - col2
  const wrapParts = (parts, w) => parts.filter(Boolean).flatMap((p) => doc.splitTextToSize(String(p), w))
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(150, 150, 150)
  doc.text(billLabel, M, y)
  const billLines = wrapParts([billTo.companyName, billTo.companyAddress, billTo.contactName, billTo.contactEmail], billW)
  const locLines = wrapParts([billTo.locationName, billTo.locationAddress], locW)
  if (locLines.length) doc.text('SERVICE LOCATION', col2, y)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(45, 45, 45)
  let by = y + 15
  for (const l of (billLines.length ? billLines : ['—'])) { doc.text(l, M, by); by += 13 }
  let ly = y + 15
  for (const l of locLines) { doc.text(l, col2, ly); ly += 13 }
  y = Math.max(by, ly) + 8

  // ── Text blocks: a heading in grey caps, then wrapped text ─────────────────
  const block = (heading, text, opts = {}) => {
    if (!text) return
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = M }
    if (heading) {
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(150, 150, 150).text(heading, M, y)
      y += 13
    }
    if (opts.strong) doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(40, 40, 40)
    else doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(80, 80, 80)
    const wrapped = doc.splitTextToSize(String(text), W - 2 * M)
    doc.text(wrapped, M, y)
    y += wrapped.length * (opts.strong ? 13 : 12) + 10
  }
  if (intro.length) {
    y += 6
    for (const b of intro) block(b.title, b.text, b)
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  const body = (lines || [])
    .filter((l) => (l.name || '').trim() || Number(l.qty) || Number(l.unit_price))
    .map((l) => {
      const net = (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
      const desc = l.description ? `${l.name}\n${l.description}` : (l.name || '')
      return [desc, String(Number(l.qty) || 0), money(l.unit_price), `${Number(l.tax_rate) || 0}%`, money(net)]
    })
  autoTable(doc, {
    startY: y,
    head: [['Description', 'Qty', 'Unit', taxLabel, 'Amount']],
    body: body.length ? body : [['—', '', '', '', money(0)]],
    theme: 'striped',
    headStyles: { fillColor: [ar, ag, ab], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, textColor: [45, 45, 45], cellPadding: 6 },
    alternateRowStyles: { fillColor: [248, 250, 248] },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right', cellWidth: 44 },
      2: { halign: 'right', cellWidth: 72 },
      3: { halign: 'right', cellWidth: 52 },
      4: { halign: 'right', cellWidth: 84 },
    },
    margin: { left: M, right: M },
  })
  y = (doc.lastAutoTable?.finalY || y) + 16

  // ── Totals (right column) ──────────────────────────────────────────────────
  const tx = W - M - 220
  for (const r of totals) {
    if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = M }
    // 12pt above the baseline sits in the gap between the rows. It used to be
    // 6pt, which ran through the lower case letters of "Total" like a strike
    // out, and a struck out total on a credit note reads as cancelled.
    if (r.rule) doc.setDrawColor(225).line(tx, y - 12, W - M, y - 12)
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal').setFontSize(r.bold ? 11 : 10)
    doc.setTextColor(...(r.color || [90, 90, 90])).text(r.label, tx, y)
    // A plain hyphen: the PDF's built-in font has no minus sign.
    doc.setTextColor(...(r.color || [40, 40, 40])).text(`${r.minus ? '-' : ''}${money(r.value)}`, W - M, y, { align: 'right' })
    y += r.bold ? 20 : 16
    if (r.note) {
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(130, 130, 130)
      doc.text(String(r.note), tx, y - 4)
      y += 10
    }
  }
  y += 8

  // ── Notes + terms ──────────────────────────────────────────────────────────
  for (const [heading, text] of blocks) block(heading, text)

  // ── Footer ─────────────────────────────────────────────────────────────────
  const fy = doc.internal.pageSize.getHeight() - 36
  doc.setDrawColor(238).line(M, fy - 12, W - M, fy - 12)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(160, 160, 160)
  doc.text([seller.name, seller.email, seller.phone].filter(Boolean).join('   ·   ') || 'Thank you for your business', M, fy)
  doc.text(ref, W - M, fy, { align: 'right' })

  return doc
}

// 'CN-1001' from a row, a number, or a label the server already built.
const cnLabelOf = (note = {}) => {
  const n = note?.credit_number ?? note?.number
  return typeof n === 'string' && /^CN-/i.test(n) ? n : creditNoteLabel(n)
}

const moneyFn = (fmt) => (typeof fmt === 'function' ? fmt : (n) => (Number(n) || 0).toFixed(2))

// Active credit allocations only: a removed one takes nothing off.
const activeAllocations = (list) => (Array.isArray(list) ? list : [])
  .filter((a) => a && !a.removed_at && Number(a.amount) > 0)

/**
 * An invoice as a PDF doc, not saved.
 *   inv          the invoices row (amount_paid, amount_credited, amount_allocated read off it)
 *   lines, totals, seller, billTo, fmt, taxLabel, dateLocale  as before
 *   totals       { subtotal, tax, total, paid?, credited?, allocated? }
 *   allocations  optional: the credit_allocations applied TO this invoice, as
 *                [{ credit_number (or number, or credit_note: { credit_number }),
 *                amount }]. Each prints as "Credit applied CN-1003". Removed
 *                ones (removed_at set) are left out. Without them, credit applied
 *                prints as one "Credit applied" row of inv.amount_allocated.
 */
export async function buildInvoiceDoc({ inv = {}, lines = [], totals = {}, allocations, seller = {}, billTo = {}, fmt, taxLabel = 'Tax', dateLocale = 'en-US' }) {
  const number = inv.invoice_number ?? inv.number ?? ''
  const status = (inv.status || '').toLowerCase()
  const total = totals.total ?? inv.total ?? 0

  // Credit notes and credit applied from other invoices' credit notes
  // (src/lib/creditNotes.js). With neither, everything below reads exactly as
  // it did before credit notes existed.
  const credited = Number(totals.credited ?? inv.amount_credited) || 0
  const hasCredit = credited > 0
  const appliedList = activeAllocations(allocations)
  const listSum = appliedList.reduce((t, a) => t + Math.round((Number(a.amount) || 0) * 100), 0) / 100
  const applied = Number(totals.allocated ?? inv.amount_allocated ?? listSum) || 0
  const hasApplied = applied > 0
  const state = { status, total, amount_paid: totals.paid ?? inv.amount_paid, amount_credited: credited, amount_allocated: applied }
  const balance = balanceDue(state)
  const paid = amountPaid(state)
  const money = moneyFn(fmt)

  // status pill. Fully credited with nothing paid is not overdue: nothing is owed.
  const pill = status === 'paid'
    ? { t: 'PAID', bg: [209, 250, 229], fg: [6, 95, 70] }
    : (hasCredit && creditState(state) === 'full' && settledAmount(state) === 0) ? { t: 'CREDITED', bg: [224, 231, 255], fg: [55, 48, 163] }
      : ((inv.overdue || status === 'overdue') && !((hasCredit || hasApplied) && balance === 0)) ? { t: 'OVERDUE', bg: [254, 226, 226], fg: [153, 27, 27] }
        : null

  const rows = [
    { label: 'Subtotal', value: totals.subtotal ?? inv.subtotal ?? 0 },
    { label: taxLabel, value: totals.tax ?? inv.tax_amount ?? 0 },
  ]
  const [ar, ag, ab] = hexToRgb(seller.accent)
  rows.push({ label: 'Total', value: total, bold: true, color: [ar, ag, ab], rule: true })
  if (hasCredit || hasApplied) {
    // The customer pays the balance, so every step to it is shown.
    if (hasCredit) rows.push({ label: 'Credited', value: credited, minus: true })
    // Applied credit is a settlement, not cash, so it is its own step.
    if (appliedList.length) {
      for (const a of appliedList) {
        const cn = cnLabelOf(a.credit_note ?? a.credit_notes ?? a)
        rows.push({ label: cn ? `Credit applied ${cn}` : 'Credit applied', value: Number(a.amount) || 0, minus: true })
      }
    } else if (hasApplied) {
      rows.push({ label: 'Credit applied', value: applied, minus: true })
    }
    if (paid > 0) rows.push({ label: 'Paid', value: paid, color: [6, 120, 70], minus: true })
    // Paid in full and then credited: the balance stops at 0, so say where the
    // rest went rather than print sums that do not add up. The credit note
    // itself says whether it has been refunded or used. Settled (cash plus
    // credit applied) against what the invoice asks after its credit notes,
    // both in pennies, as the public invoice page works it out.
    const over = settledAmount(state) - creditableLeft(state)
    rows.push({ label: 'Balance due', value: balance, bold: true,
      note: over > 0.005 ? `${money(over)} more was paid than is now owed` : null })
  } else if (status === 'paid') {
    const paidRaw = totals.paid ?? inv.amount_paid ?? totals.total ?? inv.total ?? 0
    rows.push({ label: 'Paid', value: paidRaw, color: [6, 120, 70] })
    const bal = (Number(total) - Number(paidRaw))
    if (Math.abs(bal) > 0.005) rows.push({ label: 'Balance due', value: bal, bold: true })
  } else if (status !== 'draft' && status !== 'void' && paid > 0) {
    // Part paid with no credit (a payment recorded, or a deposit): what came in
    // and what is left, as the public invoice page and the email show it.
    rows.push({ label: 'Paid', value: paid, color: [6, 120, 70], minus: true })
    rows.push({ label: 'Balance due', value: balance, bold: true })
  }

  return renderDoc({
    seller, billTo, lines, money, taxLabel,
    title: 'INVOICE',
    fallbackName: 'Invoice',
    meta: [
      ['Invoice', `INV-${number}`],
      inv.po_number ? ['PO', String(inv.po_number)] : null,
      ['Issued', fmtDate(inv.issue_date, dateLocale)],
      inv.due_date ? ['Due', fmtDate(inv.due_date, dateLocale)] : null,
    ].filter(Boolean),
    pill,
    totals: rows,
    blocks: [['NOTES', inv.notes], ['TERMS', inv.terms]],
    ref: `INV-${number}`,
  })
}

export async function downloadInvoicePdf(data) {
  const doc = await buildInvoiceDoc(data)
  const number = data?.inv?.invoice_number ?? data?.inv?.number ?? 'invoice'
  doc.save(`INV-${number}.pdf`)
}

// 'INV-1050' from a row, a number, or a label the server already built.
const invLabelOf = (a = {}) => {
  const n = a.invoice_number ?? a.number ?? a.invoice?.invoice_number ?? a.invoices?.invoice_number
  if (n == null || n === '') return ''
  return typeof n === 'string' && /^INV-/i.test(n) ? n : `INV-${n}`
}

/**
 * A credit note as a PDF doc, not saved. Takes the credit_notes row as stored
 * (its subtotal, tax_amount and total are already in pennies, so they are
 * printed as they are, never summed again) and the invoice it credits.
 *   note      credit_notes row: credit_number, issue_date, reason, subtotal,
 *             tax_amount, total, status, refund_status, refund_due,
 *             refunded_at, refund_method, cancelled_at, and amount_allocated
 *             and refunded_amount, which say where its credit went. `number`
 *             is read too.
 *   lines     credit_note_lines rows (falls back to note.lines)
 *   invoice   the invoice: invoice_number (or number) and issue_date
 *   allocations  optional: the note's credit applied to other invoices, as
 *             [{ invoice_number (or number, or invoice: { invoice_number }),
 *             amount }]. Each prints as "Applied to invoice INV-1050". Removed
 *             ones (removed_at set) are left out. Without them, what was
 *             applied prints as one "Used on other invoices" row.
 *   seller, billTo, fmt, taxLabel, dateLocale  exactly as buildInvoiceDoc
 */
export async function buildCreditNoteDoc({ note = {}, lines, invoice = {}, allocations, seller = {}, billTo = {}, fmt, taxLabel = 'Tax', dateLocale = 'en-US' }) {
  const label = cnLabelOf(note)
  const rows = lines ?? note.lines ?? []
  const invNumber = invoice?.invoice_number ?? invoice?.number ?? note.invoice_number ?? ''
  const invDate = invoice?.issue_date ?? note.invoice_issue_date
  const cancelled = note.status === 'cancelled'
  // A row saved by issue_credit_note always has its totals. The sum is only a
  // fallback, and it is the same rule the database used.
  const sums = note.total != null ? null : creditTotals(rows)
  const [ar, ag, ab] = hexToRgb(seller.accent)

  // The chip follows the staff screens' words (creditNoteStatusLabel: "£224.00
  // to use", "Used on INV-1050"), coloured by its kind. A note that only
  // reduced its own invoice has none; the Invoice line already names it.
  const kind = creditNoteStatusKind(note)
  const words = creditNoteStatusLabel(note, {
    invoiceNumber: invNumber,
    usedOn: activeAllocations(allocations).map((a) => ({ invoice_number: invLabelOf(a) || null })),
    money: moneyFn(fmt),
  }).toUpperCase()
  const amber = { bg: [254, 243, 199], fg: [146, 64, 14] }
  const green = { bg: [209, 250, 229], fg: [6, 95, 70] }
  const pill = cancelled ? { t: 'CANCELLED', bg: [241, 245, 249], fg: [100, 116, 139] }
    : kind === 'Available' ? { t: words, short: 'CREDIT TO USE', ...amber }
      : kind === 'Part used' ? { t: words, short: 'PART USED', ...amber }
        : kind === 'Used' ? { t: words, short: 'USED', ...green }
          : kind === 'Refunded' ? { t: words, short: 'REFUNDED', ...green }
            : null

  const totals = [
    { label: 'Subtotal', value: sums ? sums.subtotal : (note.subtotal ?? 0) },
    { label: taxLabel, value: sums ? sums.tax_amount : (note.tax_amount ?? 0) },
    { label: 'Total credited', value: sums ? sums.total : note.total, bold: true, color: [ar, ag, ab], rule: true },
  ]
  if (!cancelled) {
    // Where the money beyond what the invoice asks for went: applied to other
    // invoices, refunded, or still there to use.
    const use = creditUse(note)
    const appliedList = activeAllocations(allocations)
    if (use.used > 0) {
      if (appliedList.length) {
        for (const a of appliedList) {
          const inv = invLabelOf(a)
          totals.push({ label: inv ? `Applied to invoice ${inv}` : 'Applied to an invoice', value: Number(a.amount) || 0 })
        }
      } else {
        totals.push({ label: 'Used on other invoices', value: use.used })
      }
    }
    if (use.refunded > 0) {
      const how = [note.refunded_at ? fmtDate(note.refunded_at, dateLocale) : '', note.refund_method || ''].filter(Boolean).join(', ')
      totals.push({ label: 'Refunded', value: use.refunded, color: [6, 120, 70], note: how || null })
    }
    if (use.left > 0) {
      totals.push({ label: use.used > 0 || use.refunded > 0 ? 'Credit left' : 'Credit available', value: use.left, bold: true, color: [146, 64, 14] })
    }
  }

  const forInvoice = invNumber
    ? `Credit for invoice INV-${invNumber}${invDate ? `, issued ${fmtDate(invDate, dateLocale)}` : ''}`
    : ''

  return renderDoc({
    seller, billTo, lines: rows, money: moneyFn(fmt), taxLabel,
    title: 'CREDIT NOTE',
    fallbackName: 'Credit note',
    meta: [
      ['Credit note', label],
      ['Issued', fmtDate(note.issue_date, dateLocale)],
      invNumber ? ['Invoice', `INV-${invNumber}`] : null,
    ].filter(Boolean),
    pill,
    billLabel: 'CREDIT TO',
    intro: [
      { text: forInvoice, strong: true },
      { title: 'REASON', text: note.reason },
      cancelled ? { title: 'CANCELLED', text: `This credit note was cancelled${note.cancelled_at ? ` on ${fmtDate(note.cancelled_at, dateLocale)}` : ''}. It no longer reduces the invoice.` } : null,
    ].filter(Boolean),
    totals,
    ref: label,
  })
}

/**
 * Builds the credit note PDF and saves it as CN-1001.pdf. Same argument as
 * buildCreditNoteDoc; returns the doc.
 */
export async function creditNotePdf(data) {
  const doc = await buildCreditNoteDoc(data)
  doc.save(`${cnLabelOf(data?.note) || 'credit-note'}.pdf`)
  return doc
}
