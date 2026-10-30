import { ApiErrorResponse, ApiErrorResponseSchema } from '@sleep-stories/contracts';

// Builds an error response body and checks it against the contracts schema, so
// every error the API produces by hand has the shape the mobile app parses.
export function apiErrorBody(
  statusCode: ApiErrorResponse['statusCode'],
  code: ApiErrorResponse['code'],
  message: string,
): ApiErrorResponse {
  return ApiErrorResponseSchema.parse({ statusCode, code, message });
}
