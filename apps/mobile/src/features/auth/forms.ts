import { z } from 'zod';
import { strings } from '../../strings';

// Minimum length of a new password. The local Supabase config enforces the same number
// (minimum_password_length = 8), so the form never lets through what the server rejects.
export const MIN_PASSWORD_LENGTH = 8;

// Trimmed first, so "  a@b.ru " is a valid address and the trimmed value is what is sent.
export const EmailSchema = z
  .string()
  .trim()
  .min(1, strings.auth.errors.emailRequired)
  .pipe(z.email(strings.auth.errors.emailInvalid));

// Sign-up: the password is chosen here, so the length rule applies. It is NOT trimmed:
// spaces can be part of a password.
export const SignUpFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(MIN_PASSWORD_LENGTH, strings.auth.errors.passwordTooShort),
});

// Sign-in: only "not empty". Whether the password is right is the server's answer, and an
// older account may predate the current length rule.
export const SignInFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, strings.auth.errors.passwordRequired),
});

// Both forms hold exactly these two fields (trimming does not change the type).
export type CredentialsFormValues = { email: string; password: string };
