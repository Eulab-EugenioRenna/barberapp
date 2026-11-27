import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { BookingLineDto } from "./booking-write.dto";
export class BookingRevisionLineDto extends BookingLineDto {
  @IsOptional() @IsString() @MaxLength(100) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) orderItemId?: string;
}
export class BookingRevisionDto {
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/) idempotencyKey!: string;
  @IsInt() @Min(0) revision!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookingRevisionLineDto)
  lines!: BookingRevisionLineDto[];
  @IsOptional() @IsString() @MaxLength(64) startsAt?: string;
}
export class BookingCancellationDto {
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/) idempotencyKey!: string;
  /** Optional: a cancellation never waits for a fresh copy of the account. */
  @IsOptional() @IsInt() @Min(0) revision?: number;
  /** Optional: defaults to «Annullato dall'agenda». */
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
