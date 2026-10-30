import type { SuggestedTopics } from '@sleep-stories/contracts';
import type { GenerateStructuredInput, GenerateStructuredResult } from '../providers/llm/llm.provider';
import { LlmProvider } from '../providers/llm/llm.provider';
import { GenerationError } from './generation-error';
import { TOPICS_PROMPT_VERSION } from './prompts/topics.prompt';
import { TopicSuggesterService } from './topic-suggester.service';

const SECRET_TITLE = 'secret-title-7c2e';

function fakeLlm(reply: SuggestedTopics) {
  const calls: GenerateStructuredInput<never>[] = [];
  const llm = {
    generateStructured: async (input: GenerateStructuredInput<never>) => {
      calls.push(input);
      return { value: reply, model: 'fake-model' } as unknown as GenerateStructuredResult<never>;
    },
    generateText: async () => {
      throw new Error('not used');
    },
  } as unknown as LlmProvider;
  return { llm, calls };
}

const input = {
  styles: ['fairy_tale', 'facts'] as const,
  interests: [
    { slug: 'sea', title: 'Море' },
    { slug: 'forest', title: 'Лес' },
  ],
  customInterests: [],
  existingTopics: [{ title: 'Тихий Маяк', style: 'fairy_tale' as const }],
};

describe('TopicSuggesterService', () => {
  it('returns the topics with the model id and the prompt version', async () => {
    const { llm, calls } = fakeLlm({
      topics: [{ title: 'Ночной лес', style: 'fairy_tale', interest: 'forest' }],
    });
    const result = await new TopicSuggesterService(llm).suggest(input);
    expect(result).toEqual({
      topics: [{ title: 'Ночной лес', style: 'fairy_tale', interest: 'forest' }],
      model: 'fake-model',
      promptVersion: TOPICS_PROMPT_VERSION,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain('sea: Море');
  });

  it('drops a topic whose style was not requested', async () => {
    const { llm } = fakeLlm({
      topics: [
        { title: 'Старая крепость', style: 'history', interest: null },
        { title: 'Лунная река', style: 'facts', interest: null },
      ],
    });
    const { topics } = await new TopicSuggesterService(llm).suggest(input);
    expect(topics.map((t) => t.title)).toEqual(['Лунная река']);
  });

  it('drops a topic whose interest slug was not offered, and keeps a null interest', async () => {
    const { llm } = fakeLlm({
      topics: [
        { title: 'Горная тропа', style: 'facts', interest: 'mountains' },
        { title: 'Ручей', style: 'facts', interest: 'sea' },
        { title: 'Туман', style: 'facts', interest: null },
      ],
    });
    const { topics } = await new TopicSuggesterService(llm).suggest(input);
    expect(topics.map((t) => t.title)).toEqual(['Ручей', 'Туман']);
  });

  it('drops case-insensitive duplicates inside the batch and keeps the first', async () => {
    const { llm } = fakeLlm({
      topics: [
        { title: 'Лунная Река', style: 'facts', interest: null },
        { title: 'лунная  река', style: 'fairy_tale', interest: null },
        { title: 'Другая тема', style: 'facts', interest: null },
      ],
    });
    const { topics } = await new TopicSuggesterService(llm).suggest(input);
    expect(topics.map((t) => t.title)).toEqual(['Лунная Река', 'Другая тема']);
  });

  it('drops a topic already offered to this person, ignoring case', async () => {
    const { llm } = fakeLlm({
      topics: [
        { title: 'ТИХИЙ МАЯК', style: 'fairy_tale', interest: null },
        { title: 'Новый маяк', style: 'fairy_tale', interest: null },
      ],
    });
    const { topics } = await new TopicSuggesterService(llm).suggest(input);
    expect(topics.map((t) => t.title)).toEqual(['Новый маяк']);
  });

  it('throws a retryable error with a fixed message when nothing valid is left', async () => {
    const { llm } = fakeLlm({
      topics: [{ title: SECRET_TITLE, style: 'history', interest: null }],
    });
    const error = await new TopicSuggesterService(llm).suggest(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationError);
    expect((error as GenerationError).retryable).toBe(true);
    expect((error as GenerationError).code).toBe('no_valid_topics');
    expect((error as Error).message).not.toContain(SECRET_TITLE);
  });

  it('throws the same error for an empty reply', async () => {
    const { llm } = fakeLlm({ topics: [] });
    await expect(new TopicSuggesterService(llm).suggest(input)).rejects.toMatchObject({
      code: 'no_valid_topics',
      retryable: true,
    });
  });
});
