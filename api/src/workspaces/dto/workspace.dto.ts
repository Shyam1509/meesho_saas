import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { NAME_MAX_LENGTH, trimString } from '../../common/http/transforms';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../../database/models';

/** Body of POST /workspaces and PATCH /workspaces/:workspaceId. */
export class WorkspaceNameDto {
  @ApiProperty({
    minLength: 1,
    maxLength: NAME_MAX_LENGTH,
    example: 'Asha Fashions',
    description: 'Trimmed; 1–120 characters',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name!: string;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class WorkspaceSummaryDto {
  @ApiProperty({ example: '1', description: 'BIGINT id as a string' })
  id!: string;

  @ApiProperty({ example: 'My workspace' })
  name!: string;

  @ApiProperty({
    enum: WORKSPACE_ROLES,
    example: 'owner',
    description: "The caller's role in this workspace",
  })
  role!: WorkspaceRole;

  @ApiProperty({ format: 'date-time', example: '2026-10-30T10:00:00.000Z' })
  createdAt!: string;
}

export class WorkspaceListDto {
  @ApiProperty({
    type: [WorkspaceSummaryDto],
    description: 'Sorted by name, then id',
  })
  items!: WorkspaceSummaryDto[];
}

export class WorkspaceMemberDto {
  @ApiProperty({ example: '1' })
  userId!: string;

  @ApiProperty({ example: 'seller@example.com' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Asha' })
  displayName!: string | null;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'member' })
  role!: WorkspaceRole;

  @ApiProperty({ format: 'date-time', example: '2026-10-30T10:00:00.000Z' })
  joinedAt!: string;
}

export class WorkspaceMemberListDto {
  @ApiProperty({
    type: [WorkspaceMemberDto],
    description: 'Sorted by joinedAt, then userId',
  })
  items!: WorkspaceMemberDto[];
}
