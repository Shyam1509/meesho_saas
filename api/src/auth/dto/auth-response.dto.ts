import { ApiProperty } from '@nestjs/swagger';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../../database/models';

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class AuthConfigDto {
  @ApiProperty({ example: true })
  registrationEnabled!: boolean;
}

export class MeUserDto {
  @ApiProperty({ example: '1', description: 'BIGINT id as a string' })
  id!: string;

  @ApiProperty({ example: 'seller@example.com' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Asha' })
  displayName!: string | null;
}

export class MeWorkspaceDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'My workspace' })
  name!: string;

  @ApiProperty({ enum: WORKSPACE_ROLES, example: 'owner' })
  role!: WorkspaceRole;
}

export class MeResponseDto {
  @ApiProperty({ type: MeUserDto })
  user!: MeUserDto;

  @ApiProperty({
    type: [MeWorkspaceDto],
    description: "The caller's workspaces, sorted by name, then id",
  })
  workspaces!: MeWorkspaceDto[];
}
