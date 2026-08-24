import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  apiAuthPermissions, createAuthorizationContext, type ApiAuthPermission, type AuthorizationContext,
} from '@lead-finder/shared';

export const serializeRequestForLog = (request: FastifyRequest) => ({
  method: request.method,
  url: request.url.split('?', 1)[0] ?? '',
  host: request.hostname,
  remoteAddress: request.ip,
  requestId: request.id,
});

export const permissions = apiAuthPermissions;
export type Permission = ApiAuthPermission;

export type OperationalPrincipal = Readonly<{
  id: string;
  type: 'OPERATOR';
  permissions: ReadonlySet<Permission>;
  authenticationSource:
    | 'BEARER_TOKEN'
    | 'HML_SMOKE_BEARER_TOKEN'
    | 'HML_OPERATOR_BEARER_TOKEN'
    | 'HML_OPPORTUNITY_REVIEW_BEARER_TOKEN'
    | 'HML_METRICS_BEARER_TOKEN'
    | 'HML_EMAIL_BEARER_TOKEN'
    | 'HML_DISCOVERY_BEARER_TOKEN'
    | 'HML_DAILY6_BEARER_TOKEN';
}>;

declare module 'fastify' {
  interface FastifyRequest {
    principal?: OperationalPrincipal;
  }
}

type RoutePolicy = Readonly<{ method: string; path: string; permission: Permission }>;
const policy = (method: string, path: string, permission: Permission): RoutePolicy => ({ method, path, permission });

