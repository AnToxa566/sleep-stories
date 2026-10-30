import { Body, Controller, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { RunJobResponseSchema, SweepJobsResponseSchema } from '@sleep-stories/contracts';
import type { RunJobResponse, SweepJobsResponse } from '@sleep-stories/contracts';
import { ZodSerializerDto } from 'nestjs-zod';
import { apiErrorBody } from '../errors/api-error-body';
import { RunJobDto } from './internal.dto';
import { InternalRoute } from './internal-route.decorator';
import { JobRunnerService } from './job-runner.service';
import { JobSweeperService } from './job-sweeper.service';

// Called by Cloud Tasks (run) and Cloud Scheduler (sweep), or by the local queue in
// development. Every route is @InternalRoute(): InternalAuthGuard authenticates the caller
// and the global user-JWT guard steps aside. Nothing here reads a user id, a payload or
// anything but `jobId` from the request; the job's data comes from its database row.
// Answers carry a status word or a count only: never the payload, `last_error` or any
// provider text.
@Controller('internal/jobs')
export class InternalController {
  constructor(
    private readonly runner: JobRunnerService,
    private readonly sweeper: JobSweeperService,
  ) {}

  // POST, not PUT: a delivery is an action. 200, not Nest's default 201.
  @Post('run')
  @HttpCode(200)
  @InternalRoute()
  @ZodSerializerDto(RunJobResponseSchema)
  async run(@Body() body: RunJobDto): Promise<RunJobResponse> {
    const outcome = await this.runner.run(body.jobId);
    switch (outcome) {
      case 'succeeded':
      case 'failed':
      case 'finished':
        return { status: outcome };
      case 'retry':
      case 'in_progress':
        // 503 makes the queue deliver again later. The body is fixed on purpose.
        throw new ServiceUnavailableException(apiErrorBody(503, 'job_retry', 'Try again later'));
    }
  }

  @Post('sweep')
  @HttpCode(200)
  @InternalRoute()
  @ZodSerializerDto(SweepJobsResponseSchema)
  sweep(): Promise<SweepJobsResponse> {
    return this.sweeper.sweep();
  }
}
