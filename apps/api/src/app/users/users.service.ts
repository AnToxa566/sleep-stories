import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Creates the users row for an authenticated user the first time we see them.
  // One INSERT ... ON CONFLICT DO NOTHING (createMany with skipDuplicates), so two
  // concurrent first requests cannot fail with a unique violation, and an existing
  // row is not touched.
  //
  // Why lazily here and not a trigger on auth.users: that would couple our schema
  // to Supabase's auth schema (AGENTS.md architecture rule 3), and `users.id` has
  // no foreign key into auth. The cost is one cheap statement per request that
  // needs the row.
  //
  // `userId` must come from the verified token (CurrentUserId), never from the
  // request body. Pass the transaction client to run inside a transaction.
  async ensureExists(userId: string, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    await db.user.createMany({ data: [{ id: userId }], skipDuplicates: true });
  }
}
