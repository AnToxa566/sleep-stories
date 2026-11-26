// A `running` job older than this is taken over by the next claim. Decided by the owner on
// 2026-10-30. It must be longer than the worst job (LLM 90 s + TTS 180 s + upload), so a
// live run is never taken over; it costs that a crashed run waits this long to be retaken.
// It lives with the job queue because the Cloud Tasks adapter derives its dispatch deadline
// from it, and `providers` imports from no feature folder.
export const JOB_LEASE_MINUTES = 10;
