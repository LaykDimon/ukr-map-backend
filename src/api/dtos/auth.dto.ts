export class CreateUserDto {
  username: string;
  email: string;
  password: string;
}

export class LoginUserDto {
  email: string;
  password: string;
}
