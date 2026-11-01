import { ListenReportRequestSchema } from '@sleep-stories/contracts';
import { createZodDto } from 'nestjs-zod';

// The global validation pipe validates a @Body() typed with this class.
export class ListenReportRequestDto extends createZodDto(ListenReportRequestSchema) {}
