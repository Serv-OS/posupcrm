-- Per-line VAT on invoices (mirrors quote_line_items.tax_rate)
ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 20;
-- Existing lines inherit their invoice's header rate so stored totals still reconcile
UPDATE public.invoice_line_items li SET tax_rate = coalesce(i.tax_rate, 0)
  FROM public.invoices i WHERE i.id = li.invoice_id;
