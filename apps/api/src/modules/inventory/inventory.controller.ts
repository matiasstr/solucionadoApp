import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { requireUuid } from '../../common/query';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CreateInventoryDto, SetInventoryQuantityDto } from './inventory.dto';
import { InventoryService } from './inventory.service';
import type { InventoryItemDto, InventoryListDto } from './inventory.service';

/** Despensa privada: requiere sesión y solo ve las filas del usuario del token. */
@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<InventoryListDto> {
    return { items: await this.inventory.list(user.id) };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInventoryDto): Promise<InventoryItemDto> {
    return this.inventory.create(user.id, dto);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetInventoryQuantityDto,
  ): Promise<InventoryItemDto> {
    return this.inventory.update(user.id, requireUuid(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.inventory.remove(user.id, requireUuid(id));
  }
}
