import { STORY_TEXT_MAX_CHARS, STORY_TEXT_MIN_CHARS, StoryTextSchema } from './story';

describe('StoryTextSchema', () => {
  it('accepts a text at both bounds', () => {
    expect(StoryTextSchema.safeParse('а'.repeat(STORY_TEXT_MIN_CHARS)).success).toBe(true);
    expect(StoryTextSchema.safeParse('а'.repeat(STORY_TEXT_MAX_CHARS)).success).toBe(true);
  });

  it('rejects 499 and 10001 characters', () => {
    expect(StoryTextSchema.safeParse('а'.repeat(499)).success).toBe(false);
    expect(StoryTextSchema.safeParse('а'.repeat(10_001)).success).toBe(false);
  });

  it('trims surrounding whitespace before checking the bounds', () => {
    const body = 'а'.repeat(STORY_TEXT_MIN_CHARS);
    expect(StoryTextSchema.parse(`\n  ${body}  \n`)).toBe(body);
    expect(StoryTextSchema.safeParse(`${'а'.repeat(499)}${' '.repeat(50)}`).success).toBe(false);
  });

  it('rejects an empty or non-string value', () => {
    expect(StoryTextSchema.safeParse('').success).toBe(false);
    expect(StoryTextSchema.safeParse(null).success).toBe(false);
  });

  it('does not enforce the 3000 to 3500 range the prompt asks for', () => {
    expect(StoryTextSchema.safeParse('а'.repeat(800)).success).toBe(true);
    expect(StoryTextSchema.safeParse('а'.repeat(9000)).success).toBe(true);
  });
});
