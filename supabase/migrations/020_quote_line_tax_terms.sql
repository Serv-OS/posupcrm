-- Migration 020: per-line tax rates + global quote terms
ALTER TABLE public.quote_line_items ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 20;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS quote_terms text;
