import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../../config/environment';
import type { ApiConfig } from '../../../config/environment';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { toAmountString } from '../../catalog/infrastructure/decimal-mapper';
import { ProductRepository } from '../../catalog/infrastructure/product.repository';
import { CurrentPriceAnalysis } from '../../prices/application/current-price-analysis';
import { StoreScopeResolver } from '../../stores/application/resolve-store-scope.use-case';
import type { ResolvedStoreScope } from '../../stores/application/resolve-store-scope.use-case';
import { StoreRepository } from '../../stores/infrastructure/store.repository';
import { alertEventKey, decide, eligibleProducts, evaluateRule } from '../domain/alert-evaluation';
import type { AlertOutcome, CandidatePrice, Evaluation, RuleForEvaluation } from '../domain/alert-evaluation';
import type { AlertCondition } from '../domain/alert-rules';
import { buildNotificationContent } from '../domain/notification-content';
import type { NotificationContent } from '../domain/notification-content';

/** Sucursales más cercanas (o de la localidad) por alerta, como en las oportunidades del dashboard. */
const MAX_ALERT_STORES = 20;
const USERS_PAGE = 100;

export interface PriceAlertsRunResult {
  readonly users: number;
  readonly rules: number;
  readonly notified: number;
  /** Resultado por regla (`NOTIFIED`, `NO_FRESH_PRICES`, `COOLDOWN`, …): cantidades, sin datos de usuarios. */
  readonly outcomes: Readonly<Record<string, number>>;
}

/** Evaluación de una regla, todavía sin aplicar. */
export interface PendingAlert {
  readonly ruleId: string;
  readonly userId: string;
  /** Versión de la regla que se evaluó. */
  readonly revision: number;
  readonly condition: AlertCondition;
  readonly evaluation: Evaluation;
  readonly notification: (NotificationContent & { readonly eventKey: string }) | null;
}

type RuleRow = Prisma.PriceAlertRuleGetPayload<{
  include: { canonicalProduct: { select: { id: true; name: true } }; product: { select: { id: true; name: true } } };
}>;

const toRuleInput = (rule: RuleRow): RuleForEvaluation => ({
  condition: rule.condition,
  canonicalProductId: rule.canonicalProductId,
  productId: rule.productId,
  allowSubstitutes: rule.allowSubstitutes,
  excludedBrands: rule.excludedBrands,
  targetUnitPrice: rule.targetUnitPrice === null ? null : toAmountString(rule.targetUnitPrice, 6),
  targetUnit: rule.targetUnit,
});

/**
 * Job `CHECK_PRICE_ALERTS` (P9-01, ADR 0022). Para cada persona con alertas activas: resuelve
 * sus sucursales (coordenadas y radio de la alerta o de sus preferencias, o su localidad),
 * analiza los precios actuales con el mismo servicio que el dashboard y evalúa cada regla.
 * Después aplica cada evaluación en una transacción que **bloquea la regla** y relee su estado:
 * una regla pausada, borrada o editada mientras tanto no avisa, y dos procesos a la vez no
 * generan dos avisos (además, la misma observación es única por regla en la base).
 */
