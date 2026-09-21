/** Errores de dominio del catálogo. La capa HTTP (P2-02) los traduce a respuestas públicas. */
export type CatalogErrorCode =
  | 'CATEGORY_PARENT_SELF'
  | 'CATEGORY_CYCLE'
  | 'CATEGORY_NOT_FOUND'
  | 'CANONICAL_NOT_FOUND'
  | 'DIMENSION_MISMATCH'
  | 'QUANTITY_INVALID'
  | 'PACKAGE_COUNT_INVALID'
  | 'EAN_INVALID'
  | 'PRODUCT_NOT_FOUND'
  | 'STORE_COORDINATES'
  | 'STORE_NOT_FOUND';

export class CatalogValidationError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = 'CatalogValidationError';
  }
}
