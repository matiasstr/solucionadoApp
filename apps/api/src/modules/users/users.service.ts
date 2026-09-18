import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/public-http.exception';
import { isPrismaError } from '../../database/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import type { UpdateProfileDto } from './update-profile.dto';
import { toUserProfile } from './user-profile';
import type { UserProfile } from './user-profile';

const invalid = (fields: string[]) =>
  new PublicHttpException(400, 'VALIDATION_FAILED', 'Revisá los datos ingresados.', fields);

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Token válido de una cuenta que ya no existe: se trata como sesión inválida.
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');
    return toUserProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const hasLatitude = dto.latitude !== undefined;
    if (hasLatitude !== (dto.longitude !== undefined) || (hasLatitude && (dto.latitude === null) !== (dto.longitude === null))) {
      throw invalid(['latitude', 'longitude']);
    }
    if (dto.latitude != null && Math.abs(Number(dto.latitude)) > 90) throw invalid(['latitude']);
    if (dto.longitude != null && Math.abs(Number(dto.longitude)) > 180) throw invalid(['longitude']);
    if (dto.maxTravelDistanceKm !== undefined && Number(dto.maxTravelDistanceKm) <= 0) {
      throw invalid(['maxTravelDistanceKm']);
    }

    // Solo campos explícitos del DTO; el userId sale del token, nunca del cuerpo.
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        city: dto.city,
        province: dto.province,
        latitude: dto.latitude,
        longitude: dto.longitude,
        maxTravelDistanceKm: dto.maxTravelDistanceKm,
        maxStoresPerShoppingPlan: dto.maxStoresPerShoppingPlan,
        storeVisitPenalty: dto.storeVisitPenalty,
        distancePenaltyPerKm: dto.distancePenaltyPerKm,
        paymentMethods: dto.paymentMethods,
        banks: dto.banks,
        membershipPrograms: dto.membershipPrograms,
      },
    }).catch((error: unknown) => {
      if (isPrismaError(error, 'P2025')) return null;
      throw error;
    });
    if (!user) throw new PublicHttpException(401, 'UNAUTHORIZED', 'Necesitás iniciar sesión.');
    return toUserProfile(user);
  }
}
