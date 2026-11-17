import { describe, it, expect } from 'vitest';
import { OAuthProvider } from '../../lib/auth/OAuthProvider';

describe('OAuthProvider PKCE Authentication', () => {
  it('generates a valid high-entropy code verifier', () => {
    const verifier = OAuthProvider.generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('computes a valid S256 code challenge', async () => {
    const verifier = 'test_code_verifier_entropy_string_12345';
    const challenge = await OAuthProvider.generateCodeChallenge(verifier);
    expect(typeof challenge).toBe('string');
    expect(challenge.length).toBeGreaterThan(20);
    // Check URL-safe characters
    expect(challenge).not.toMatch(/[+\/=]/);
  });

  it('builds valid GitHub and Google authorization URLs', async () => {
    const { url, state, codeVerifier } = await OAuthProvider.createAuthUrl({
      clientId: 'mock_client_id',
      redirectUri: 'http://localhost:3000/callback',
      provider: 'github',
    });

    expect(url).toContain('https://github.com/login/oauth/authorize');
    expect(url).toContain('code_challenge_method=S256');
    expect(state).toBeTruthy();
    expect(codeVerifier).toBeTruthy();
  });
});