export const publicRoutes = new Set(['GET /health/live', 'GET /health', 'GET /ready', 'GET /health/ready']);
const internallyAuthenticatedRoutes = new Set(['POST /internal/jobs/process-lead-batch']);
export const routePolicies: readonly RoutePolicy[] = [
  policy('GET', '/internal/operational-snapshot', 'operations:read'),
  policy('GET', '/internal/daily6/gmail-preflight', 'daily6:execute'),
  policy('GET', '/internal/daily6/gmail-config-diagnostics', 'daily6:execute'),
  policy('GET', '/internal/daily6/runtime-preflight', 'daily6:execute'),
  policy('GET', '/internal/daily6/whatsapp-opportunities', 'opportunity:read'),
  policy('GET', '/internal/dailywhatsapp/cnpj-opportunities', 'opportunity:read'),
  policy('GET', '/internal/prospecting/city-metrics', 'prospecting:metrics:read'),
  policy('GET', '/leads', 'leads:read'),
  policy('GET', '/leads/:id', 'leads:read'),
  policy('GET', '/leads/:id/qualification', 'leads:read'),
  policy('POST', '/leads/:id/evidence', 'crm:write'),
  policy('PUT', '/leads/:id/contacts', 'crm:write'),
  policy('GET', '/leads/:id/contacts', 'contacts:read'),
  policy('PATCH', '/leads/:id/qualification', 'crm:write'),
  policy('GET', '/leads/:id/history', 'leads:read'),
  policy('GET', '/leads/:id/crm', 'crm:read'),
  policy('PATCH', '/leads/:id/crm/stage', 'crm:write'),
  policy('PATCH', '/leads/:id/crm', 'crm:write'),
  policy('GET', '/leads/:id/opportunities', 'crm:read'),
  policy('POST', '/leads/:id/opportunities', 'crm:write'),
  policy('PATCH', '/opportunities/:id', 'crm:write'),
  policy('GET', '/leads/:id/notes', 'crm:read'),
  policy('POST', '/leads/:id/notes', 'crm:write'),
  policy('GET', '/leads/:id/tags', 'crm:read'),
  policy('PUT', '/leads/:id/tags/:tag', 'crm:write'),
  policy('DELETE', '/leads/:id/tags/:tag', 'crm:write'),
  policy('GET', '/leads/:id/tasks', 'crm:read'),
  policy('POST', '/leads/:id/tasks', 'crm:write'),
  policy('PATCH', '/tasks/:id/complete', 'crm:write'),
  policy('PATCH', '/tasks/:id/reschedule', 'crm:write'),
  policy('GET', '/leads/:id/timeline', 'crm:read'),
  policy('GET', '/crm/tasks/overdue', 'crm:read'),
  policy('GET', '/crm/follow-ups/upcoming', 'crm:read'),
  policy('POST', '/campaigns/preview', 'campaigns:read'),
  policy('POST', '/campaigns', 'campaigns:write'),
  policy('GET', '/campaigns/:id', 'campaigns:read'),
  policy('GET', '/campaigns', 'campaigns:read'),
  policy('POST', '/campaigns/:id/versions', 'campaigns:write'),
  policy('GET', '/campaigns/:id/versions', 'campaigns:read'),
  policy('GET', '/campaign-versions/:id/templates', 'campaigns:read'),
  policy('POST', '/campaign-versions/:id/submit', 'campaigns:write'),
  policy('POST', '/campaign-versions/:id/approve', 'campaigns:write'),
  policy('POST', '/campaigns/:id/activate', 'campaigns:write'),
  policy('POST', '/campaigns/:id/pause', 'campaigns:write'),
  policy('POST', '/campaigns/:id/resume', 'campaigns:write'),
  policy('POST', '/campaigns/:id/cancel', 'campaigns:write'),
  policy('GET', '/campaigns/eligible/leads', 'campaigns:read'),
  policy('POST', '/campaigns/:id/simulations', 'campaigns:write'),
  policy('GET', '/campaigns/:id/recipients', 'campaigns:read'),
  policy('GET', '/recipients/:id/attempts', 'campaigns:read'),
  policy('GET', '/campaigns/:id/audit', 'campaigns:read'),
  policy('GET', '/campaign-versions/:id/audit', 'campaigns:read'),
  policy('GET', '/campaigns/failures', 'campaigns:read'),
  policy('POST', '/pilots', 'pilot:write'),
  policy('GET', '/pilots', 'pilot:read'),
  policy('GET', '/pilots/:id', 'pilot:read'),
  policy('PATCH', '/pilots/:id/status', 'pilot:write'),
  policy('POST', '/pilots/:id/leads', 'pilot:write'),
  policy('POST', '/pilots/:id/leads/:leadId/review', 'pilot:review'),
  policy('POST', '/pilots/:id/leads/:leadId/manual-contacts', 'pilot:record-contact'),
  policy('POST', '/pilots/:id/leads/:leadId/results', 'pilot:record-result'),
  policy('GET', '/pilots/:id/snapshot', 'pilot:read'),
  policy('POST', '/pilots/:id/leads/:leadId/manual-messages/prepare', 'manual-messaging:prepare'),
  policy('POST', '/manual-message-preparations/:id/open', 'manual-messaging:open'),
  policy('GET', '/manual-message-preparations/:id/whatsapp-link', 'manual-messaging:open'),
  policy('POST', '/manual-message-preparations/:id/cancel', 'manual-messaging:cancel'),
  policy('POST', '/manual-message-preparations/:id/confirm', 'manual-messaging:confirm'),
  policy('POST', '/manual-message-preparations/:id/response', 'manual-messaging:confirm'),
  policy('POST', '/manual-message-preparations/:id/send', 'manual-messaging:send'),
  policy('POST', '/daily6/manual-message-preparations/:id/send', 'daily6:send'),
  policy('POST', '/manual-message-preparations/:id/whatsapp-cloud-send', 'manual-messaging:cloud-send'),
  policy('POST', '/operator-tests/whatsapp/preparations', 'operator-test:prepare'),
  policy('POST', '/operator-test-preparations/:id/open', 'operator-test:open'),
  policy('POST', '/operator-test-preparations/:id/confirm', 'operator-test:confirm'),
  policy('POST', '/operator-test-preparations/:id/response', 'operator-test:response'),
  policy('POST', '/operator-tests/email/send', 'operator-email-test:send'),
  policy('POST', '/internal/hml/suppression-probe', 'hml-suppression-probe:run'),
  policy('POST', '/internal/daily6/run-slot', 'daily6:execute'),
  policy('POST', '/collect', 'collection:execute'),
  policy('GET', '/leads/export.csv', 'leads:export'),
];

const policiesByRoute = new Map(routePolicies.map((item) => [`${item.method} ${item.path}`, item.permission]));
if (policiesByRoute.size !== routePolicies.length) throw new Error('Duplicate API route authorization policy');

export type TemporaryAuthentication = Readonly<{
  tokenHash: string;
  expiresAt: Date;
  principalId: string;
  principalPermissions: readonly Permission[];
  environment: 'homologation';
}>;

