-- A 103KB PNG logo was fetched over the network and base64-encoded into EVERY
-- server-generated invoice PDF. That encode is the single most expensive thing
-- the recurring-invoice job did, and it is why one PDF could exhaust an edge
-- function's entire compute budget (WORKER_RESOURCE_LIMIT) and kill the run
-- before the remaining invoices were sent.
--
-- The logo does not change between invoices, so encoding it per invoice is pure
-- waste. Store it once, already shrunk and already base64, and the PDF builder
-- does no fetch and no encode at all — it just embeds a string.
alter table public.support_settings add column if not exists logo_pdf_data text;

comment on column public.support_settings.logo_pdf_data is
  'Small pre-encoded data: URL of the logo, used by server-side PDF generation. Regenerate if the logo changes; logo_url stays the source of truth for the UI.';
