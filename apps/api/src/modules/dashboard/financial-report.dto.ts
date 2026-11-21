import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

export class FinancialReportDto {
  @IsOptional()
  @IsIn(["day", "week", "month", "year", "all"])
  period?: "day" | "week" | "month" | "year" | "all";

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  collaboratorId?: string;
}

export class FinancialActivityDto extends FinancialReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
