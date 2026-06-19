import { AsyncLocalStorage } from "async_hooks";

export type RequestContext = {
  requestId: string;
  userId?: string;
  organizationId?: string;
  method?: string;
  path?: string;
};

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function syncRequestContextFromAuth(req: {
  auth?: { sub: string; org: string };
}): void {
  const store = requestContextStorage.getStore();
  if (!store || !req.auth) return;
  store.userId = req.auth.sub;
  store.organizationId = req.auth.org;
}

export function contextFromStore(): Record<string, unknown> {
  const ctx = getRequestContext();
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    method: ctx.method,
    path: ctx.path,
  };
}
