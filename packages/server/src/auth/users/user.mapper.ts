import type { UserDto } from '@silencewatch/shared';

export function toUserDto(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}
