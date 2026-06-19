-- 057: add 'resale_commissions' as an allowed product / quote-line category.
-- Additive only — widens the existing CHECK constraints; existing rows unaffected.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
  CHECK (category = ANY (ARRAY['hardware','services','saas','payments','resale_commissions']::text[]));

ALTER TABLE quote_line_items DROP CONSTRAINT IF EXISTS quote_line_items_category_check;
ALTER TABLE quote_line_items ADD CONSTRAINT quote_line_items_category_check
  CHECK (category = ANY (ARRAY['hardware','services','saas','payments','resale_commissions']::text[]));
