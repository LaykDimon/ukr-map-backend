import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole, UserPersona } from '../entities/user.entity';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all users (admin only)' })
  findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a user role (admin only)' })
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('role') role: string,
    @Request() req: { user: { userId: number } },
  ) {
    if (req.user.userId === id) {
      throw new ForbiddenException('You cannot change your own role');
    }
    if (!Object.values(UserRole).includes(role as UserRole)) {
      throw new BadRequestException(
        `Invalid role. Must be one of: ${Object.values(UserRole).join(', ')}`,
      );
    }
    return this.usersService.updateRole(id, role as UserRole);
  }

  @Patch(':id/persona')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a user persona (admin only)' })
  updatePersona(
    @Param('id', ParseIntPipe) id: number,
    @Body('persona') persona: string,
  ) {
    if (!Object.values(UserPersona).includes(persona as UserPersona)) {
      throw new BadRequestException(
        `Invalid persona. Must be one of: ${Object.values(UserPersona).join(', ')}`,
      );
    }
    return this.usersService.updatePersona(id, persona as UserPersona);
  }
}
