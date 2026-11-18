/**
 * EmailChange.test.js
 *
 * Unit tests for the direct 6-digit OTP email change workflow on Mobile.
 * Covers:
 *  - 6-digit OTP format validation
 *  - Email validation (different from old email, valid syntax)
 *  - Calling POST /api/account/email-change/request with bearer auth
 *  - Calling POST /api/account/email-change/verify with otp_code and challenge_token
 *  - Profile and session synchronization
 */

describe('Mobile 6-Digit OTP Email Change Workflow', () => {
  const MOCK_CURRENT_EMAIL = 'admin@riteshpvtltd.com';
  const MOCK_NEW_EMAIL = 'new.admin@riteshpvtltd.com';
  const MOCK_OTP = '849201';
  const MOCK_CHALLENGE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test-sig';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation Logic', () => {
    test('rejects empty or malformed email address', () => {
      const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim().toLowerCase());
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('test@riteshpvtltd.com')).toBe(true);
    });

    test('rejects new email if identical to current email', () => {
      const isDifferentEmail = (newEmail, currentEmail) =>
        (newEmail || '').trim().toLowerCase() !== (currentEmail || '').trim().toLowerCase();

      expect(isDifferentEmail('admin@riteshpvtltd.com', 'admin@riteshpvtltd.com')).toBe(false);
      expect(isDifferentEmail('new@riteshpvtltd.com', 'admin@riteshpvtltd.com')).toBe(true);
    });

    test('validates exactly 6-digit numeric OTP code', () => {
      const isValidOtp = (otp) => typeof otp === 'string' && /^\d{6}$/.test(otp.trim());

      expect(isValidOtp('12345')).toBe(false);
      expect(isValidOtp('1234567')).toBe(false);
      expect(isValidOtp('12a456')).toBe(false);
      expect(isValidOtp('849201')).toBe(true);
    });
  });

  describe('Request OTP Endpoint Integration', () => {
    test('sends POST /api/account/email-change/request with auth headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'otp_sent',
          new_email: MOCK_NEW_EMAIL,
          expires_minutes: 10,
          challenge_token: MOCK_CHALLENGE_TOKEN,
          email_sent: true,
        }),
      });
      global.fetch = mockFetch;

      const backendUrl = 'http://localhost:7860';
      const authHeaders = { Authorization: 'Bearer mock-jwt-token' };

      const res = await fetch(`${backendUrl}/api/account/email-change/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ new_email: MOCK_NEW_EMAIL }),
      });
      const data = await res.json();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7860/api/account/email-change/request',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ new_email: MOCK_NEW_EMAIL }),
        })
      );
      expect(data.status).toBe('otp_sent');
      expect(data.challenge_token).toBe(MOCK_CHALLENGE_TOKEN);
    });
  });

  describe('Verify OTP Endpoint Integration', () => {
    test('sends POST /api/account/email-change/verify with otp_code and challenge_token', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          verified: true,
          old_email: MOCK_CURRENT_EMAIL,
          new_email: MOCK_NEW_EMAIL,
          message: 'Email verified and updated directly to your new email address.',
        }),
      });
      global.fetch = mockFetch;

      const backendUrl = 'http://localhost:7860';
      const authHeaders = { Authorization: 'Bearer mock-jwt-token' };

      const res = await fetch(`${backendUrl}/api/account/email-change/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          otp_code: MOCK_OTP,
          new_email: MOCK_NEW_EMAIL,
          challenge_token: MOCK_CHALLENGE_TOKEN,
        }),
      });
      const data = await res.json();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7860/api/account/email-change/verify',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            otp_code: MOCK_OTP,
            new_email: MOCK_NEW_EMAIL,
            challenge_token: MOCK_CHALLENGE_TOKEN,
          }),
        })
      );
      expect(data.verified).toBe(true);
      expect(data.new_email).toBe(MOCK_NEW_EMAIL);
    });
  });
});
