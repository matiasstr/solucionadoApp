import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../../common/public-http.exception';
import { CanonicalProductRepository } from '../infrastructure/canonical-product.repository';
import { CategoryRepository } from '../infrastructure/category.repository';
import { ProductRepository } from '../infrastructure/product.repository';
import type { ProductDetailDto } from '../presentation/catalog.contracts';
import { toCanonicalProductDto, toCategoryDto, toProductDto } from '../presentation/catalog.mappers';

const notFound = () => new PublicHttpException(404, 'NOT_FOUND', 'No encontramos ese producto.');

/** Ficha de una presentación concreta, con su categoría y su canónico si lo tiene. */
@Injectable()
export class GetProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly canonicalProducts: CanonicalProductRepository,
  ) {}

  async execute(productId: string): Promise<ProductDetailDto> {
    const product = await this.products.findById(productId);
    // Un producto desactivado deja de ser parte del catálogo público.
    if (!product || !product.isActive) throw notFound();

    const [category, canonical] = await Promise.all([
      this.categories.findById(product.categoryId),
      product.canonicalProductId ? this.canonicalProducts.findById(product.canonicalProductId) : Promise.resolve(null),
    ]);
    if (!category) throw notFound();

    return {
      ...toProductDto(product),
      category: toCategoryDto(category),
      canonicalProduct: canonical ? toCanonicalProductDto(canonical) : null,
    };
  }
}
