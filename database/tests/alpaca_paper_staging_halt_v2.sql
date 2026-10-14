\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. Requires staging v1 + halt v2, test roles.
DO $$
DECLARE refused boolean;
DECLARE ok boolean;
BEGIN
 IF has_schema_privilege('anon','sportsedge_private','USAGE')
   OR has_function_privilege('authenticated','sportsedge_private.paper_force_halt(text,text)','EXECUTE')
   OR has_table_privilege('anon','sportsedge_private.alpaca_paper_halt_audit','SELECT') THEN
  RAISE EXCEPTION 'CLIENT_ACCESS_TO_HALT_CONTROLS';
 END IF;
 SELECT sportsedge_private.paper_force_halt('test-paper','ISOLATED_CI_HALT') INTO ok;
 IF NOT ok OR NOT EXISTS(
  SELECT 1 FROM sportsedge_private.alpaca_paper_execution_gate
  WHERE account_alias='test-paper' AND halted=true)
 THEN RAISE EXCEPTION 'HALT_NOT_PERSISTED';END IF;
 -- Once a gate exists, neither an update nor a new row may enable it.
 refused:=false;
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_execution_gate
  SET halted=false WHERE account_alias='test-paper';
 EXCEPTION WHEN raise_exception THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'UNHALT_UPDATE_ALLOWED'; END IF;
 refused:=false;
 BEGIN
  INSERT INTO sportsedge_private.alpaca_paper_execution_gate(
   account_alias,halted,halt_reason) VALUES('test-other',false,'BAD');
 EXCEPTION WHEN raise_exception THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'UNHALT_INSERT_ALLOWED'; END IF;
 -- Stop-only API must work twice and append an audit rather than deleting history.
 SELECT sportsedge_private.paper_force_halt('test-paper','REPEATED_CI_HALT') INTO ok;
 IF NOT ok OR (SELECT count(*) FROM sportsedge_private.alpaca_paper_halt_audit
    WHERE account_alias='test-paper')<>2 THEN
  RAISE EXCEPTION 'STOP_AUDIT_NOT_APPEND_ONLY';
 END IF;
 refused:=false;
 BEGIN
  DELETE FROM sportsedge_private.alpaca_paper_halt_audit WHERE account_alias='test-paper';
 EXCEPTION WHEN raise_exception THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'STOP_AUDIT_CAN_BE_DELETED';END IF;
 refused:=false;
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_halt_audit
  SET reason='TAMPERED' WHERE account_alias='test-paper';
 EXCEPTION WHEN raise_exception THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'STOP_AUDIT_CAN_BE_EDITED';END IF;
 -- Approval is permanently rejected while this staged gate is HALTED.
 INSERT INTO sportsedge_private.alpaca_paper_order_outbox
 (intent_id,account_alias,signal_id,signal_digest,model_version,client_order_id,symbol,shares,limit_cents)
 VALUES('preview-dddddddddddddddddddddddddddddddd','test-paper','rehearsal',
 repeat('d',64),'fixture','ci_paper_halted','AAPL',1,100);
 refused:=false;
 BEGIN
  SELECT sportsedge_private.paper_advance_receipt(
   'preview-dddddddddddddddddddddddddddddddd',0,'owner_approved',
   clock_timestamp(),'test-owner') INTO ok;
 EXCEPTION WHEN raise_exception THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'APPROVAL_ALLOWED_WHILE_HALTED';END IF;
 IF (SELECT status FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE account_alias='test-paper')<>'planned'
 THEN RAISE EXCEPTION 'APPROVAL_MUTATED_ORDER';END IF;
END $$;
SELECT 'STAGING_HALT_V2_DISPOSABLE_PASS' AS result;
