import { assertLocalDatabase } from './assert-local-database';

// Jest globalSetup for jest.integration.config.cts: runs once before any
// integration spec and aborts the whole run when the database is not local.
export default function globalSetup(): void {
  assertLocalDatabase();
}