export type AuthenticationOptions = Readonly<{
  token?: string;
  principalId?: string;
  principalPermissions?: readonly Permission[];
  temporary?: TemporaryAuthentication;
  operatorTemporary?: TemporaryAuthentication;
  opportunityReviewTemporary?: TemporaryAuthentication;
  metricsTemporary?: TemporaryAuthentication;
  emailTemporary?: TemporaryAuthentication;
  discoveryTemporary?: TemporaryAuthentication;
  daily6Temporary?: TemporaryAuthentication;
  authenticate?: (request: FastifyRequest) => OperationalPrincipal | undefined | Promise<OperationalPrincipal | undefined>;
}>;

const tokenDigest = (token: string) => createHash('sha256').update(token, 'utf8').digest();
const matchesDigest = (provided: Buffer, expectedHex: string) => {
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === provided.length && timingSafeEqual(provided, expected);
};

const authenticateBearer = (authorization: string | undefined, options: AuthenticationOptions) => {
  const match = authorization?.match(/^Bearer ([\x21-\x7e]+)$/i);
  if (!match) return undefined;
  const provided = tokenDigest(match[1]!);
  if (options.token && timingSafeEqual(provided, tokenDigest(options.token))) {
    return {
      id: options.principalId ?? 'single-operator',
      type: 'OPERATOR' as const,
      permissions: new Set(options.principalPermissions ?? []),
      authenticationSource: 'BEARER_TOKEN' as const,
    };
  }
  const temporary = options.temporary;
  if (temporary && temporary.environment === 'homologation'
    && temporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, temporary.tokenHash)) {
    return {
      id: temporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(temporary.principalPermissions),
      authenticationSource: 'HML_SMOKE_BEARER_TOKEN' as const,
    };
  }
  const operatorTemporary = options.operatorTemporary;
  if (operatorTemporary && operatorTemporary.environment === 'homologation'
    && operatorTemporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, operatorTemporary.tokenHash)) {
    return {
      id: operatorTemporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(operatorTemporary.principalPermissions),
      authenticationSource: 'HML_OPERATOR_BEARER_TOKEN' as const,
    };
  }
  const opportunityReviewTemporary = options.opportunityReviewTemporary;
  if (opportunityReviewTemporary && opportunityReviewTemporary.environment === 'homologation'
    && opportunityReviewTemporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, opportunityReviewTemporary.tokenHash)) {
    return {
      id: opportunityReviewTemporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(opportunityReviewTemporary.principalPermissions),
      authenticationSource: 'HML_OPPORTUNITY_REVIEW_BEARER_TOKEN' as const,
    };
  }
  const metricsTemporary = options.metricsTemporary;
  if (metricsTemporary && metricsTemporary.environment === 'homologation'
    && metricsTemporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, metricsTemporary.tokenHash)) {
    return {
      id: metricsTemporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(metricsTemporary.principalPermissions),
      authenticationSource: 'HML_METRICS_BEARER_TOKEN' as const,
    };
  }
  const emailTemporary = options.emailTemporary;
  if (emailTemporary && emailTemporary.environment === 'homologation'
    && emailTemporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, emailTemporary.tokenHash)) {
    return {
      id: emailTemporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(emailTemporary.principalPermissions),
      authenticationSource: 'HML_EMAIL_BEARER_TOKEN' as const,
    };
  }
  const discoveryTemporary = options.discoveryTemporary;
  if (discoveryTemporary && discoveryTemporary.environment === 'homologation'
    && discoveryTemporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, discoveryTemporary.tokenHash)) {
    return {
      id: discoveryTemporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(discoveryTemporary.principalPermissions),
      authenticationSource: 'HML_DISCOVERY_BEARER_TOKEN' as const,
    };
  }
  const daily6Temporary = options.daily6Temporary;
  if (daily6Temporary && daily6Temporary.environment === 'homologation'
    && daily6Temporary.expiresAt.getTime() > Date.now() && matchesDigest(provided, daily6Temporary.tokenHash)) {
    return {
      id: daily6Temporary.principalId,
      type: 'OPERATOR' as const,
      permissions: new Set(daily6Temporary.principalPermissions),
      authenticationSource: 'HML_DAILY6_BEARER_TOKEN' as const,
    };
  }
  return undefined;
};

const unauthenticated = (reply: FastifyReply) =>
  reply.header('WWW-Authenticate', 'Bearer').status(401).send({ error: 'Authentication required', code: 'UNAUTHENTICATED' });

export function requirePermission(request: FastifyRequest, reply: FastifyReply, permission: Permission): boolean {
  if (!request.principal) {
    unauthenticated(reply);
    return false;
  }
  if (request.principal.permissions.has(permission)) return true;
  request.log.warn({
    event: 'authorization_denied', requestId: request.id, code: 'FORBIDDEN',
    principalId: request.principal.id, permission,
  }, 'authorization_denied');
  reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
  return false;
}

