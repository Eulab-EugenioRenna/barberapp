import { Body, Controller, Get, Patch, Post } from '@nestjs/common';

@Controller()
export class PaymentsController {
  @Get('payment-settings')
  settings(): unknown {
    return { provider: null, enabled: false, captureMode: 'future_ready' };
  }

  @Patch('payment-settings')
  updateSettings(@Body() body: Record<string, unknown>): unknown {
    return body;
  }

  @Post('payments/prepare-intent')
  prepareIntent(@Body() body: Record<string, unknown>): unknown {
    return { provider: 'stub', status: 'prepared', ...body };
  }
}
