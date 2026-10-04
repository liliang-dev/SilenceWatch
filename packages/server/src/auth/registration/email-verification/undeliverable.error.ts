import { ServiceUnavailableException } from '@nestjs/common';

/**
 * The mail did not go out.
 *
 * Its own type so both registration branches can fail identically, and so the
 * visitor gets something they can act on instead of "internal server error" in
 * front of an account they now cannot use. Retrying the same registration
 * re-sends, because the address is then a known unverified one.
 */
export class UndeliverableError extends ServiceUnavailableException {
  constructor() {
    super('Could not send the confirmation email right now. Please try again in a few minutes.');
  }
}
