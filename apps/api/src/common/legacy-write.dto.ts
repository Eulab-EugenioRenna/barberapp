import "reflect-metadata";
import { Type, Transform } from "class-transformer";
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
  IsIn,
  Matches,
} from "class-validator";
import { AppointmentStatus } from "./domain-types";
const decimalField = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null ? value : String(value),
  );
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
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  idempotencyKey?: string;
  @IsOptional() @IsInt() @Min(0) revision?: number;
  [key: string]: unknown;
  @IsOptional() @IsString() @MaxLength(100) sectorId?: string;
  /** Activity of a service or product (Barberia, Estetica, Rivendita…). */
  @IsOptional() @IsString() @MaxLength(100) activityId?: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsString() @MaxLength(4000) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) firstName?: string;
  @IsOptional() @IsString() @MaxLength(4000) lastName?: string;
  @IsOptional() @IsString() @MaxLength(4000) email?: string;
  @IsOptional() @IsString() @MaxLength(4000) phone?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) sku?: string;
  @IsOptional() @IsString() @MaxLength(128) barcode?: string;
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
  @IsOptional() @IsBoolean() requiresRoom?: boolean;
  @IsOptional() @IsBoolean() requiresCollaborator?: boolean;
  @IsOptional() @IsBoolean() privacyConsent?: boolean;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
  @IsOptional() @IsBoolean() priceLocked?: boolean;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,6})?$/)
  @MaxLength(30)
  basePrice?: string;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,6})?$/)
  @MaxLength(30)
  price?: string;
  @IsOptional() @IsIn(["legacy", "net", "gross"]) priceMode?: string;
  @IsOptional() @IsIn(["legacy", "net", "gross"]) costMode?: string;
  @IsOptional() @IsBoolean() stockTracked?: boolean;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(10)
  vatRate?: string;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(10)
  purchaseVatRate?: string;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,6})?$/)
  @MaxLength(30)
  cost?: string;
  @IsOptional()
  @decimalField()
  @Matches(/^\d+(\.\d{1,3})?$/)
  @MaxLength(30)
  consumptionUnits?: string;
  @IsOptional() @IsString() @MaxLength(500) priceChangeReason?: string;
  @IsOptional() @IsString() @MaxLength(500) priceOverrideReason?: string;
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
