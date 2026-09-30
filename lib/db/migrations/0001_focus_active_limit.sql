-- Backstop for the 2-active Personal Development limit (the app also enforces it in a transaction).
CREATE OR REPLACE FUNCTION enforce_focus_active_limit() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtext('focus_items:' || NEW.user_id));
    IF (
      SELECT count(*) FROM focus_items
      WHERE user_id = NEW.user_id AND status = 'active' AND id <> NEW.id
    ) >= 2 THEN
      RAISE EXCEPTION 'FOCUS_LIMIT: Finish or drop one first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS focus_items_active_limit ON focus_items;
--> statement-breakpoint
CREATE TRIGGER focus_items_active_limit
  BEFORE INSERT OR UPDATE OF status ON focus_items
  FOR EACH ROW EXECUTE FUNCTION enforce_focus_active_limit();
