import { strings } from '../../strings';
import { EmailSchema, SignInFormSchema, SignUpFormSchema } from './forms';

describe('EmailSchema', () => {
  it('trims and accepts a valid address', () => {
    const parsed = EmailSchema.safeParse('  anna@example.ru ');
    expect(parsed.success && parsed.data).toBe('anna@example.ru');
  });

  it('rejects an empty or blank address with the "required" copy', () => {
    for (const email of ['', '   ']) {
      const parsed = EmailSchema.safeParse(email);
      expect(parsed.success).toBe(false);
      expect(!parsed.success && parsed.error.issues[0].message).toBe(strings.auth.errors.emailRequired);
    }
  });

  it('rejects malformed addresses with the "invalid" copy', () => {
    for (const email of ['anna', 'anna@', '@example.ru', 'anna@example', 'a b@example.ru']) {
      const parsed = EmailSchema.safeParse(email);
      expect(parsed.success).toBe(false);
      expect(!parsed.success && parsed.error.issues[0].message).toBe(strings.auth.errors.emailInvalid);
    }
  });
});

describe('SignUpFormSchema', () => {
  const email = 'anna@example.ru';

  it('needs at least 8 characters in the password', () => {
    const short = SignUpFormSchema.safeParse({ email, password: '1234567' });
    expect(short.success).toBe(false);
    expect(!short.success && short.error.issues[0].message).toBe(strings.auth.errors.passwordTooShort);
    expect(SignUpFormSchema.safeParse({ email, password: '12345678' }).success).toBe(true);
  });

  it('does not trim the password but trims the email', () => {
    const parsed = SignUpFormSchema.safeParse({ email: ` ${email} `, password: '       a' });
    expect(parsed.success && parsed.data).toEqual({ email, password: '       a' });
  });

  it('rejects a bad email even when the password is fine', () => {
    const parsed = SignUpFormSchema.safeParse({ email: 'anna', password: '12345678' });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0].message).toBe(strings.auth.errors.emailInvalid);
  });
});

describe('SignInFormSchema', () => {
  const email = 'anna@example.ru';

  it('only needs a non-empty password', () => {
    const empty = SignInFormSchema.safeParse({ email, password: '' });
    expect(empty.success).toBe(false);
    expect(!empty.success && empty.error.issues[0].message).toBe(strings.auth.errors.passwordRequired);
    expect(SignInFormSchema.safeParse({ email, password: 'x' }).success).toBe(true);
  });

  it('needs a valid email', () => {
    expect(SignInFormSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
    expect(SignInFormSchema.safeParse({ email: 'anna@', password: 'x' }).success).toBe(false);
  });
});
