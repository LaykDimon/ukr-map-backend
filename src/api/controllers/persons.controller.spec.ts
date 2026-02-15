import { Test, TestingModule } from '@nestjs/testing';
import { PersonsController } from './persons.controller';
import { PersonsService } from '../services/persons.service';

const mockPerson = {
  id: 'test-uuid-1',
  name: 'Taras Shevchenko',
  birthYear: 1814,
  category: 'writer',
  rating: 95,
  views: 1000,
};

describe('PersonsController', () => {
  let controller: PersonsController;
  const mockService = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PersonsController],
      providers: [{ provide: PersonsService, useValue: mockService }],
    }).compile();

    controller = module.get<PersonsController>(PersonsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findOne', () => {
    it('should return a person by id', async () => {
      mockService.findOne.mockResolvedValue(mockPerson);
      const result = await controller.findOne('test-uuid-1');
      expect(result).toEqual(mockPerson);
      expect(mockService.findOne).toHaveBeenCalledWith('test-uuid-1');
    });
  });

  describe('create', () => {
    it('should create and return a new person', async () => {
      const dto = { name: 'New Person' };
      mockService.create.mockResolvedValue({ id: 'test-uuid-2', ...dto });
      const result = await controller.create(dto as any);
      expect(result).toEqual({ id: 'test-uuid-2', ...dto });
    });
  });

  describe('update', () => {
    it('should update and return the person', async () => {
      const updated = { ...mockPerson, name: 'Updated' };
      mockService.update.mockResolvedValue(updated);
      const result = await controller.update('test-uuid-1', { name: 'Updated' } as any);
      expect(result.name).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should delete and return confirmation', async () => {
      mockService.remove.mockResolvedValue(undefined);
      const result = await controller.remove('test-uuid-1');
      expect(result).toEqual({ deleted: true });
    });
  });
});
