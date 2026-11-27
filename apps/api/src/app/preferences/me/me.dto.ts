import { ChangeVoiceRequestSchema, CompleteOnboardingRequestSchema } from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() typed with these classes.
export class CompleteOnboardingDto extends createZodDto(CompleteOnboardingRequestSchema) {}
export class ChangeVoiceDto extends createZodDto(ChangeVoiceRequestSchema) {}
