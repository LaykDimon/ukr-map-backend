import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, UserPersona } from '../entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findAll(): Promise<Omit<User, 'password'>[]> {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });
    return users.map(({ password, ...rest }) => rest);
  }

  async updateRole(
    id: number,
    role: UserRole,
  ): Promise<Omit<User, 'password'>> {
    await this.usersRepository.update(id, { role });
    const user = await this.usersRepository.findOneByOrFail({ id });
    const { password, ...rest } = user;
    return rest;
  }

  async updatePersona(
    id: number,
    persona: UserPersona,
  ): Promise<Omit<User, 'password'>> {
    await this.usersRepository.update(id, { persona });
    const user = await this.usersRepository.findOneByOrFail({ id });
    const { password, ...rest } = user;
    return rest;
  }
}
