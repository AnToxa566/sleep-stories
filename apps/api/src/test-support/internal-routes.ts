import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { IS_INTERNAL_KEY } from '../app/auth/internal-route.key';
import { InternalAuthGuard } from '../app/internal/internal-auth.guard';

export interface DiscoveredRoute {
  // Controller class name and handler name, for the failure message.
  controller: string;
  handler: string;
  // The path as written in the decorators, joined, without the global prefix.
  path: string;
  isInternal: boolean;
  // InternalAuthGuard is among the guards of the handler or of the class (inherited ones
  // included).
  hasInternalGuard: boolean;
}

function pathsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [typeof value === 'string' ? value : ''];
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

// A route is internal when any path segment is `internal`, after the optional `api`
// global prefix. Any segment, not only the first, so that a nested or reordered path
// cannot slip past the check.
function isInternalPath(path: string): boolean {
  const segments = segmentsOf(path);
  const rest = segments[0] === 'api' ? segments.slice(1) : segments;
  return rest.includes('internal');
}

function guardsOf(target: object): unknown[] {
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
  return Array.isArray(guards) ? guards : [];
}

// Exactly the class InternalAuthGuard (an instance of it counts too), not just anything
// that looks like it.
const isInternalAuthGuard = (entry: unknown): boolean =>
  entry === InternalAuthGuard || entry instanceof InternalAuthGuard;

// Lists every controller method of the application with its path, whether it is marked
// with @InternalRoute() (IS_INTERNAL_KEY on the method or the class) and whether
// InternalAuthGuard is applied to it. Walks the prototype chain, so a handler inherited
// from a base controller is seen. Uses the module container, so it needs no extra module
// in the testing module.
export function listInternalRoutes(app: INestApplication): DiscoveredRoute[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer, { strict: false }));
  const routes: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as (new (...args: never[]) => object) | null;
    if (metatype === null || typeof metatype !== 'function') {
      continue;
    }
    const controllerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, metatype));
    const classMarked = Reflect.getMetadata(IS_INTERNAL_KEY, metatype) === true;
    const classGuarded = guardsOf(metatype).some(isInternalAuthGuard);
    const seen = new Set<string>();
    for (
      let proto: object | null = metatype.prototype as object;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name];
        if (name === 'constructor' || seen.has(name) || typeof handler !== 'function') {
          continue;
        }
        seen.add(name);
        // A controller method is a function with route metadata.
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
          continue;
        }
        const methodPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, handler));
        const methodMarked = Reflect.getMetadata(IS_INTERNAL_KEY, handler) === true;
        const methodGuarded = guardsOf(handler).some(isInternalAuthGuard);
        for (const controllerPath of controllerPaths) {
          for (const methodPath of methodPaths) {
            const path = [...segmentsOf(controllerPath), ...segmentsOf(methodPath)].join('/');
            routes.push({
              controller: metatype.name,
              handler: name,
              path,
              isInternal: classMarked || methodMarked,
              hasInternalGuard: classGuarded || methodGuarded,
            });
          }
        }
      }
    }
  }
  return routes;
}

// Throws, naming the route, when
// - a route under `internal` is not marked with @InternalRoute(): without the mark the
//   global user-JWT guard would be the only protection and a user token would open it, or
// - a route ANYWHERE carries the mark but not InternalAuthGuard: the mark makes the user
//   guard step aside, so such a route must not exist (the runtime check in JwtAuthGuard
//   also refuses to step aside for it; this catches it at test time).
// SECURITY.md rule 4. Returns the routes found under `internal`, so that a test can assert
// it found at least one.
export function assertInternalRoutesAreGuarded(app: INestApplication): DiscoveredRoute[] {
  const all = listInternalRoutes(app);
  const internalRoutes = all.filter((route) => isInternalPath(route.path));
  const describeRoute = (route: DiscoveredRoute) => `${route.controller}.${route.handler} (/${route.path})`;
  const unmarked = internalRoutes.filter((route) => !route.isInternal);
  if (unmarked.length > 0) {
    throw new Error(`Internal routes without @InternalRoute(): ${unmarked.map(describeRoute).join(', ')}`);
  }
  const markedWithoutGuard = all.filter((route) => route.isInternal && !route.hasInternalGuard);
  if (markedWithoutGuard.length > 0) {
    throw new Error(
      `Routes marked as internal without InternalAuthGuard: ${markedWithoutGuard.map(describeRoute).join(', ')}`,
    );
  }
  return internalRoutes;
}
