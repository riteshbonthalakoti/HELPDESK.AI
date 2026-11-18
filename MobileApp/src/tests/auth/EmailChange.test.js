/**
 * EmailChange.test.js
 *
 * Unit tests for the direct 6-digit OTP email change workflow on Mobile.
 * Exercises production operations extracted from the email change workflow.
 * Covers:
 *  - 6-digit OTP format validation
 *  - Email validation (different from old email, valid syntax)
 *  - Calling POST /api/account/email-change/request with bearer auth
 *  - Calling POST /api/account/email-change/verify with otp_code and challenge_token
 *  - Profile and session synchronization
 *  - Parent onSuccess callback notification
 */

import {
  validateEmailInput,
  validateOtpCode,
  requestEmailChangeOtp,
  verifyEmailChangeOtp,
} from '../../lib/emailChangeOperations';

describe('Mobile 6-Digit OTP Email Change Workflow', () => {
  const MOCK_CURRENT_EMAIL = 'admin@riteshpvtltd.com';
  const MOCK_NEW_EMAIL = 'new.admin@riteshpvtltd.com';
  const MOCK_OTP = '849201';
  const MOCK_CHALLENGE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test-sig';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation Operations', () => {
    test('rejects empty or malformed email address using production validator', () => {
      expect(validateEmailInput('', MOCK_CURRENT_EMAIL).valid).toBe(false);
      expect(validateEmailInput('not-an-email', MOCK_CURRENT_EMAIL).valid).toBe(false);
      expect(validateEmailInput('test@', MOCK_CURRENT_EMAIL).valid).toBe(false);
      expect(validateEmailInput('admin@gmail.com', MOCK_CURRENT_EMAIL).valid).toBe(true);
    });

    test('rejects new email if identical to current email (case-insensitive)', () => {
      expect(validateEmailInput('admin@riteshpvtltd.com', 'admin@riteshpvtltd.com').valid).toBe(false);
      expect(validateEmailInput('ADMIN@RITESHPVTLTD.COM', 'admin@riteshpvtltd.com').valid).toBe(false);
      expect(validateEmailInput(MOCK_NEW_EMAIL, MOCK_CURRENT_EMAIL).valid).toBe(true);
    });

    test('validates exactly 6-digit numeric OTP code for single string and digit arrays', () => {
      expect(validateOtpCode('12345').valid).toBe(false);
      expect(validateOtpCode('1234567').valid).toBe(false);
      expect(validateOtpCode('12a456').valid).toBe(false);
      expect(validateOtpCode(['8', '4', '9', '2', '0']).valid).toBe(false);
      expect(validateOtpCode(['8', '4', '9', '2', '0', '1']).valid).toBe(true);
      expect(validateOtpCode('849201').valid).toBe(true);
    });
  });

  describe('Request OTP Endpoint Workflow', () => {
    test('executes production requestEmailChangeOtp with auth headers and correct payload', async () => {
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

      const mockGetHeaders = jest.fn().mockResolvedValue({
        Authorization: 'Bearer mock-jwt-token',
      });

      const data = await requestEmailChangeOtp({
        newEmail: MOCK_NEW_EMAIL,
        backendUrl: 'http://localhost:7860',
        getHeaders: mockGetHeaders,
        fetchFn: mockFetch,
      });

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

    test('throws friendly error on rejected request OTP response', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: 'Rate limit exceeded: please wait 5 minutes.' }),
      });

      await expect(
        requestEmailChangeOtp({
          newEmail: MOCK_NEW_EMAIL,
          backendUrl: 'http://localhost:7860',
          getHeaders: async () => ({ Authorization: 'Bearer mock' }),
          fetchFn: mockFetch,
        })
      ).rejects.toThrow('Rate limit exceeded: please wait 5 minutes.');
    });
  });

  describe('Verify OTP Endpoint Workflow & Profile Sync', () => {
    test('executes production verifyEmailChangeOtp with payload, profile sync, and parent callback', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          verified: true,
          old_email: MOCK_CURRENT_EMAIL,
          new_email: MOCK_NEW_EMAIL,
          message: 'Email verified and updated directly to your new email address.',
        }),
      });

      const mockRefreshSession = jest.fn().mockResolvedValue({});
      const mockUpdate = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      });
      const mockSupabase = {
        auth: {
          refreshSession: mockRefreshSession,
          getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'usr-456' } } }),
        },
        from: jest.fn().mockReturnValue({
          update: mockUpdate,
        }),
      };

      const onSuccess = jest.fn();

      const data = await verifyEmailChangeOtp({
        otpCode: MOCK_OTP,
        newEmail: MOCK_NEW_EMAIL,
        challengeToken: MOCK_CHALLENGE_TOKEN,
        backendUrl: 'http://localhost:7860',
        getHeaders: async () => ({ Authorization: 'Bearer mock-jwt-token' }),
        fetchFn: mockFetch,
        supabaseClient: mockSupabase,
        onSuccess,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7860/api/account/email-change/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            otp_code: MOCK_OTP,
            new_email: MOCK_NEW_EMAIL,
            challenge_token: MOCK_CHALLENGE_TOKEN,
          }),
        })
      );
      expect(data.verified).toBe(true);
      expect(mockRefreshSession).toHaveBeenCalled();
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
      expect(onSuccess).toHaveBeenCalledWith(MOCK_NEW_EMAIL);
    });

    test('recovers gracefully if supabase profile update throws, still completing verification', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ verified: true, new_email: MOCK_NEW_EMAIL }),
      });

      const mockSupabase = {
        auth: {
          refreshSession: jest.fn().mockRejectedValue(new Error('Network offline')),
          getUser: jest.fn().mockRejectedValue(new Error('Auth failed')),
        },
      };

      const onSuccess = jest.fn();

      const data = await verifyEmailChangeOtp({
        otpCode: MOCK_OTP,
        newEmail: MOCK_NEW_EMAIL,
        challengeToken: MOCK_CHALLENGE_TOKEN,
        backendUrl: 'http://localhost:7860',
        getHeaders: async () => ({ Authorization: 'Bearer mock-jwt-token' }),
        fetchFn: mockFetch,
        supabaseClient: mockSupabase,
        onSuccess,
      });

      expect(data.verified).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith(MOCK_NEW_EMAIL);
    });
  });
});
