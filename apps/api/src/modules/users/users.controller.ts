import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { UpdateProfileDto } from './update-profile.dto';
import type { UserProfile } from './user-profile';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto): Promise<UserProfile> {
    return this.users.updateProfile(user.id, dto);
  }
}