@Injectable()
export class EvaluatePriceAlertsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductRepository,
    private readonly currentPrices: CurrentPriceAnalysis,
    private readonly stores: StoreRepository,
    private readonly storeScope: StoreScopeResolver,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async run(options: { readonly now: Date; readonly userId?: string | null }): Promise<PriceAlertsRunResult> {
    let users = 0;
    let rules = 0;
    let notified = 0;
    const outcomes: Record<string, number> = {};
    for await (const userId of this.usersWithActiveRules(options.userId ?? null)) {
      users += 1;
      for (const pending of await this.evaluateUser(userId, options.now)) {
        rules += 1;
        const outcome = await this.apply(pending, options.now);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        if (outcome === 'NOTIFIED') notified += 1;
      }
    }
    return { users, rules, notified, outcomes };
  }

  /** Evalúa las alertas activas de una persona sin escribir nada. */
  async evaluateUser(userId: string, now: Date): Promise<PendingAlert[]> {
    const [user, rules] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { latitude: true, longitude: true, city: true, province: true, maxTravelDistanceKm: true },
      }),
      this.prisma.priceAlertRule.findMany({
        where: { userId, active: true },
        include: { canonicalProduct: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    if (!user || !rules.length) return [];
    const pending = (rule: RuleRow, evaluation: Evaluation, notification: PendingAlert['notification'] = null): PendingAlert => ({
      ruleId: rule.id,
      userId,
      revision: rule.revision,
      condition: rule.condition,
      evaluation,
      notification,
    });
    const coordinates = user.latitude !== null && user.longitude !== null
      ? { latitude: Number(user.latitude.toString()), longitude: Number(user.longitude.toString()) }
      : null;
    const locality = user.city && user.province ? { city: user.city, province: user.province } : null;
    if (!coordinates && !locality) return rules.map((rule) => pending(rule, { kind: 'NO_LOCATION' }));

    // Una resolución de sucursales por radio distinto (con localidad, una sola).
    const scopes = new Map<string, ResolvedStoreScope>();
    const scopeOf = new Map<string, { storeIds: string[]; distances: ReadonlyMap<string, number> }>();
    for (const rule of rules) {
      const radiusKm = coordinates ? Number((rule.radiusKm ?? user.maxTravelDistanceKm).toString()) : null;
      const key = String(radiusKm);
      let scope = scopes.get(key);
      if (!scope) {
        scope = await this.storeScope.resolve(coordinates ? { ...coordinates, radiusKm: radiusKm ?? undefined } : (locality ?? {}));
        scopes.set(key, scope);
      }
      scopeOf.set(rule.id, { storeIds: (scope.storeIds ?? []).slice(0, MAX_ALERT_STORES), distances: scope.distances });
    }

    const catalog = await this.products.listByCanonicalProducts([...new Set(rules.map((rule) => rule.canonicalProductId))]);
    const productIds = new Set(rules.flatMap((rule) => eligibleProducts(toRuleInput(rule), catalog).map((product) => product.id)));
    const storeIds = new Set([...scopeOf.values()].flatMap((scope) => scope.storeIds));
    const prices: CandidatePrice[] = (await this.currentPrices.analyze([...productIds], [...storeIds], now)).map(({ latest, analysis }) => ({
      productId: latest.productId,
      storeId: latest.storeId,
      source: latest.source,
      price: latest.price,
      unitPrice: latest.unitPrice,
      unitPriceUnit: latest.unitPriceUnit,
      currency: latest.currency,
      observedAt: latest.observedAt,
      analysis,
    }));

    const evaluations = rules.map((rule) => {
      const scope = scopeOf.get(rule.id) as { storeIds: string[]; distances: ReadonlyMap<string, number> };
      if (!scope.storeIds.length) return { rule, evaluation: { kind: 'NO_STORES_IN_SCOPE' } as Evaluation };
      const inScope = new Set(scope.storeIds);
      return { rule, evaluation: evaluateRule(toRuleInput(rule), catalog, prices.filter((price) => inScope.has(price.storeId)), scope.distances) };
    });
    const matchedStores = evaluations.flatMap(({ evaluation }) => (evaluation.kind === 'MATCH' ? [evaluation.match.storeId] : []));
    const storesById = new Map((await this.stores.findManyByIds([...new Set(matchedStores)])).map((store) => [store.id, store]));
    const productsById = new Map(catalog.map((product) => [product.id, product]));

    return evaluations.map(({ rule, evaluation }) => {
      if (evaluation.kind !== 'MATCH') return pending(rule, evaluation);
      const { match } = evaluation;
      const product = productsById.get(match.productId);
      const store = storesById.get(match.storeId);
      // Sucursal o producto que dejaron de existir entre consultas: no se avisa con datos incompletos.
      if (!product || !store) return pending(rule, { kind: 'NO_FRESH_PRICES' });
      const content = buildNotificationContent({
        condition: rule.condition,
        match,
        canonical: rule.canonicalProduct,
        product: { id: product.id, name: product.name, brand: product.brand },
        preferredProduct: rule.product,
        store: {
          id: store.id,
          name: store.name,
          chainName: store.chainName,
          distanceMeters: (scopeOf.get(rule.id)?.distances.get(store.id)) ?? null,
        },
        target: rule.targetUnitPrice !== null && rule.targetUnit !== null ? { unitPrice: toAmountString(rule.targetUnitPrice, 2), unit: rule.targetUnit } : null,
      });
      return pending(rule, evaluation, { ...content, eventKey: alertEventKey(rule.condition, match) });
    });
  }

  /** Aplica una evaluación con el estado vigente de la regla, bloqueada hasta terminar. */
  async apply(pending: PendingAlert, now: Date): Promise<AlertOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ active: boolean; revision: number; notifiedUnitPrice: string | null; lastNotifiedAt: Date | null }[]>`
        SELECT "active", "revision", "notifiedUnitPrice"::text AS "notifiedUnitPrice", "lastNotifiedAt"
        FROM "PriceAlertRule" WHERE "id" = ${pending.ruleId}::uuid FOR UPDATE`;
      if (!locked) return 'RULE_DELETED';
      const decision = decide(pending.evaluation, locked, pending.revision, now, this.config.alerts.cooldownHours);
      if (decision.action === 'SKIP') return decision.outcome;
      let outcome: AlertOutcome = decision.outcome;
      if (decision.action === 'NOTIFY' && pending.notification) {
        const { eventKey, title, message, link, snapshot } = pending.notification;
        const { count } = await tx.notification.createMany({
          data: [{ userId: pending.userId, ruleId: pending.ruleId, kind: 'PRICE_ALERT', eventKey, title, message, link, snapshot: snapshot as Prisma.InputJsonValue }],
          skipDuplicates: true,
        });
        // La misma observación ya generó un aviso de esta regla (índice único): no se repite.
        if (count === 0) outcome = 'ALREADY_NOTIFIED';
      }
      const setNotified = decision.notifiedUnitPrice !== undefined;
      const notifiedUnitPrice = decision.notifiedUnitPrice ?? null;
      // SQL directo: la evaluación no es una edición del usuario y no mueve `updatedAt`.
      await tx.$executeRaw`
        UPDATE "PriceAlertRule" SET
          "lastEvaluatedAt" = ${now},
          "lastOutcome" = ${outcome},
          "notifiedUnitPrice" = CASE WHEN ${setNotified} THEN ${notifiedUnitPrice}::numeric ELSE "notifiedUnitPrice" END,
          "lastNotifiedAt" = CASE WHEN ${outcome === 'NOTIFIED'} THEN ${now} ELSE "lastNotifiedAt" END
        WHERE "id" = ${pending.ruleId}::uuid`;
      return outcome;
    });
  }

  /** Por páginas y en orden de id: no carga todos los usuarios en memoria. */
  private async *usersWithActiveRules(only: string | null): AsyncGenerator<string> {
    let after: string | null = null;
    for (;;) {
      const idFilter: { equals: string } | { gt: string } | undefined = only ? { equals: only } : after ? { gt: after } : undefined;
      const rows: { id: string }[] = await this.prisma.user.findMany({
        where: { id: idFilter, priceAlertRules: { some: { active: true } } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: USERS_PAGE,
      });
      for (const row of rows) yield row.id;
      if (only || rows.length < USERS_PAGE) return;
      after = rows[rows.length - 1]!.id;
    }
  }
}
