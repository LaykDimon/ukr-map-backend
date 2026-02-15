import { Injectable, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, UserPersona } from '../entities/user.entity';
import { CreateUserDto } from '../dtos/auth.dto';
import * as bcrypt from 'bcrypt';

export interface AuthResponse {
  accessToken: string;
  user: {
    id: number;
    email: string;
    username: string;
    role: UserRole;
    persona: UserPersona;
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async register(createUserDto: CreateUserDto): Promise<AuthResponse> {
    const { email, password, username } = createUserDto;
    const existing = await this.usersRepository.findOne({
      where: [{ email }, { username }],
    });
    if (existing) {
      throw new ConflictException(
        'User with this email or username already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      parseInt(process.env.SALT_ROUNDS || '12', 10),
    );

    const user = this.usersRepository.create({
      username,
      email,
      password: hashedPassword,
      role: UserRole.USER,
      persona: UserPersona.STUDENT,
    });
    await this.usersRepository.save(user);
    return this.login(user);
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: User | Omit<User, 'password'>): Promise<AuthResponse> {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      persona: user.persona,
      username: user.username,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        persona: user.persona,
      },
    };
  }
}
