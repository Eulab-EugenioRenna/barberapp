import { Transform } from "class-transformer";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
const decimal = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null ? value : String(value),
  );
export class InventoryCommandDto {
  @IsIn(["opening", "receipt", "issue", "adjust", "transfer", "return"])
  kind!: "opening" | "receipt" | "issue" | "adjust" | "transfer" | "return";
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  locationId!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string;
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  toLocationId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  returnOfId?: string;
  @IsOptional()
  @decimal()
  @Matches(/^\d+(\.\d{1,3})?$/)
  quantity?: string;
  @IsOptional()
  @decimal()
  @Matches(/^\d+(\.\d{1,6})?$/)
  unitCost?: string;
  @IsOptional()
  @decimal()
  @Matches(/^\d+(\.\d{1,2})?$/)
  purchaseVatRate?: string;
  @IsOptional()
  @IsIn(["net", "gross"])
  costMode?: "net" | "gross";
}
