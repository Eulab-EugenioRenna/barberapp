import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { CUSTOMERS_ALIGNMENT_QUEUE } from "./customers.constants";
import { CustomersAlignmentService } from "./customers-alignment.service";
import { CustomerAlignmentJob } from "./customers.types";

@Processor(CUSTOMERS_ALIGNMENT_QUEUE)
export class CustomersProcessor extends WorkerHost {
  constructor(
    private readonly customersAlignmentService: CustomersAlignmentService,
  ) {
    super();
  }

  async process(job: Job<CustomerAlignmentJob>): Promise<void> {
    if (job.data.customerId) {
      await this.customersAlignmentService.alignCustomer(
        job.data.tenantId,
        job.data.customerId,
      );
      return;
    }

    await this.customersAlignmentService.alignTenant(job.data.tenantId);
  }
}
