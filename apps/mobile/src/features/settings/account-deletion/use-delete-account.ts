import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '../../../api/http/api-fetch';
import { signOutEverywhere } from '../../auth/session/session-store';

// A 204 has no body, so there is no schema for it in contracts: the client reads an empty body
// as null.
const NoContentSchema = z.null();

// DELETE /me: removes the account for good. No request body: the person is the one in the
// token, and the typed address stays in the sheet (email-confirmation.ts). Never retried by
// itself: only the person's tap sends it. A repeat after a success answers 204 too, so
// pressing again after a lost answer is safe.
//
// After the 204 the only step is the sign-out. Nothing here may read or invalidate a query:
// the token stays valid for a while after the account is gone, and GET /me would then create
// an empty `users` row again (ARCHITECTURE.md section 5, "Deleting an account"). The query
// cache is cleared by the sign-out cleanups of the root layout. Cancelling the queries first
// would not help: it aborts no sent request and does not stop a later one.
//
// `onSuccess` is in the hook's own options, so the sign-out runs even if the sheet is gone by
// then. Its promise is returned, so the mutation stays pending until the sign-out is done.
export function useDeleteAccount() {
  return useMutation<null, Error, void>({
    mutationFn: () =>
      apiFetch({ method: 'DELETE', path: '/me', responseSchema: NoContentSchema }),
    retry: false,
    onSuccess: () => signOutEverywhere(),
  });
}
