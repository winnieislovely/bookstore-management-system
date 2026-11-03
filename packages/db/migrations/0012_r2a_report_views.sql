-- Report read models over counter sales and online orders (TDD §4.11, SRS BR-29): an online order
-- counts when it is Done, by done_at; its channel is its source. The shipping fee charged to the
-- customer is a line without a product, as on the order's e-invoice.

CREATE VIEW reports.sale_doc AS
  SELECT s.id, 'sale'::text AS kind, s.doc_no, s.sold_at, s.channel, s.customer_id, s.total_vnd, s.vat_vnd, s.is_deposit
  FROM sales.sale s WHERE s.status = 'completed'
  UNION ALL
  SELECT o.id, 'order', o.doc_no, o.done_at, o.source, o.customer_id, o.total_vnd, o.vat_vnd, false
  FROM orders.web_order o WHERE o.done_at IS NOT NULL;
--> statement-breakpoint
CREATE VIEW reports.sale_line AS
  SELECT l.id, l.sale_id AS doc_id, l.variant_id, l.qty, l.total_vnd, l.discount_vnd, l.vat_bp, l.vat_vnd, l.cost_vnd, l.item_class,
         s.sold_at, s.channel, s.customer_id
  FROM sales.sale_line l JOIN sales.sale s ON s.id = l.sale_id WHERE s.status = 'completed'
  UNION ALL
  SELECT l.id, l.order_id, l.variant_id, l.qty, l.total_vnd, l.discount_vnd, l.vat_bp, l.vat_vnd, coalesce(l.cost_vnd, 0), 'goods',
         o.done_at, o.source, o.customer_id
  FROM orders.order_line l JOIN orders.web_order o ON o.id = l.order_id WHERE o.done_at IS NOT NULL
  UNION ALL
  SELECT o.id, o.id, NULL, 0, o.shipping_vnd, 0, 0, 0, 0, 'shipping', o.done_at, o.source, o.customer_id
  FROM orders.web_order o WHERE o.done_at IS NOT NULL AND o.shipping_vnd > 0;
--> statement-breakpoint
-- Returns by return time. An online return records one refund; it is shared over the returned
-- lines by value, the last line taking the remainder so the shares add up exactly.
CREATE VIEW reports.return_line AS
  SELECT rl.id, r.sale_id AS doc_id, r.created_at AS returned_at, rl.refund_vnd, l.variant_id, l.vat_bp, s.channel, s.customer_id
  FROM sales.sale_return_line rl
  JOIN sales.sale_return r ON r.id = rl.return_id
  JOIN sales.sale_line l ON l.id = rl.sale_line_id
  JOIN sales.sale s ON s.id = r.sale_id
  UNION ALL
  SELECT x.line_id, x.order_id, x.received_at,
         CASE WHEN x.rn = 1 THEN x.refund_vnd - (sum(x.base) OVER (PARTITION BY x.return_id) - x.base) ELSE x.base END,
         x.variant_id, x.vat_bp, x.source, x.customer_id
  FROM (
    SELECT v.*, floor(v.refund_vnd * v.value / nullif(sum(v.value) OVER (PARTITION BY v.return_id), 0))::bigint AS base,
           row_number() OVER (PARTITION BY v.return_id ORDER BY v.line_no DESC) AS rn
    FROM (
      SELECT rr.id AS return_id, rr.order_id, rr.received_at, coalesce(rr.refund_vnd, 0) AS refund_vnd,
             ol.id AS line_id, ol.line_no, ol.variant_id, ol.vat_bp, o.source, o.customer_id,
             ol.total_vnd::numeric * (ln.value ->> 'qty')::int / ol.qty AS value
      FROM orders.return_request rr
      JOIN orders.web_order o ON o.id = rr.order_id
      CROSS JOIN LATERAL jsonb_array_elements(rr.lines) AS ln(value)
      JOIN orders.order_line ol ON ol.id = (ln.value ->> 'orderLineId')::uuid
      WHERE rr.status = 'received' AND o.done_at IS NOT NULL
    ) v
  ) x;
