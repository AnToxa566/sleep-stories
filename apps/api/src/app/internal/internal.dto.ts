import { RunJobRequestSchema } from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() typed with this class. The body is the
// job id only; the strict schema refuses any other key.
export class RunJobDto extends createZodDto(RunJobRequestSchema) {}
