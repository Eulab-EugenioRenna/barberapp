import { Type } from "class-transformer";
import { Equals, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from "class-validator";
export class WhatsAppMessageQueryDto {
  @IsOptional() @IsUUID() before?: string;
  @IsOptional() @IsString() @MaxLength(100) chat?: string;
}
/** Accepted by Connect: JPEG, PNG, WebP up to ~10 MB once decoded. */
export const WHATSAPP_IMAGE_MAX = 14_000_000;
export class WhatsAppImageDto {
  @IsString() @MaxLength(WHATSAPP_IMAGE_MAX) @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) data!: string;
  @IsString() @Matches(/^[\w.-]{1,100}$/) filename!: string;
}
export class SendWhatsAppTextDto {
  @IsOptional() @IsString() @Length(7, 100) to?: string;
  @IsOptional() @IsUUID() customerId?: string;
  /** Required without an image; with an image it is the caption (checked by the service). */
  @IsOptional() @IsString() @MaxLength(16000) text?: string;
  @IsString() @Length(8, 128) @Matches(/^[a-zA-Z0-9_-]+$/) idempotencyKey!: string;
  @Equals(true) recipientAuthorized!: true;
  @IsOptional() @ValidateNested() @Type(() => WhatsAppImageDto) image?: WhatsAppImageDto;
}
export class BroadcastWhatsAppTextDto {
  @IsOptional() @IsString() @MaxLength(16000) text?: string;
  @IsString() @Length(8, 128) @Matches(/^[a-zA-Z0-9_-]+$/) idempotencyKey!: string;
  @Equals(true) recipientAuthorized!: true;
  @IsOptional() @ValidateNested() @Type(() => WhatsAppImageDto) image?: WhatsAppImageDto;
}
