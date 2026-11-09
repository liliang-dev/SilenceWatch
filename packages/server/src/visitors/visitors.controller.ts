import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../access/auth.guard';
import { VisitorsService } from './visitors.service';

/**
 * Where the web application reports that it was opened, once per page load. Public,
 * because the people who matter most to the count are the ones who have not
 * signed in yet. It takes no body and answers nothing.
 */
@Controller('v1/visits')
export class VisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Public()
  @Post()
  @HttpCode(204)
  async record(@Req() request: FastifyRequest): Promise<void> {
    await this.visitors.record(request.ip, request.headers['user-agent']);
  }
}
