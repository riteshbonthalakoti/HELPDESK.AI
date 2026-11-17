/**
 * @file OAuthProvider.ts
 * @description OAuth 2.0 Authorization Code Flow with PKCE (RFC 7636) for GitHub and Google SSO.
 */

export interface OAuthProviderConfig {
  clientId: string;
  redirectUri: string;
  provider: 'github' | 'google';
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  provider: 'github' | 'google';
}

export class OAuthProvider {
  private static GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
  private static GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  /**
   * Generates a high-entropy code_verifier (43-128 unreserved characters) using crypto.getRandomValues.
   */
  public static generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
  }

  /**
   * Computes the code_challenge using SHA-256 with URL-safe Base64 encoding (S256).
   */
  public static async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    
    const bytes = new Uint8Array(digest);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Generates an anti-CSRF state parameter and returns the authorization redirect URL.
   */
  public static async createAuthUrl(config: OAuthProviderConfig): Promise<{ url: string; state: string; codeVerifier: string }> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
    const stateArray = new Uint8Array(16);
    crypto.getRandomValues(stateArray);
    const state = Array.from(stateArray, (b) => ('0' + b.toString(16)).slice(-2)).join('');

    const baseUrl = config.provider === 'github' ? this.GITHUB_AUTH_URL : this.GOOGLE_AUTH_URL;
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (config.provider === 'github') {
      params.append('scope', 'user:email read:user');
    } else {
      params.append('scope', 'openid profile email');
    }

    return {
      url: `${baseUrl}?${params.toString()}`,
      state,
      codeVerifier,
    };
  }
}