CREATE TABLE public.oidc_rp_logout_transactions (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text NOT NULL CHECK (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  destination text NOT NULL CHECK (destination IN ('signed-out','staff','owner')),
  expires_at timestamptz NOT NULL
);

CREATE INDEX oidc_rp_logout_transactions_expiry
  ON public.oidc_rp_logout_transactions(expires_at);

ALTER TABLE public.oidc_rp_logout_transactions OWNER TO vmms_identity_function_owner;
REVOKE ALL ON TABLE public.oidc_rp_logout_transactions FROM PUBLIC, vmms_runtime;

CREATE FUNCTION public.create_oidc_rp_logout_transaction(p_state_hash text, p_binding_hash text, p_destination text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF p_state_hash !~ '^[0-9a-f]{64}$' OR p_binding_hash !~ '^[0-9a-f]{64}$'
    OR p_destination NOT IN ('signed-out','staff','owner') THEN
    RAISE EXCEPTION 'invalid OIDC logout transaction' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.oidc_rp_logout_transactions(state_hash,browser_binding_hash,destination,expires_at)
    VALUES(p_state_hash,p_binding_hash,p_destination,transaction_timestamp()+interval '5 minutes');
END
$function$;
ALTER FUNCTION public.create_oidc_rp_logout_transaction(text,text,text) OWNER TO vmms_identity_function_owner;
REVOKE ALL ON FUNCTION public.create_oidc_rp_logout_transaction(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_oidc_rp_logout_transaction(text,text,text) TO vmms_runtime;

CREATE FUNCTION public.cancel_oidc_rp_logout_transaction(p_state_hash text, p_binding_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  DELETE FROM public.oidc_rp_logout_transactions
  WHERE p_state_hash ~ '^[0-9a-f]{64}$' AND p_binding_hash ~ '^[0-9a-f]{64}$'
    AND state_hash=p_state_hash AND browser_binding_hash=p_binding_hash
$function$;
ALTER FUNCTION public.cancel_oidc_rp_logout_transaction(text,text) OWNER TO vmms_identity_function_owner;
REVOKE ALL ON FUNCTION public.cancel_oidc_rp_logout_transaction(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_oidc_rp_logout_transaction(text,text) TO vmms_runtime;

CREATE FUNCTION public.consume_oidc_rp_logout_transaction(p_state_hash text, p_binding_hash text)
RETURNS TABLE(destination text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  DELETE FROM public.oidc_rp_logout_transactions transaction
  WHERE p_state_hash ~ '^[0-9a-f]{64}$' AND p_binding_hash ~ '^[0-9a-f]{64}$'
    AND transaction.state_hash=p_state_hash
    AND transaction.browser_binding_hash=p_binding_hash
    AND transaction.expires_at>transaction_timestamp()
  RETURNING transaction.destination
$function$;
ALTER FUNCTION public.consume_oidc_rp_logout_transaction(text,text) OWNER TO vmms_identity_function_owner;
REVOKE ALL ON FUNCTION public.consume_oidc_rp_logout_transaction(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oidc_rp_logout_transaction(text,text) TO vmms_runtime;

CREATE FUNCTION public.expire_oidc_rp_logout_transactions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  DELETE FROM public.oidc_rp_logout_transactions
  WHERE state_hash IN (
    SELECT state_hash FROM public.oidc_rp_logout_transactions
    WHERE expires_at<=transaction_timestamp()
    ORDER BY expires_at,state_hash LIMIT 1000
  );
END
$function$;
ALTER FUNCTION public.expire_oidc_rp_logout_transactions() OWNER TO vmms_identity_function_owner;
REVOKE ALL ON FUNCTION public.expire_oidc_rp_logout_transactions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_oidc_rp_logout_transactions() TO vmms_runtime;
