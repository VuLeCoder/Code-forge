# Auth security slice — 2026-10-27

## Verified baseline

- Registration currently creates an active account and session immediately.
- There is no email-verification challenge, mail adapter, TOTP/WebAuthn credential, recovery code, or security-settings API.
- Existing controls that remain in place: Argon2id password hashing, normalized username/email uniqueness, HttpOnly cookies, exact Origin checks, IP throttling, refresh rotation/reuse detection and session revocation.
- Email verification and 2FA are intentionally outside the original MVP scope; this document records the next opt-in slice rather than claiming they exist.

## Implemented in this slice

- Login now verifies a fixed, never-valid Argon2id dummy hash when the identifier does not exist, reducing the username/email timing distinction.
- New registration passwords must contain 8–128 characters, at least one letter and one digit. Existing passwords are not changed by this policy.
- The registration hint is associated with the password input; native confirmation validation remains unchanged so the existing flow is preserved.

## Email verification contract (not yet implemented)

1. Add `emailVerifiedAt` and a single-use, hashed challenge record with purpose, expiry, attempt count and consumed timestamp.
2. Add an explicit mail-provider adapter. Local tests use a fake provider; production requires configured SMTP/API credentials and must never return raw tokens in API responses or logs.
3. `POST /auth/register` must return a typed verification-pending response without an authenticated cookie when enforcement is enabled.
4. Add confirm/resend endpoints with account/IP throttling, generic responses and atomic consume-once behavior.
5. Decide whether unverified users may log in for public browsing only or are fully blocked; do not silently change the current contract.

## Two-factor contract (not yet implemented)

1. Start with TOTP for `ADMIN` accounts; store the secret encrypted with a dedicated environment key and store recovery codes only as hashes.
2. Login returns a typed `TWO_FACTOR_REQUIRED` challenge and does not issue session cookies until the code is verified.
3. Setup and disable require an authenticated session plus recent password re-authentication; setup returns the secret/otpauth URI only once.
4. Challenge expiry, attempt limits, replay protection, clock-skew window and single-use recovery codes require backend tests before UI work.
5. Add an account-security page with keyboard-safe code input, accessible errors, resend/countdown states and mobile checks.

## Acceptance gates

- Backend tests cover unknown-user timing path, expired/consumed/wrong verification challenges, resend throttling, TOTP replay/expiry, setup/disable re-authentication and secret non-leakage.
- Browser tests cover registration → verification, login → 2FA, refresh/session behavior, focus handling and 320/375px layouts.
- Real provider delivery, spam-folder behavior, DKIM/SPF/DMARC and authenticator-device compatibility remain cloud/manual checks; local tests cannot prove them.

No mail provider, credential, raw verification token or 2FA secret is stored in this repository.
