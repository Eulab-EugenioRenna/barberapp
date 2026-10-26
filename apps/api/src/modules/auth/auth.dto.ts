import { Transform } from "class-transformer";
import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  IsOptional,
} from "class-validator";
export class LoginEmailDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class LoginDto extends LoginEmailDto {
  @Transform(({ value }) => value === "" ? undefined : value)
  @IsOptional() @IsString() @Length(1, 4096) password?: string;
}
export class SignupDto extends LoginEmailDto {
  @IsString() @Length(8, 4096) password!: string;
  @IsString() @Length(1, 120) companyName!: string;
  @IsString() @Length(1, 80) firstName!: string;
  @IsString() @Length(1, 80) lastName!: string;
}
export class RefreshDto {
  @IsString() @Length(43, 43) refreshToken!: string;
}
