import type { GenerateTextInput, GenerateTextResult } from '../providers/llm/llm.provider';
import { LlmProvider } from '../providers/llm/llm.provider';
import { GenerationError } from './generation-error';
import { STORY_PROMPT_VERSION } from './prompts/story.prompt';
import { StoryWriterService } from './story-writer.service';

function fakeLlm(reply: Partial<GenerateTextResult>) {
  const calls: GenerateTextInput[] = [];
  const llm = {
    generateText: async (input: GenerateTextInput): Promise<GenerateTextResult> => {
      calls.push(input);
      return { text: '', model: 'fake-model', truncated: false, ...reply };
    },
    generateStructured: async () => {
      throw new Error('not used');
    },
  } as unknown as LlmProvider;
  return { llm, calls };
}

// Distinct marker so a leak into an error message is detectable.
const MARKER = 'zxqv-marker';
const textOf = (length: number) => (MARKER + ' а').padEnd(length, 'а');
const write = (llm: LlmProvider) =>
  new StoryWriterService(llm).write({ style: 'fairy_tale', topicTitle: 'Маяк' });

describe('StoryWriterService', () => {
  it('returns the trimmed text with the model id and the prompt version', async () => {
    const { llm, calls } = fakeLlm({ text: `  \n${textOf(800)}\n  ` });
    const result = await write(llm);
    expect(result.text).toBe(textOf(800));
    expect(result.model).toBe('fake-model');
    expect(result.promptVersion).toBe(STORY_PROMPT_VERSION);
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain('Маяк');
    expect(calls[0].user).toContain('fairy_tale');
  });

  it('does not check the 3000 to 3500 range: 800 and 9000 characters pass', async () => {
    await expect(write(fakeLlm({ text: textOf(800) }).llm)).resolves.toBeDefined();
    await expect(write(fakeLlm({ text: textOf(9000) }).llm)).resolves.toBeDefined();
  });

  it('accepts exactly 500 and exactly 10 000 characters', async () => {
    await expect(write(fakeLlm({ text: textOf(500) }).llm)).resolves.toBeDefined();
    await expect(write(fakeLlm({ text: textOf(10_000) }).llm)).resolves.toBeDefined();
  });

  it('rejects 499 and 10 001 characters', async () => {
    for (const length of [499, 10_001]) {
      await expect(write(fakeLlm({ text: textOf(length) }).llm)).rejects.toMatchObject({
        code: 'story_text_invalid',
        retryable: true,
      });
    }
  });

  it('counts the length after trimming', async () => {
    const padded = `   ${textOf(499)}   `;
    await expect(write(fakeLlm({ text: padded }).llm)).rejects.toMatchObject({
      code: 'story_text_invalid',
    });
  });

  it('rejects an empty reply', async () => {
    await expect(write(fakeLlm({ text: '   ' }).llm)).rejects.toBeInstanceOf(GenerationError);
  });

  it('treats a reply cut off by the token limit as a retryable error, even if long enough', async () => {
    await expect(write(fakeLlm({ text: textOf(2000), truncated: true }).llm)).rejects.toMatchObject({
      code: 'story_truncated',
      retryable: true,
    });
  });

  it('never puts the story text into an error message', async () => {
    for (const reply of [
      { text: textOf(2000), truncated: true },
      { text: textOf(10_001) },
      { text: textOf(499) },
    ]) {
      const error = await write(fakeLlm(reply).llm).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(MARKER);
      expect(JSON.stringify(error)).not.toContain(MARKER);
    }
  });
});
