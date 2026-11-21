import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
export class PaymentLineDto {
  @IsString()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  amount!: string;
  @IsOptional()
  @IsIn(["cash", "card", "bank", "other"])
  method?: "cash" | "card" | "bank" | "other";
  @IsOptional()
  @IsISO8601({ strict: true })
  receivedAt?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  refundOfId?: string;
}
export class PaymentCommandDto {
  @IsIn(["receive", "refund", "reconcile"])
  kind!: "receive" | "refund" | "reconcile";
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  idempotencyKey!: string;
  @IsInt()
  @Min(0)
  @Max(2147483646)
  revision!: number;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  entries!: PaymentLineDto[];
}
