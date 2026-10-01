'use client';

import type { AlertCondition, ProductDetailDto } from '@tusofertas/shared';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CONDITION_LABEL, packageEquivalent, parsePriceInput, perUnitLabel } from '../../lib/alerts/format';
import { useAlerts, useCreateAlert } from '../../lib/alerts/queries';
import { useAuth } from '../../lib/auth/auth-provider';
import { formatArs, formatQuantity } from '../../lib/format';
import { describedBy, FieldError, FormAlert } from '../account/form-parts';

const CONDITIONS: readonly AlertCondition[] = ['TARGET_PRICE', 'HISTORIC_LOW', 'GOOD_DEAL'];
/** Destino de "Crear alerta" desde el buscador. */
export const ALERT_ANCHOR = 'crear-alerta';

/**
 * "Avisame cuando…" en la ficha del producto (P9-02). La alerta vigila el genérico: con
 * esta presentación sola o también sus alternativas. El precio objetivo es por kilo, litro
 * o unidad (lo que hace comparables las presentaciones) y se muestra el equivalente del envase.
 * El aviso aparece en la bandeja de la app: no se promete un email.
 */
export function AlertCreator({ product }: { product: ProductDetailDto }) {
  const { state } = useAuth();
  const sectionRef = useRef<HTMLElement>(null);

  // Llegar desde el buscador con #crear-alerta: la ficha carga después, así que se lleva el foco acá.
  useEffect(() => {
    if (window.location.hash === `#${ALERT_ANCHOR}`) {
      sectionRef.current?.scrollIntoView({ block: 'start' });
      sectionRef.current?.focus();
    }
  }, []);

  return (
    <section id={ALERT_ANCHOR} ref={sectionRef} tabIndex={-1} className="alert-creator" aria-labelledby="alert-creator-title">
      <h2 id="alert-creator-title">Avisame cuando baje</h2>
      {!product.canonicalProduct && (
        <p className="muted">Este producto todavía no está agrupado con equivalentes: no podemos seguir su precio con una alerta.</p>
      )}
      {product.canonicalProduct && state.status === 'anonymous' && (
        <p className="muted">
          <Link className="text-link" href={`/login?next=${encodeURIComponent(`/producto/${product.id}#${ALERT_ANCHOR}`)}`}>Ingresá</Link>{' '}
          para crear una alerta de precio de este producto.
        </p>
      )}
      {product.canonicalProduct && state.status === 'authenticated' && <AlertForm product={product} />}
    </section>
  );
}

function AlertForm({ product }: { product: ProductDetailDto }) {
  const canonical = product.canonicalProduct!;
  const unit = canonical.defaultUnit;
  const id = useId();
  const alerts = useAlerts();
  const create = useCreateAlert();
  const [condition, setCondition] = useState<AlertCondition>('TARGET_PRICE');
  const [onlyThis, setOnlyThis] = useState(false);
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const existing = alerts.data?.items.filter((alert) => alert.canonicalProduct.id === canonical.id).length ?? 0;
  const parsed = parsePriceInput(price);
  // Por peso o en envase de exactamente 1 kilo/litro/unidad el equivalente no agrega nada.
  const rawEquivalent = parsed && product.saleMode === 'PACKAGED' ? packageEquivalent(Number(parsed), product.quantity, product.unit) : null;
  const equivalent = rawEquivalent !== null && rawEquivalent.toFixed(2) !== Number(parsed).toFixed(2) ? rawEquivalent : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setCreated(false);
    if (condition === 'TARGET_PRICE' && !parsed) {
      setPriceError(`Escribí el precio por ${perUnitLabel(unit)}, por ejemplo 1500 o 1500,50 (sin puntos de miles).`);
      return;
    }
    setPriceError(undefined);
    try {
      await create.mutateAsync({
        canonicalProductId: canonical.id,
        condition,
        productId: product.id,
        allowSubstitutes: !onlyThis,
        ...(condition === 'TARGET_PRICE' ? { targetUnitPrice: parsed, targetUnit: unit } : {}),
      });
      setCreated(true);
      setPrice('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No pudimos crear la alerta.');
    }
  }

  return (
    <form className="alert-form" onSubmit={onSubmit} noValidate>
      <FormAlert message={formError} />
      {existing > 0 && (
        <p className="muted">
          Ya tenés {existing === 1 ? 'una alerta' : `${existing} alertas`} para {canonical.name.toLowerCase()}.{' '}
          <Link className="text-link" href="/alertas">Ver tus alertas</Link>
        </p>
      )}
      <fieldset className="choice-group">
        <legend>¿Cuándo te avisamos?</legend>
        <div className="choice-options">
          {CONDITIONS.map((option) => (
            <label key={option} className="choice-option">
              <input type="radio" name={`${id}-condition`} value={option} checked={condition === option} onChange={() => setCondition(option)} />
              <span>{CONDITION_LABEL[option]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {condition === 'TARGET_PRICE' ? (
        <div className="field alert-price-field">
          <label htmlFor={`${id}-price`}>Precio objetivo por {perUnitLabel(unit)}</label>
          <input
            id={`${id}-price`}
            inputMode="decimal"
            autoComplete="off"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            aria-invalid={Boolean(priceError)}
            aria-describedby={describedBy(`${id}-price-hint`, priceError && `${id}-price-error`)}
          />
          <p id={`${id}-price-hint`} className="field-hint">
            Comparamos por {perUnitLabel(unit)} para poder mirar presentaciones distintas.
            {equivalent !== null && ` Equivale a ${formatArs(equivalent.toFixed(2))} por este envase de ${formatQuantity(product.quantity, product.unit)}.`}
          </p>
          <FieldError id={`${id}-price-error`} message={priceError} />
        </div>
      ) : (
        <p className="field-hint">
          {condition === 'HISTORIC_LOW'
            ? 'Te avisamos cuando el precio quede por debajo de todo lo que vimos en los últimos 30 días.'
            : 'Te avisamos cuando esté bastante por debajo de su promedio de los últimos 30 días (o en su mínimo).'}{' '}
          Hace falta al menos una semana de precios para compararlo.
        </p>
      )}

      <label className="check-field">
        <input type="checkbox" checked={onlyThis} onChange={(event) => setOnlyThis(event.target.checked)} />
        <span>Solo esta presentación: {product.name}. Si no la marcás, también te avisamos por una alternativa equivalente y te lo decimos.</span>
      </label>

      <button type="submit" className="primary-button" disabled={create.isPending}>
        {create.isPending ? 'Creando…' : 'Crear alerta'}
      </button>
      <p className="field-hint">
        Usamos precios recientes de las sucursales de tu zona, sin promociones ni descuentos de bancos, billeteras o socios
        (esos dependen de cómo pagás y los calcula tu plan). El aviso aparece en tu bandeja de Tus Ofertas:
        no enviamos emails ni mensajes al celular.
      </p>
      <p role="status" className="alert-created">
        {created && (
          <>
            Alerta creada. <Link className="text-link" href="/alertas">Ver tus alertas y avisos</Link>
          </>
        )}
      </p>
    </form>
  );
}
