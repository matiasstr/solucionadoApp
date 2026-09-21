import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { CanonicalProductRepository } from '../infrastructure/canonical-product.repository';
import { CategoryRepository } from '../infrastructure/category.repository';
import { ProductRepository } from '../infrastructure/product.repository';
import type { CanonicalProductDetailDto } from '../presentation/catalog.contracts';
import { toCanonicalProductDto, toCategoryDto, toProductDto } from '../presentation/catalog.mappers';

const notFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto canónico.');

/** Necesidad equivalente con sus alternativas; la UI decide qué es exacto y qué sustituto. */
@Injectable()
export class GetCanonicalProductUseCase {
  constructor(
    private readonly canonicalProducts: CanonicalProductRepository,
    private readonly categories: CategoryRepository,
    private readonly products: ProductRepository,
  ) {}

  async execute(canonicalProductId: string): Promise<CanonicalProductDetailDto> {
    const canonical = await this.canonicalProducts.findById(canonicalProductId);
    if (!canonical) throw notFound();

    const [category, alternatives] = await Promise.all([
      this.categories.findById(canonical.categoryId),
      this.products.listByCanonicalProduct(canonical.id),
    ]);
    if (!category) throw notFound();

    return {
      ...toCanonicalProductDto(canonical),
      category: toCategoryDto(category),
      products: alternatives.map(toProductDto),
    };
  }
}
