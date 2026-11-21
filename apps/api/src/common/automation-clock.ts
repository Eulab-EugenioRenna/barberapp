import { Injectable } from "@nestjs/common";

/** Automation time seam. Production uses wall time; isolated QA supplies its own clock. */
@Injectable()
export class AutomationClock {
  now(): Date {
    return new Date();
  }
}
