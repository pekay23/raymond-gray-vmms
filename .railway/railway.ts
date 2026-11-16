import { defineRailway, github, project, preserve, service } from "railway/iac";

export default defineRailway(() => {
  const api = service("@vmms/api", {
    source: github("pekay23/raymond-gray-vmms", {
      branch: "main",
      rootDirectory: "apps/api",
    }),
    build: {
      builder: "dockerfile",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      startCommand: "", // Use Dockerfile's CMD
      healthcheckPath: "/api/v1/health",
      healthcheckTimeout: 10000,
      restartPolicyType: "on_failure",
      restartPolicyMaxRetries: 10,
      numReplicas: 1,
    },
    variables: {
      NODE_ENV: "staging",
      PORT: "4100",
      HOST: "0.0.0.0",
      DATABASE_URL: preserve(),
      MIGRATION_DATABASE_URL: preserve(),
      SESSION_SECRET: preserve(),
      OIDC_ISSUER: preserve(),
      OIDC_CLIENT_ID: preserve(),
      OIDC_CLIENT_SECRET: preserve(),
      OIDC_CALLBACK_URL: preserve(),
      OIDC_LOGOUT_CALLBACK_URL: preserve(),
      VMMS_EVIDENCE_S3_ENDPOINT: preserve(),
      VMMS_EVIDENCE_S3_BUCKET: preserve(),
      VMMS_EVIDENCE_S3_REGION: preserve(),
      VMMS_EVIDENCE_S3_ACCESS_KEY_ID: preserve(),
      VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY: preserve(),
      VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID: preserve(),
      VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY: preserve(),
      VMMS_EVIDENCE_CLAMAV_HOST: preserve(),
      VMMS_EVIDENCE_CLAMAV_PORT: preserve(),
      TRUSTED_PROXY_CIDRS: preserve(),
      WEB_ORIGIN: preserve(),
    },
  });

  const web = service("@vmms/web", {
    source: github("pekay23/raymond-gray-vmms", {
      branch: "main",
      rootDirectory: "apps/web",
    }),
    build: {
      builder: "dockerfile",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      startCommand: "", // Use Dockerfile's CMD
      healthcheckPath: "/",
      healthcheckTimeout: 10000,
      restartPolicyType: "on_failure",
      restartPolicyMaxRetries: 10,
      numReplicas: 1,
    },
    variables: {
      NODE_ENV: "staging",
      PORT: "8080",
      HOST: "0.0.0.0",
      WEB_ORIGIN: "https://vmmsweb-production.up.railway.app",
      API_ORIGIN: "https://vmmsapi-production.up.railway.app",
    },
  });

  return project("raymond-gray-vmms", {
    resources: [api, web],
  });
});