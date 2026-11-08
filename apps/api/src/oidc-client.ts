import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  randomNonce,
} from 'openid-client';
import { z } from 'zod';
import type { Config } from './config.js';

const subjectClaims = z.object({ iss: z.string().url(), sub: z.string().min(1).max(255) });

export type AuthorizationParameters = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

export type VerifiedSubject = { issuer: string; subject: string };

export interface OidcProvider {
  createAuthorizationUrl(input: AuthorizationParameters): Promise<URL>;
  exchangeAuthorizationCode(input: AuthorizationParameters & { callbackUrl: URL }): Promise<VerifiedSubject>;
}

export class OidcClient implements OidcProvider {
  private clientConfiguration: ReturnType<typeof discovery> | undefined;
  private readonly clientSecret: string;

  constructor(private readonly config: Config) {
    const secret = config.OIDC_CLIENT_SECRET;
    if (!secret) throw new Error('OIDC client secret is required outside isolated tests.');
    this.clientSecret = secret;
  }

  async createAuthorizationUrl(input: AuthorizationParameters): Promise<URL> {
    const client = await this.configuration();
    const challenge = await calculatePKCECodeChallenge(input.codeVerifier);
    return buildAuthorizationUrl(client, {
      redirect_uri: this.config.OIDC_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid profile email',
      state: input.state,
      nonce: input.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  }

  async exchangeAuthorizationCode(input: AuthorizationParameters & { callbackUrl: URL }): Promise<VerifiedSubject> {
    const client = await this.configuration();
    const tokens = await authorizationCodeGrant(client, input.callbackUrl, {
      expectedState: input.state,
      expectedNonce: input.nonce,
      pkceCodeVerifier: input.codeVerifier,
    });
    const claims = subjectClaims.parse(tokens.claims());
    if (claims.iss !== this.config.OIDC_ISSUER) throw new Error('The identity issuer did not match the configured issuer.');
    return { issuer: claims.iss, subject: claims.sub };
  }

  private async configuration() {
    if (!this.clientConfiguration) {
      const discoveryRequest = discovery(
        new URL(this.config.OIDC_ISSUER),
        this.config.OIDC_CLIENT_ID,
        this.clientSecret,
        undefined,
        { execute: new URL(this.config.OIDC_ISSUER).protocol==='http:'?[allowInsecureRequests]:[] },
      );
      this.clientConfiguration = discoveryRequest;
      try {
        return await discoveryRequest;
      } catch (error) {
        if (this.clientConfiguration === discoveryRequest) this.clientConfiguration = undefined;
        throw error;
      }
    }
    return this.clientConfiguration;
  }
}

export function newAuthorizationParameters(): AuthorizationParameters {
  return {
    state: randomState(),
    nonce: randomNonce(),
    codeVerifier: randomPKCECodeVerifier(),
  };
}
