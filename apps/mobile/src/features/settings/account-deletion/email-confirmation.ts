// The gate of «Удалить навсегда»: the person types the address of the account. It guards
// against an accidental tap and nothing else. The proof of who is asking is the token, so what
// is typed never leaves the sheet: it is not sent and not logged (owner, 2026-11-28).
// Case and outer spaces are ignored, because a phone keyboard adds both by itself. With no
// known address nothing matches, so an empty field can never confirm.
export function emailConfirms(typed: string, email: string | null): boolean {
  const expected = email?.trim().toLowerCase() ?? '';
  return expected !== '' && typed.trim().toLowerCase() === expected;
}
