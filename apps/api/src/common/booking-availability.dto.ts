import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
export class BookingAvailabilityLineDto {
  @IsString() @MaxLength(100) serviceId!: string;
  @IsOptional() @IsString() @MaxLength(100) collaboratorId?: string;
  @IsOptional() @IsString() @MaxLength(100) roomId?: string;
}
export class BookingAvailabilityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookingAvailabilityLineDto)
  lines!: BookingAvailabilityLineDto[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() @MaxLength(100) appointmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) startsAt?: string;
  /** Location of the booking: each service is offered by its activity there. */
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsString() @MaxLength(100) sectorId?: string;
}
