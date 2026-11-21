import { Equals, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from "class-validator";
export class WhatsAppMessageQueryDto {
  @IsOptional() @IsUUID() before?: string;
  @IsOptional() @IsString() @MaxLength(100) chat?: string;
}
export class SendWhatsAppTextDto {
  @IsString() @Length(7, 100) to!: string;
  @IsString() @Length(1, 16000) @Matches(/\S/) text!: string;
  @IsString() @Length(8, 128) @Matches(/^[a-zA-Z0-9_-]+$/) idempotencyKey!: string;
  @Equals(true) recipientAuthorized!: true;
}
