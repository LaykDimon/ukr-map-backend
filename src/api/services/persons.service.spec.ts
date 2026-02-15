import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PersonsService } from './persons.service';
import { Person } from '../entities/person.entity';

const mockPerson: Partial<Person> = {
  id: 'test-uuid-1',
  name: 'Taras Shevchenko',
  birthYear: 1814,
  birthPlace: 'Moryntsi',
  lat: 49.08,
  lng: 30.45,
  category: 'writer',
  rating: 95,
  views: 1000,
  isManual: false,
};

describe('PersonsService', () => {
  let service: PersonsService;
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonsService,
        { provide: getRepositoryToken(Person), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<PersonsService>(PersonsService);
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('should return a person when found', async () => {
      mockRepo.findOne.mockResolvedValue(mockPerson);
      const result = await service.findOne('test-uuid-1');
      expect(result).toEqual(mockPerson);
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'test-uuid-1' } });
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('test-uuid-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a person with isManual=true', async () => {
      const dto = { name: 'Test Person', birthYear: 1900 };
      const created = { ...dto, isManual: true, id: 'test-uuid-2' };
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto);
      expect(result).toEqual(created);
      expect(mockRepo.create).toHaveBeenCalledWith({ ...dto, isManual: true });
    });

    it('should update PostGIS geometry when coordinates are provided', async () => {
      const dto = { name: 'Geo Person', lat: 50.0, lng: 30.0 };
      const created = { ...dto, isManual: true, id: 'test-uuid-3' };
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);
      mockRepo.query.mockResolvedValue(undefined);

      await service.create(dto);
      expect(mockRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('ST_SetSRID'),
        [30.0, 50.0, 'test-uuid-3'],
      );
    });

    it('should not call PostGIS update when no coordinates', async () => {
      const dto = { name: 'No Coords' };
      const created = { ...dto, isManual: true, id: 'test-uuid-4' };
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create(dto);
      expect(mockRepo.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update and return the person', async () => {
      mockRepo.findOne.mockResolvedValue({ ...mockPerson });
      const updated = { ...mockPerson, name: 'Updated Name' };
      mockRepo.save.mockResolvedValue(updated);
      mockRepo.query.mockResolvedValue(undefined);

      const result = await service.update('test-uuid-1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundException when updating non-existent person', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.update('test-uuid-999', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should remove the person', async () => {
      mockRepo.findOne.mockResolvedValue(mockPerson);
      mockRepo.remove.mockResolvedValue(undefined);

      await service.remove('test-uuid-1');
      expect(mockRepo.remove).toHaveBeenCalledWith(mockPerson);
    });

    it('should throw NotFoundException when removing non-existent person', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('test-uuid-999')).rejects.toThrow(NotFoundException);
    });
  });
});
