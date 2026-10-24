import "reflect-metadata";
import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  MaxLength,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsISO8601,
  IsEnum,
  Matches,
} from "class-validator";
import { AppointmentStatus } from "./domain-types";
class WeeklyScheduleDto {
  [key: string]: unknown;
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsBoolean() isWorkingDay!: boolean;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime?: string;
}
class DayOverrideDto {
  [key: string]: unknown;
  @IsISO8601() date!: string;
  @IsBoolean() isWorkingDay!: boolean;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsBoolean() isHoliday?: boolean;
}
export class LegacyWriteDto {
  [key: string]: unknown;
  @IsOptional() @IsString() @MaxLength(4000) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) firstName?: string;
  @IsOptional() @IsString() @MaxLength(4000) lastName?: string;
  @IsOptional() @IsString() @MaxLength(4000) email?: string;
  @IsOptional() @IsString() @MaxLength(4000) phone?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) sku?: string;
  @IsOptional() @IsString() @MaxLength(4000) category?: string;
  @IsOptional() @IsString() @MaxLength(4000) publicDescription?: string;
  @IsOptional() @IsString() @MaxLength(4000) internalDescription?: string;
  @IsOptional() @IsString() @MaxLength(4000) color?: string;
  @IsOptional() @IsString() @MaxLength(4000) calendarColor?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(4000) customerName?: string;
  @IsOptional() @IsString() @MaxLength(4000) customerNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) internalNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) reason?: string;
  @IsOptional() @IsString() @MaxLength(4000) customerId?: string;
  @IsOptional() @IsString() @MaxLength(4000) collaboratorId?: string;
  @IsOptional() @IsString() @MaxLength(4000) roomId?: string;
  @IsOptional() @IsString() @MaxLength(4000) serviceId?: string;
  @IsOptional() @IsString() @MaxLength(4000) productId?: string;
  @IsOptional() @IsString() @MaxLength(4000) mode?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isBookableOnline?: boolean;
  @IsOptional() @IsBoolean() requiresCollaborator?: boolean;
  @IsOptional() @IsBoolean() privacyConsent?: boolean;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @IsOptional() @IsBoolean() priceLocked?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(99999999) basePrice?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(99999999) price?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(99999999) finalPrice?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10080) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10080) quantity?: number;
  @IsOptional() @IsString() @MaxLength(64) startsAt?: string;
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  tags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyScheduleDto)
  weeklySchedules?: WeeklyScheduleDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => DayOverrideDto)
  dayOverrides?: DayOverrideDto[];
}
export class AppointmentStatusDto {
  @IsEnum(AppointmentStatus) status!: AppointmentStatus;
}
