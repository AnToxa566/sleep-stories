import { Injectable, Logger } from '@nestjs/common';
import { lockUserRow } from '../../../platform/prisma/lock-user-row/lock-user-row';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { AuthAdminService } from '../../../providers/auth-admin/auth-admin.service';

// Longer than the auth call's own timeout (AUTH_ADMIN_TIMEOUT_MS, 10 s), with room for the
// wait on the lock and the deletes. Prisma's default of 5 s is shorter than the call.
export const ACCOUNT_DELETION_TX_TIMEOUT_MS = 20_000;

// Deletes one person's account (ARCHITECTURE.md section 5, "Deleting an account").
// IRREVERSIBLE.
//
// What is KEPT (owner, 2026-11-28):
// - Topics, stories and audio, those grown from the person's typed interests included.
//   No content has an owner. A topic written from typed interests has a NULL
//   `interest_id` (suggest-topics.handler.ts), the pool finders never match NULL, and the
//   other way in is the viewer's OWN `user_topics` row (topic-candidates.ts). The person's
//   rows go with them, so nobody is offered such a topic.
//   WARNING (SECURITY.md rule 10; ARCHITECTURE.md section 11, item 15): this does NOT cover
//   a `requested` topic. What keeps such a topic from everyone else is its author's
//   `user_topics` row with that reason, and the cascade below removes it. No code writes
//   that reason today. Whoever builds the typed-topic field MUST first make sure such a
//   topic stays unreachable after its author's account is deleted.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authAdmin: AuthAdminService,
  ) {}

  // `userId` must come from the verified token (CurrentUserId). Safe to repeat: with no
  // `users` row nothing is locked or matched, and a sign-in record that is already gone
  // counts as deleted.
  //
  // One transaction with the auth call inside it and the commit last. If the call fails,
  // everything rolls back and nothing has changed. Cost: one pool connection and the
  // person's row lock are held while the auth server answers (at most 10 s).
  async deleteAccount(userId: string): Promise<void> {
    let signInDeleted = false;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // First, before any other row lock: the order of `lockUserRow`. From here on, no
          // start, top-up or handler can add a job or a row for this person.
          await lockUserRow(tx, userId);

          // All of the person's jobs EXCEPT the `failed` ones. Pending and running ones go
          // too, so no further stage starts (a run in progress then fails its fence).
          // WHY NOT SIMPLY DELETE ALL: a finally failed `write_story` or `render_audio` row
          // is what keeps a broken topic (or a story in one voice) from being offered again
          // to ANYONE (owner, 2026-10-30; `findWithoutAudio` and `topicFilters` in
          // topic-candidates.ts look it up by dedupe key). Deleting it would undo that.
          // A kept row names nobody: the user deletion below sets `requested_by_user_id`
          // to NULL, and a payload holds only ids and counts, never typed text.
          // This must run BEFORE the user is deleted: afterwards the rows cannot be found.
          await tx.generationJob.deleteMany({
            where: { requestedByUserId: userId, status: { not: 'failed' } },
          });

          // The cascade removes preferences, interests, typed interests, user_topics,
          // queue_items, listens and story_ratings. deleteMany: no row is not an error.
          await tx.user.deleteMany({ where: { id: userId } });

          // The one step that cannot be rolled back, so it is the last one before the commit.
          await this.authAdmin.deleteUser(userId);
          signInDeleted = true;
        },
        { timeout: ACCOUNT_DELETION_TX_TIMEOUT_MS },
      );
    } catch (error) {
      if (signInDeleted) {
        // The person cannot sign in again but their rows are still here. A repeat while
        // their token lives finishes the job; after that the owner cleans up by this id.
        // The id is an opaque uuid; nothing else is logged (SECURITY.md rule 9).
        this.logger.error(
          `Account deletion did not commit after the sign-in record was deleted; user id ${userId}`,
        );
      }
      throw error;
    }
  }
}
