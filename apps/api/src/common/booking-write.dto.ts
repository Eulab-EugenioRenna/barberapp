import { Type, Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
export class BookingLineDto {
  @IsString() @MaxLength(100) serviceId!: string;
  @IsOptional() @IsString() @MaxLength(64) startsAt?: string;
  @IsOptional() @IsString() @MaxLength(100) collaboratorId?: string;
  @IsOptional() @IsString() @MaxLength(100) roomId?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null ? null : String(value),
  )
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  finalPrice?: string;
  @IsOptional() @IsString() @MaxLength(500) priceOverrideReason?: string;
}
export class BookingCreateDto {
  [key: string]: unknown;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(100) serviceId?: string;
  @IsOptional() @IsString() @MaxLength(64) startsAt?: string;
  @IsOptional() @IsString() @MaxLength(100) collaboratorId?: string;
  @IsOptional() @IsString() @MaxLength(100) roomId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookingLineDto)
  lines?: BookingLineDto[];
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsOptional() @IsString() @MaxLength(240) customerName?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsBoolean() appointmentWhatsAppConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) customerNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) internalNotes?: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsString() @MaxLength(100) sectorId?: string;
  @IsOptional()
  @IsIn(["draft", "requested", "confirmed", "checked_in", "rescheduled"])
  status?: "draft" | "requested" | "confirmed" | "checked_in" | "rescheduled";
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null ? null : String(value),
  )
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  finalPrice?: string;
  @IsOptional() @IsString() @MaxLength(500) priceOverrideReason?: string;
}
