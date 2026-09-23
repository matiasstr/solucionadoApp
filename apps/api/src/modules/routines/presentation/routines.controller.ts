import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { requireUuid } from '../../../common/query';
import { CurrentUser, JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { RoutinesService } from '../application/routines.service';
import type { RoutineDto, RoutineItemDto, RoutineListDto } from './routine.contracts';
import { CreateRoutineDto, CreateRoutineItemDto, UpdateRoutineDto, UpdateRoutineItemDto } from './routines.dto';

/** Rutinas de compra privadas: requieren sesión y solo ven las del usuario del token. */
@Controller('shopping-routines')
@UseGuards(JwtAuthGuard)
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<RoutineListDto> {
    return { items: await this.routines.list(user.id) };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoutineDto): Promise<RoutineDto> {
    return this.routines.create(user.id, dto);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RoutineDto> {
    return this.routines.get(user.id, requireUuid(id));
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoutineDto,
  ): Promise<RoutineDto> {
    return this.routines.update(user.id, requireUuid(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.routines.remove(user.id, requireUuid(id));
  }

  @Post(':id/items')
  @Header('Cache-Control', 'no-store')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRoutineItemDto,
  ): Promise<RoutineItemDto> {
    return this.routines.addItem(user.id, requireUuid(id), dto);
  }

  @Patch(':id/items/:itemId')
  @Header('Cache-Control', 'no-store')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateRoutineItemDto,
  ): Promise<RoutineItemDto> {
    return this.routines.updateItem(user.id, requireUuid(id), requireUuid(itemId, 'itemId'), dto);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(204)
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    return this.routines.removeItem(user.id, requireUuid(id), requireUuid(itemId, 'itemId'));
  }
}
