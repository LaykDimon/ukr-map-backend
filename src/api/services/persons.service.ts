import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from '../entities/person.entity';
import { CreatePersonDto, UpdatePersonDto } from '../dtos/person.dto';

@Injectable()
export class PersonsService {
  constructor(
    @InjectRepository(Person)
    private personRepository: Repository<Person>,
  ) {}

  async create(dto: CreatePersonDto): Promise<Person> {
    const person = this.personRepository.create({
      ...dto,
      isManual: true,
    });
    const saved = await this.personRepository.save(person);

    // Update PostGIS geometry if coordinates provided
    if (dto.lat && dto.lng) {
      await this.personRepository.query(
        `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
        [dto.lng, dto.lat, saved.id],
      );
    }

    return saved;
  }

  async findOne(id: string): Promise<Person> {
    const person = await this.personRepository.findOne({ where: { id } });
    if (!person) {
      throw new NotFoundException(`Person with id ${id} not found`);
    }
    return person;
  }

  async update(id: string, dto: UpdatePersonDto): Promise<Person> {
    const person = await this.findOne(id);
    Object.assign(person, dto);
    const saved = await this.personRepository.save(person);

    // Update PostGIS geometry if coordinates changed
    const lat = dto.lat ?? person.lat;
    const lng = dto.lng ?? person.lng;
    if (lat && lng) {
      await this.personRepository.query(
        `UPDATE person SET "birthLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
        [lng, lat, saved.id],
      );
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const person = await this.findOne(id);
    await this.personRepository.remove(person);
  }
}
