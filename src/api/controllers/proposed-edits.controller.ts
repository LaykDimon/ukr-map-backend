import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { ProposedEditsService } from '../services/proposed-edits.service';
import { CreateProposedEditDto, ReviewProposedEditDto } from '../dtos/proposed-edit.dto';
import { ProposedEditStatus } from '../entities/proposed-edit.entity';

@ApiTags('proposed-edits')
@Controller('proposed-edits')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProposedEditsController {
  constructor(private readonly proposedEditsService: ProposedEditsService) {}

  @Post()
  @ApiOperation({ summary: 'Propose an edit to a person record' })
  async create(
    @Body() dto: CreateProposedEditDto,
    @Request() req: { user: { userId: number } },
  ) {
    return this.proposedEditsService.create(dto, req.user.userId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get my proposed edits' })
  async findMine(@Request() req: { user: { userId: number } }) {
    return this.proposedEditsService.findByUser(req.user.userId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all proposed edits (admin only)' })
  @ApiQuery({ name: 'status', required: false, enum: ProposedEditStatus })
  async findAll(@Query('status') status?: ProposedEditStatus) {
    return this.proposedEditsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a proposed edit by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposedEditsService.findOne(id);
  }

  @Post(':id/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Approve or reject a proposed edit (admin only)' })
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewProposedEditDto,
    @Request() req: { user: { userId: number } },
  ) {
    if (dto.action === 'approve') {
      return this.proposedEditsService.approve(id, req.user.userId, dto.reviewComment);
    }
    return this.proposedEditsService.reject(id, req.user.userId, dto.reviewComment);
  }
}
