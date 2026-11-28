import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../platform/prisma/prisma.service';
import { AuthAdminError, type AuthAdminService } from '../../../providers/auth-admin/auth-admin.service';
import { ACCOUNT_DELETION_TX_TIMEOUT_MS, AccountDeletionService } from './account-deletion.service';

// The order of the steps and the log line. What the statements delete is proven against the
// real database in account-deletion.int-spec.ts.

const USER_ID = '3f0b8a52-7c1e-4d0a-9a57-1b2c3d4e5f60';

function setup(options: { authError?: Error; commitError?: Error } = {}) {
  const steps: string[] = [];
  const jobsDeleteMany = jest.fn(async () => void steps.push('jobs'));
  const tx = {
    $queryRaw: jest.fn(async () => {
      steps.push('lock');
      return [{ id: USER_ID }];
    }),
    generationJob: { deleteMany: jobsDeleteMany },
    user: { deleteMany: jest.fn(async () => void steps.push('user')) },
  };
  // Only $transaction: a statement on the non-transaction client would throw.
  type Transaction = [work: (client: typeof tx) => Promise<void>, options: unknown];
  const transaction = jest.fn<Promise<void>, Transaction>(async (...[work]) => {
    await work(tx);
    if (options.commitError !== undefined) throw options.commitError;
    steps.push('commit');
  });
  const deleteUser = jest.fn(async () => {
    steps.push('auth');
    if (options.authError !== undefined) throw options.authError;
  });
  const service = new AccountDeletionService(
    { $transaction: transaction } as unknown as PrismaService,
    { deleteUser } as unknown as AuthAdminService,
  );
  return { service, steps, transaction, jobsDeleteMany, deleteUser };
}

describe('AccountDeletionService', () => {
  let logged: jest.SpyInstance;
  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('locks first, deletes jobs then the user, calls auth, and commits last', async () => {
    const t = setup();
    await t.service.deleteAccount(USER_ID);
    expect(t.steps).toEqual(['lock', 'jobs', 'user', 'auth', 'commit']);
    expect(t.transaction.mock.calls[0][1]).toEqual({ timeout: ACCOUNT_DELETION_TX_TIMEOUT_MS });
    expect(t.jobsDeleteMany).toHaveBeenCalledWith({
      where: { requestedByUserId: USER_ID, status: { not: 'failed' } },
    });
    expect(t.deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(logged).not.toHaveBeenCalled();
  });

  it('does not commit and logs nothing when the auth call fails', async () => {
    const t = setup({ authError: new AuthAdminError() });
    await expect(t.service.deleteAccount(USER_ID)).rejects.toBeInstanceOf(AuthAdminError);
    expect(t.steps).not.toContain('commit');
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs one fixed line with the user id only when the commit fails after auth', async () => {
    const failure = new Error('commit text with person@example.test');
    const t = setup({ commitError: failure });
    await expect(t.service.deleteAccount(USER_ID)).rejects.toBe(failure);
    expect(logged.mock.calls).toEqual([
      [`Account deletion did not commit after the sign-in record was deleted; user id ${USER_ID}`],
    ]);
  });
});
