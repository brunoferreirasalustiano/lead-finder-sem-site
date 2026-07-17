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
  authenticationSource: 'BEARER_TOKEN';
}>;

declare module 'fastify' {
  interface FastifyRequest {
    principal?: OperationalPrincipal;
  }
}

type RoutePolicy = Readonly<{ method: string; path: string; permission: Permission }>;
const policy = (method: string, path: string, permission: Permission): RoutePolicy => ({ method, path, permission });

export const publicRoutes = new Set(['GET /health/live', 'GET /health', 'GET /health/ready']);
export const routePolicies: readonly RoutePolicy[] = [
  policy('GET', '/internal/operational-snapshot', 'operations:read'),
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
  policy('POST', '/collect', 'collection:execute'),
  policy('GET', '/leads/export.csv', 'leads:export'),
];

const policiesByRoute = new Map(routePolicies.map((item) => [`${item.method} ${item.path}`, item.permission]));
if (policiesByRoute.size !== routePolicies.length) throw new Error('Duplicate API route authorization policy');

export type AuthenticationOptions = Readonly<{
  token?: string;
  principalId?: string;
  principalPermissions?: readonly Permission[];
  authenticate?: (request: FastifyRequest) => OperationalPrincipal | undefined | Promise<OperationalPrincipal | undefined>;
}>;

const authenticateBearer = (authorization: string | undefined, options: AuthenticationOptions) => {
  const match = authorization?.match(/^Bearer ([\x21-\x7e]+)$/i);
  if (!match || !options.token) return undefined;
  const provided = createHash('sha256').update(match[1]!, 'utf8').digest();
  const expected = createHash('sha256').update(options.token, 'utf8').digest();
  if (!timingSafeEqual(provided, expected)) return undefined;
  return {
    id: options.principalId ?? 'single-operator',
    type: 'OPERATOR' as const,
    permissions: new Set(options.principalPermissions ?? []),
    authenticationSource: 'BEARER_TOKEN' as const,
  };
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
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) if (method !== 'HEAD') registeredRoutes.add(`${method} ${route.url}`);
  });
  app.addHook('onReady', () => {
    const unclassified = [...registeredRoutes].filter((route) => !publicRoutes.has(route) && !policiesByRoute.has(route));
    if (unclassified.length > 0) throw new Error(`API routes require an explicit authorization policy: ${unclassified.join(', ')}`);
  });
  app.addHook('onRequest', async (request, reply) => {
    const routeKey = `${request.method} ${request.routeOptions.url ?? ''}`;
    if (publicRoutes.has(routeKey)) return;

    let principal: OperationalPrincipal | undefined;
    try {
      principal = options.authenticate
        ? await options.authenticate(request)
        : authenticateBearer(request.headers.authorization, options);
    } catch {
      request.log.warn({ event: 'authentication_failed', requestId: request.id, code: 'UNAUTHENTICATED' }, 'authentication_failed');
      return unauthenticated(reply);
    }
    if (!principal) return unauthenticated(reply);

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
