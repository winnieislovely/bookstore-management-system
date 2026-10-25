-- Integrity mechanisms that Drizzle cannot express (TDD §5.4).

-- Immutable ledgers: UPDATE and DELETE raise (TDD §5.1 “Immutability”).
CREATE OR REPLACE FUNCTION platform.forbid_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only (% not allowed)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON inventory.stock_movement
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
--> statement-breakpoint
CREATE TRIGGER points_ledger_immutable BEFORE UPDATE OR DELETE ON crm.points_ledger
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
--> statement-breakpoint
CREATE TRIGGER audit_entry_immutable BEFORE UPDATE OR DELETE ON platform.audit_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
--> statement-breakpoint

-- Deferred check: at commit, the payments of a completed, non-deposit sale equal its total
-- (TDD §4.4 “Payments”, §5.4). Deposit sales may be part-paid but never over-paid.
CREATE OR REPLACE FUNCTION sales.check_sale_payments() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id uuid;
  v_total bigint;
  v_deposit boolean;
  v_status text;
  v_paid bigint;
BEGIN
  IF TG_TABLE_NAME = 'sale' THEN
    v_sale_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_sale_id := OLD.sale_id;
  ELSE
    v_sale_id := NEW.sale_id;
  END IF;
  SELECT total_vnd, is_deposit, status INTO v_total, v_deposit, v_status FROM sales.sale WHERE id = v_sale_id;
  IF NOT FOUND OR v_status <> 'completed' THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_paid FROM sales.sale_payment WHERE sale_id = v_sale_id;
  IF (v_deposit AND v_paid > v_total) OR (NOT v_deposit AND v_paid <> v_total) THEN
    RAISE EXCEPTION 'Payments (%) do not match sale total (%) for sale %', v_paid, v_total, v_sale_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_payments_match_total
  AFTER INSERT OR UPDATE ON sales.sale
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sales.check_sale_payments();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_payment_sum_matches_total
  AFTER INSERT OR UPDATE OR DELETE ON sales.sale_payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sales.check_sale_payments();
