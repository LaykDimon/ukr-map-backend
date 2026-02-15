import { Test, TestingModule } from '@nestjs/testing';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from '../services/statistics.service';

describe('StatisticsController', () => {
  let controller: StatisticsController;
  const mockService = {
    getTemporalDistribution: jest.fn(),
    getGeoDistribution: jest.fn(),
    getCategoryDistribution: jest.fn(),
    getOverview: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatisticsController],
      providers: [{ provide: StatisticsService, useValue: mockService }],
    }).compile();

    controller = module.get<StatisticsController>(StatisticsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTemporalDistribution', () => {
    it('should return temporal data', async () => {
      const data = [{ decade: 1800, count: 15 }, { decade: 1900, count: 42 }];
      mockService.getTemporalDistribution.mockResolvedValue(data);
      expect(await controller.getTemporalDistribution()).toEqual(data);
    });
  });

  describe('getGeoDistribution', () => {
    it('should pass limit parameter', async () => {
      const data = [{ birthPlace: 'Kyiv', count: 30 }];
      mockService.getGeoDistribution.mockResolvedValue(data);
      expect(await controller.getGeoDistribution(10)).toEqual(data);
      expect(mockService.getGeoDistribution).toHaveBeenCalledWith(10);
    });
  });

  describe('getCategoryDistribution', () => {
    it('should return category data', async () => {
      const data = [{ category: 'writer', count: 20 }];
      mockService.getCategoryDistribution.mockResolvedValue(data);
      expect(await controller.getCategoryDistribution()).toEqual(data);
    });
  });

  describe('getOverview', () => {
    it('should return overview statistics', async () => {
      const data = {
        totalPersons: 500,
        totalWithCoordinates: 450,
        totalCategories: 12,
        minBirthYear: 1000,
        maxBirthYear: 1995,
        avgRating: 42.5,
      };
      mockService.getOverview.mockResolvedValue(data);
      expect(await controller.getOverview()).toEqual(data);
    });
  });
});
