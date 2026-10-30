import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { Injectable } from '@nestjs/common';

// The secret that the local job queue sends to this same process. Random per
// instance (so per boot), held in memory only: never in env, never in a log.
// The value sits in a #private field behind a getter, so util.inspect (which Nest's
// ConsoleLogger and console.log use) cannot print it, and an object that holds this
// instance (the local queue, the verifier) cannot leak it either. JSON.stringify,
// String() and util.inspect of the instance itself give a placeholder.
@Injectable()
export class LocalDispatchSecret {
  readonly #value: string = randomBytes(32).toString('hex');

  get value(): string {
    return this.#value;
  }

  toJSON(): string {
    return '[LocalDispatchSecret]';
  }

  toString(): string {
    return '[LocalDispatchSecret]';
  }

  [inspect.custom](): string {
    return '[LocalDispatchSecret]';
  }
}
