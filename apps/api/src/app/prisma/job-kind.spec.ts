import { JobKindSchema } from '@sleep-stories/contracts';
import { JobKind } from '../../generated/prisma/enums';

// packages/contracts cannot import the generated Prisma client, so this spec
// guards the copy of the enum that lives there.
describe('JobKind', () => {
  it('matches between the Prisma enum and JobKindSchema', () => {
    expect([...JobKindSchema.options].sort()).toEqual(Object.values(JobKind).sort());
  });
});
