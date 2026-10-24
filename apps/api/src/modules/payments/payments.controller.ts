import {
  Controller,
  Get,
  Patch,
  Post,
  NotImplementedException,
} from "@nestjs/common";
@Controller()
export class PaymentsController {
  @Get("payment-settings")
  settings(): unknown {
    return { provider: null, enabled: false };
  }
  @Patch("payment-settings")
  updateSettings(): never {
    throw new NotImplementedException("Provider pagamenti non disponibile");
  }
  @Post("payments/prepare-intent")
  prepareIntent(): never {
    throw new NotImplementedException("Provider pagamenti non disponibile");
  }
}
