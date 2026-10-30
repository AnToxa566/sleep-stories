import { CompleteOnboardingRequestSchema } from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() typed with this class.
export class CompleteOnboardingDto extends createZodDto(CompleteOnboardingRequestSchema) {}
