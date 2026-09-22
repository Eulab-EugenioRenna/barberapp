import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

type WorkingWindow = {
  isAvailable: boolean;
  isHoliday: boolean;
  startMinutes: number;
  endMinutes: number;
  source: "override" | "weekly" | "default";
};

@Injectable()
export class CollaboratorScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveWorkingWindow(
    tenantId: string,
    collaboratorId: string,
    date: Date,
  ): Promise<WorkingWindow> {
    const dayDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const weekday = (date.getDay() + 6) % 7;

    const [override, weekly, tenantHoliday] = await Promise.all([
      this.prisma.collaboratorDayOverride.findFirst({
        where: { collaboratorId, date: dayDate },
      }),
      this.prisma.collaboratorWeeklySchedule.findFirst({
        where: { collaboratorId, weekday },
      }),
      this.prisma.tenantHoliday.findFirst({
        where: { tenantId, date: dayDate },
      }),
    ]);

    if (tenantHoliday) {
      return this.toWindow(false, null, null, true, "override");
    }

    if (override) {
      return this.toWindow(
        override.isWorkingDay,
        override.startTime,
        override.endTime,
        Boolean(override.isHoliday),
        "override",
      );
    }

    if (weekly) {
      return this.toWindow(
        weekly.isWorkingDay,
        weekly.startTime,
        weekly.endTime,
        false,
        "weekly",
      );
    }

    return this.toWindow(true, "09:00", "19:00", false, "default");
  }

  private toWindow(
    isWorkingDay: boolean,
    startTime: string | null,
    endTime: string | null,
    isHoliday: boolean,
    source: "override" | "weekly" | "default",
  ): WorkingWindow {
    if (!isWorkingDay || !startTime || !endTime) {
      return {
        isAvailable: false,
        isHoliday,
        startMinutes: 0,
        endMinutes: 0,
        source,
      };
    }

    return {
      isAvailable: true,
      isHoliday,
      startMinutes: this.parseTime(startTime),
      endMinutes: this.parseTime(endTime),
      source,
    };
  }

  private parseTime(value: string): number {
    const [hours, minutes] = value.split(":").map((segment) => Number(segment));
    return hours * 60 + minutes;
  }
}
