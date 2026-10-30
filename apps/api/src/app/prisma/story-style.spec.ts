import { StoryStyleSchema } from '@sleep-stories/contracts';
import { StoryStyle } from '../../generated/prisma/enums';

// packages/contracts cannot import the generated Prisma client, so this spec
// guards the copy of the enum that lives there.
describe('StoryStyle', () => {
  it('matches between the Prisma enum and StoryStyleSchema', () => {
    expect([...StoryStyleSchema.options].sort()).toEqual(Object.values(StoryStyle).sort());
  });
});
