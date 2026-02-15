import { IsOptional, IsString, IsObject, IsUUID } from 'class-validator';

export class CreateProposedEditDto {
  @IsUUID()
  personId: string;

  @IsObject()
  changes: Record<string, { old: any; new: any }>;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReviewProposedEditDto {
  @IsString()
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  reviewComment?: string;
}
