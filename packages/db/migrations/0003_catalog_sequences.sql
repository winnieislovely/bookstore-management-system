-- Internal barcodes for items that have none (FR-CAT-04): EAN-13 in the in-store range "20…".
CREATE SEQUENCE IF NOT EXISTS catalog.internal_barcode_seq START 1;
--> statement-breakpoint
-- Search text (TDD §4.1): kept by the catalogue service; this function is the single definition.
CREATE OR REPLACE FUNCTION catalog.refresh_search_text(p_item uuid) RETURNS void
  LANGUAGE sql AS $$
  UPDATE catalog.item i SET search_text = lower(public.f_unaccent(concat_ws(' ',
      i.i18n -> 'en' ->> 'title',
      i.i18n -> 'vi' ->> 'title',
      array_to_string(i.authors, ' '),
      (SELECT p.i18n -> 'en' ->> 'name' FROM catalog.publisher p WHERE p.id = i.publisher_id),
      (SELECT string_agg(concat_ws(' ', v.sku, v.isbn13), ' ') FROM catalog.item_variant v WHERE v.item_id = i.id),
      (SELECT string_agg(b.code, ' ') FROM catalog.barcode b JOIN catalog.item_variant v ON v.id = b.variant_id WHERE v.item_id = i.id)
    )))
  WHERE i.id = p_item;
$$;
