import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User, UserRole, UserPersona } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

const mockUser: Partial<User> = {
  id: 1,
  email: 'test@example.com',
  username: 'testuser',
  password: 'hashedpassword',
  role: UserRole.USER,
  persona: UserPersona.STUDENT,
};

describe('AuthService', () => {
  let service: AuthService;
  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('mock-jwt-token');
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe('test@example.com');
    });

    it('should return null when user is not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.validateUser('no@user.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null when password is wrong', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrong');
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access token and user info', async () => {
      const result = await service.login(mockUser as User);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.username).toBe('testuser');
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          sub: 1,
          role: UserRole.USER,
        }),
      );
    });
  });

  describe('register', () => {
    it('should register a new user and return token', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      mockRepo.create.mockReturnValue({
        ...mockUser,
        password: 'hashed',
      });
      mockRepo.save.mockResolvedValue({ ...mockUser, password: 'hashed' });

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        username: 'testuser',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if user exists', async () => {
      mockRepo.findOne.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          username: 'testuser',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
