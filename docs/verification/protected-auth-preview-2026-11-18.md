
## Latest hosted VMMS OIDC integration attempt

A new protected Preview deployment is READY at `https://raymond-gray-auth-c7i8fdzx5-pekay23s-projects.vercel.app` (`dpl_A72d652kXrLo34c6HPRWjRuPUfLL`). It remains on the existing auth Vercel project, has no production target or aliases, and is protected by Vercel Authentication. Only the curated `.preview-upload` runtime allowlist was deployed; the synthetic local env file was excluded.

The disposable `.test` account completed password sign-in and MFA and reached the consent page. Consent details still receive HTTP 400 from the signature-verification endpoint after both the provider metadata allowlist and full-query verification were tried. The account-link and full authorization-code/token-exchange sequence therefore remain unverified on this deployment. The verifier continues to deny the request; no bypass was introduced. The deployed preview is usable for owner sign-in/MFA/account UI checks, but it is not yet a completed VMMS OIDC integration test.

Latest VMMS preview issuer is `https://raymond-gray-auth-c7i8fdzx5-pekay23s-projects.vercel.app/api/auth`; local ignored configuration was updated without exposing credentials. Production Keycloak, DNS and production domains remain unchanged. Google callback registration is still required for a real Google round-trip.
