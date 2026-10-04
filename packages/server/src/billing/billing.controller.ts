import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  checkoutRequestSchema,
  type BillingRedirectDto,
  type BillingStateDto,
  type CheckoutRequest,
} from '@silencewatch/shared';
import { assertUser, CurrentPrincipal, type Principal } from '../access/principal';
import { StrictRateLimit } from '../common/rate-limit.guard';
import { zodPipe } from '../common/zod-validation.pipe';
import { BillingService } from './billing.service';

/**
 * The signed-in user's own subscription. A user session only: an API key is a
 * project's, and what an account pays is not.
 */
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  state(@CurrentPrincipal() principal: Principal): Promise<BillingStateDto> {
    return this.billing.state(assertUser(principal).userId);
  }

  /** Strict: each call asks Stripe to create something. */
  @StrictRateLimit()
  @Post('checkout')
  @HttpCode(200)
  checkout(
    @CurrentPrincipal() principal: Principal,
    @Body(zodPipe(checkoutRequestSchema)) body: CheckoutRequest,
  ): Promise<BillingRedirectDto> {
    return this.billing.startCheckout(assertUser(principal).userId, body.plan);
  }

  @StrictRateLimit()
  @Post('portal')
  @HttpCode(200)
  portal(@CurrentPrincipal() principal: Principal): Promise<BillingRedirectDto> {
    return this.billing.openPortal(assertUser(principal).userId);
  }
}
