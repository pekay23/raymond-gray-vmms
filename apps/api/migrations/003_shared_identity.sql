CREATE TABLE staff_identities (
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, staff_user_id)
);

CREATE TABLE oidc_login_transactions (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text NOT NULL CHECK (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  nonce text NOT NULL CHECK (length(nonce) BETWEEN 32 AND 255),
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_login_transactions_expiry ON oidc_login_transactions(expires_at);

GRANT SELECT ON staff_identities TO vmms_runtime;
GRANT SELECT, INSERT, DELETE ON oidc_login_transactions TO vmms_runtime;
