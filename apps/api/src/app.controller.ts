import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getRoot(): { name: string; status: string; docs: string } {
    return {
      name: "ALORA by EULAB API",
      status: "ready",
      docs: "/docs",
    };
  }
}
