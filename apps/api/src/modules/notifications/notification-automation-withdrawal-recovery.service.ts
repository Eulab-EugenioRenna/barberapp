import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NotificationAutomationCommandStore } from "./notification-automation-command-store.service";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

/** Only retries the persisted withdrawal; never sends, replaces a key or revokes the shared grant. */
@Injectable()
export class NotificationAutomationWithdrawalRecovery
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    private readonly commands: NotificationAutomationCommandStore,
    private readonly grants: NotificationAutomationGrantsService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.recover(), 30000);
    this.timer.unref();
    void this.recover();
  }
  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
  }
  async recover() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      for (const command of await this.commands.pendingWithdrawals()) {
        if (this.stopped) break;
        try {
          await this.grants.withdrawForWorker(
            command.grantId,
            command.commandId,
            this.commands.payload(command),
          );
        } catch {
          await this.commands.defer(command);
        }
      }
    } catch {
      /* SQL/transport outage leaves the original request pending; no body or secret is logged. */
    } finally {
      this.running = false;
    }
  }
}
