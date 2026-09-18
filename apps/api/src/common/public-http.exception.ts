import { HttpException } from '@nestjs/common';

/** Error con mensaje pensado para el usuario. `fields` nombra propiedades, nunca valores. */
export class PublicHttpException extends HttpException {
  constructor(
    status: number,
    readonly error: string,
    readonly publicMessage: string,
    readonly fields?: readonly string[],
  ) {
    super(publicMessage, status);
  }
}
