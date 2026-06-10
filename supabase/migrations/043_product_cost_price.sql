-- Cost price on the shared catalogue (selling price = default_price).
-- Per-serial landed costs remain the source of truth for actuals; this is the
-- default cost for receiving without a PO and the basis for margin display.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric;
