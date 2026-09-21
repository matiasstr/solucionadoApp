/** Registros de comercios expuestos por los repositorios: coordenadas como texto decimal. */

export interface StoreChainRecord {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
}

export interface StoreRecord {
  readonly id: string;
  readonly chainId: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  /** Null cuando la sucursal solo tiene localidad: no habilita informar distancias. */
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly isActive: boolean;
}

/** Sucursal con el nombre de su cadena: lo que necesita mostrar un precio. */
export interface StoreSummaryRecord extends StoreRecord {
  readonly chainName: string;
}