export function authorizationContextFor(request: FastifyRequest): AuthorizationContext {
  if (!request.principal) throw new Error('Authenticated principal is required');
  return createAuthorizationContext({
    principalId: request.principal.id,
    permissions: request.principal.permissions,
    authenticationMethod: request.principal.authenticationSource,
    requestId: request.id,
  });
}

export function installAuthorization(app: FastifyInstance, options: AuthenticationOptions = {}) {
  if (options.token && !options.authenticate && options.principalPermissions === undefined) {
    throw new Error('Bearer token authentication requires explicit principal permissions');
  }
  const registeredRoutes = new Set<string>();
  const failedTemporaryAuthentication = new Map<string, { count: number; resetAt: number }>();
  const temporaryRateLimit = (request: FastifyRequest) => {
    const now = Date.now();
    const activeTemporary = [
      options.temporary,
      options.operatorTemporary,
      options.opportunityReviewTemporary,
      options.metricsTemporary,
      options.emailTemporary,
      options.discoveryTemporary,
      options.daily6Temporary,
    ].find((candidate) => candidate && candidate.expiresAt.getTime() > now);
    if (!activeTemporary || activeTemporary.expiresAt.getTime() <= Date.now()) return false;
    const key = request.ip || 'unknown';
    const current = failedTemporaryAuthentication.get(key);
    if (!current || current.resetAt <= now) {
      failedTemporaryAuthentication.set(key, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    current.count += 1;
    return current.count > 5;
  };
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) if (method !== 'HEAD') registeredRoutes.add(`${method} ${route.url}`);
  });
  app.addHook('onReady', () => {
    const unclassified = [...registeredRoutes].filter((route) => !publicRoutes.has(route)
      && !internallyAuthenticatedRoutes.has(route) && !policiesByRoute.has(route));
    if (unclassified.length > 0) throw new Error(`API routes require an explicit authorization policy: ${unclassified.join(', ')}`);
  });
  app.addHook('onRequest', async (request, reply) => {
    const routeKey = `${request.method} ${request.routeOptions.url ?? ''}`;
    if (publicRoutes.has(routeKey) || internallyAuthenticatedRoutes.has(routeKey)) return;

    let principal: OperationalPrincipal | undefined;
    try {
      principal = options.authenticate
        ? await options.authenticate(request)
        : authenticateBearer(request.headers.authorization, options);
    } catch {
      request.log.warn({ event: 'authentication_failed', requestId: request.id, code: 'UNAUTHENTICATED' }, 'authentication_failed');
      return unauthenticated(reply);
    }
    if (!principal) {
      if (temporaryRateLimit(request)) return reply.status(429).send({ error: 'Authentication temporarily unavailable', code: 'AUTH_RATE_LIMITED' });
      return unauthenticated(reply);
    }
    if (principal.authenticationSource === 'HML_SMOKE_BEARER_TOKEN') {
      request.log.info({ event: 'hml_smoke_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_smoke_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_OPERATOR_BEARER_TOKEN') {
      request.log.info({ event: 'hml_operator_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_operator_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_OPPORTUNITY_REVIEW_BEARER_TOKEN') {
      request.log.info({ event: 'hml_opportunity_review_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_opportunity_review_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_METRICS_BEARER_TOKEN') {
      request.log.info({ event: 'hml_metrics_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_metrics_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_EMAIL_BEARER_TOKEN') {
      request.log.info({ event: 'hml_email_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_email_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_DISCOVERY_BEARER_TOKEN') {
      request.log.info({ event: 'hml_discovery_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_discovery_authentication_accepted');
    }
    if (principal.authenticationSource === 'HML_DAILY6_BEARER_TOKEN') {
      request.log.info({ event: 'hml_daily6_authentication_accepted', requestId: request.id, principalId: principal.id }, 'hml_daily6_authentication_accepted');
    }

    const requiredPermission = policiesByRoute.get(routeKey);
    request.principal = principal;
    if (!requiredPermission) {
      request.log.warn({
        event: 'authorization_denied', requestId: request.id, code: 'FORBIDDEN',
        principalId: principal.id, permission: 'UNCLASSIFIED_ROUTE',
      }, 'authorization_denied');
      return reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
    }
    if (!requirePermission(request, reply, requiredPermission)) return;
  });
}
