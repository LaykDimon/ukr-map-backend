import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from '../services/search.service';

const mockResults = [
  { person: { id: 1, name: 'Taras Shevchenko' }, similarity: 0.9 },
  { person: { id: 2, name: 'Lesya Ukrainka' }, similarity: 0.3 },
];

describe('SearchController', () => {
  let controller: SearchController;
  const mockService = {
    search: jest.fn(),
    searchByRadius: jest.fn(),
    searchByPolygon: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: mockService }],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('should return search results for a valid query', async () => {
      mockService.search.mockResolvedValue(mockResults);
      const result = await controller.search('Taras', 'combined', 20);
      expect(result).toEqual(mockResults);
      expect(mockService.search).toHaveBeenCalledWith('Taras', 'combined', 20);
    });

    it('should return empty array for empty query', async () => {
      const result = await controller.search('', 'combined', 20);
      expect(result).toEqual([]);
      expect(mockService.search).not.toHaveBeenCalled();
    });

    it('should return empty array for whitespace-only query', async () => {
      const result = await controller.search('   ', 'combined', 20);
      expect(result).toEqual([]);
      expect(mockService.search).not.toHaveBeenCalled();
    });
  });

  describe('searchByRadius', () => {
    it('should call service with correct params', async () => {
      const mockPersons = [{ id: 1, name: 'Near Person' }];
      mockService.searchByRadius.mockResolvedValue(mockPersons);

      const result = await controller.searchByRadius(50.45, 30.52, 10, 100);
      expect(result).toEqual(mockPersons);
      expect(mockService.searchByRadius).toHaveBeenCalledWith(
        50.45, 30.52, 10, 100,
      );
    });
  });

  describe('searchByPolygon', () => {
    it('should call service with polygon and limit', async () => {
      const polygon = { type: 'Polygon', coordinates: [[[30, 50], [31, 50], [31, 51], [30, 50]]] };
      mockService.searchByPolygon.mockResolvedValue([]);

      const result = await controller.searchByPolygon({ polygon, limit: 50 });
      expect(result).toEqual([]);
      expect(mockService.searchByPolygon).toHaveBeenCalledWith(polygon, 50);
    });
  });
});
