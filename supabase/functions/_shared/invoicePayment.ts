// Shared: record a card payment against an invoice. Used by stripe-webhook for
// both pay links: the invoice's own (/i/<token>) and a quote's, whose invoice
// was raised at signing.
//
// record_invoice_payment (the credit notes migration, 109) does the work in the
// database, under the same lock as issuing a credit note, so a payment and a
// credit can never pass each other half way:
//   - a Stripe session already recorded is a repeat delivery and changes
//     nothing. The old check compared the session with stripe_checkout_id,
//     which only holds the LAST session opened: pay in one tab after opening
//     another, have Stripe re-send the event, and the payment counted twice.
//   - an invoice already paid is left alone (a second tab, or paid by bank)
//   - otherwise the payment is added to amount_paid, and the invoice is paid
//     once nothing is left to pay
//   - money beyond that (the pay page was open while a credit note was issued)
//     becomes a refund owed on the invoice's newest credit notes, so staff see
//     "Refund owed" instead of a log line nobody reads
//
// Until that migration is applied the function is not there, and the payment
// is recorded as before credit notes, skipping an invoice already paid, so a
// webhook deployed first still records every payment exactly once.

import { balanceDue, amountPaidOn } from "./invoiceEmail.ts";

export type PaymentResult = {
  recorded: boolean;
  reason?: "not_found" | "repeat" | "already_paid";
  invoice_number?: number;
  status?: string;
  amount_paid?: number;
  balance_due?: number;
  overpaid?: number;
  not_on_a_credit_note?: number;
};

export async function recordInvoicePayment(supabase: any, invoiceId: string, amount: number, sessionId: string | null): Promise<PaymentResult> {
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoiceId, p_amount: amount, p_session_id: sessionId,
  });
  if (!error) return data as PaymentResult;
  // PGRST202: PostgREST cannot find the function. 42883: Postgres cannot.
  // Anything else is a real failure, thrown so Stripe sends the event again.
  if (error.code !== "PGRST202" && error.code !== "42883") throw new Error(`record_invoice_payment: ${error.message}`);

  // Before the migration. select("*") so a missing amount_credited column reads
  // as no credit instead of failing.
  const { data: inv, error: readError } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (readError) throw new Error(`invoice read: ${readError.message}`);
  if (!inv) return { recorded: false, reason: "not_found" };
  if (inv.status === "paid") return { recorded: false, reason: "already_paid", invoice_number: inv.invoice_number };
  // Whole millionths, as balanceDue works, so float noise never adds a penny.
  const amountPaid = Math.round((amountPaidOn(inv) + amount) * 1e6) / 1e6;
  const due = balanceDue({ ...inv, amount_paid: amountPaid });
  const { error: writeError } = await supabase.from("invoices").update(due <= 0
    ? { status: "paid", paid_at: new Date().toISOString(), amount_paid: amountPaid }
    : { amount_paid: amountPaid }).eq("id", invoiceId);
  if (writeError) throw new Error(`invoice update: ${writeError.message}`);
  // Both sides in pennies as shown, so 1235.00 paid on a 1234.995 invoice is not "over".
  const overPence = Math.round(amountPaid * 100) - Math.round(balanceDue({ ...inv, status: "sent", amount_paid: 0 }) * 100);
  const overpaid = Math.max(0, overPence) / 100;
  return {
    recorded: true, invoice_number: inv.invoice_number, status: due <= 0 ? "paid" : inv.status,
    amount_paid: amountPaid, balance_due: due, overpaid, not_on_a_credit_note: overpaid,
  };
}

// One line in the function log for anything a person may need to act on.
export function logPayment(r: PaymentResult, sessionId: string, amount: number) {
  const inv = r.invoice_number != null ? `INV-${r.invoice_number}` : "invoice";
  if (!r.recorded) {
    if (r.reason === "repeat") console.log(`stripe-webhook: ${inv} already has session ${sessionId}; repeat delivery, not recorded again`);
    else if (r.reason === "already_paid") console.warn(`stripe-webhook: ${inv} is already paid; session ${sessionId} (£${amount.toFixed(2)}) not recorded. If it is not a repeat delivery, refund it in Stripe.`);
    else console.error(`stripe-webhook: invoice for session ${sessionId} (£${amount.toFixed(2)}) not found; nothing recorded`);
    return;
  }
  if (Number(r.not_on_a_credit_note) > 0) {
    console.error(`stripe-webhook: ${inv} has been paid £${Number(r.not_on_a_credit_note).toFixed(2)} more than it asks for, and no credit note holds it as a refund owed; refund it by hand`);
  } else if (Number(r.overpaid) > 0) {
    console.warn(`stripe-webhook: ${inv} has been paid £${Number(r.overpaid).toFixed(2)} more than it asks for (a credit note was issued while the customer paid); it is recorded as a refund owed on its credit notes`);
  }
  if (Number(r.balance_due) > 0 && r.status !== "paid") {
    console.log(`stripe-webhook: ${inv} took £${amount.toFixed(2)} by card; £${Number(r.balance_due).toFixed(2)} is still due`);
  }
}
