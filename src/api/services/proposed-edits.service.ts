import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProposedEdit, ProposedEditStatus } from '../entities/proposed-edit.entity';
import { Person } from '../entities/person.entity';
import { CreateProposedEditDto } from '../dtos/proposed-edit.dto';

@Injectable()
export class ProposedEditsService {
  constructor(
    @InjectRepository(ProposedEdit)
    private proposedEditRepository: Repository<ProposedEdit>,
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  async create(dto: CreateProposedEditDto, userId: number): Promise<ProposedEdit> {
    const person = await this.personRepository.findOne({ where: { id: dto.personId } });
    if (!person) {
      throw new NotFoundException(`Person with id ${dto.personId} not found`);
    }

    const edit = this.proposedEditRepository.create({
      personId: dto.personId,
      userId,
      changes: dto.changes,
      comment: dto.comment,
      status: ProposedEditStatus.PENDING,
    });

    return this.proposedEditRepository.save(edit);
  }

  async findAll(status?: ProposedEditStatus): Promise<ProposedEdit[]> {
    const where = status ? { status } : {};
    return this.proposedEditRepository.find({
      where,
      relations: ['person', 'user'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string): Promise<ProposedEdit> {
    const edit = await this.proposedEditRepository.findOne({
      where: { id },
      relations: ['person', 'user'],
    });
    if (!edit) {
      throw new NotFoundException(`Proposed edit with id ${id} not found`);
    }
    return edit;
  }

  async findByUser(userId: number): Promise<ProposedEdit[]> {
    return this.proposedEditRepository.find({
      where: { userId },
      relations: ['person'],
      order: { createdAt: 'DESC' },
    });
  }

  async approve(id: string, reviewedBy: number, reviewComment?: string): Promise<ProposedEdit> {
    const edit = await this.findOne(id);

    // Apply changes to the person
    const person = await this.personRepository.findOne({ where: { id: edit.personId } });
    if (person) {
      for (const [field, value] of Object.entries(edit.changes)) {
        (person as any)[field] = value.new;
      }
      // Mark as manual so automated syncs won't overwrite approved edits
      person.isManual = true;
      await this.personRepository.save(person);

      // Update PostGIS if lat/lng changed
      const lat = edit.changes.lat?.new ?? person.lat;
      const lng = edit.changes.lng?.new ?? person.lng;
      if (lat && lng) {
        await this.personRepository.query(
          `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
          [lng, lat, person.id],
        );
      }
    }

    edit.status = ProposedEditStatus.APPROVED;
    edit.reviewedBy = reviewedBy;
    edit.reviewComment = reviewComment || null;
    return this.proposedEditRepository.save(edit);
  }

  async reject(id: string, reviewedBy: number, reviewComment?: string): Promise<ProposedEdit> {
    const edit = await this.findOne(id);
    edit.status = ProposedEditStatus.REJECTED;
    edit.reviewedBy = reviewedBy;
    edit.reviewComment = reviewComment || null;
    return this.proposedEditRepository.save(edit);
  }
}
