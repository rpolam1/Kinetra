import { useEffect, useState } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/** Match a path against a pattern such as /patients/:id/:tab?. Returns the named parts, or null when it does not match. A part that ends in a question mark is optional. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const segment = want[i]!;
    const optional = segment.startsWith(':') && segment.endsWith('?');
    if (i >= have.length) {
      if (optional) continue;
      return null;
    }
    if (segment.startsWith(':')) {
      params[segment.slice(1).replace(/\?$/, '')] = decodeURIComponent(have[i]!);
    } else if (segment !== have[i]) {
      return null;
    }
  }
  return have.length > want.length ? null : params;
}

/** The path from the URL hash. The app uses hash routes, so it works from any static host without server rules. */
export function currentPath(hash: string = window.location.hash): string {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  return path === '' ? '/' : path;
}

/** Go to a page. With replace set the current history entry is replaced, so the back button skips it. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = `#${to}`;
  if (options.replace) window.location.replace(url);
  else window.location.hash = to;
}

/** The current path, updated when the hash changes. */
export function useCurrentPath(): string {
  const [path, setPath] = useState(() => currentPath());
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export interface RouteDef {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}

/** Show the first route that matches the path, or the not found content. */
export function Router({ routes, notFound }: { routes: readonly RouteDef[]; notFound: ReactNode }) {
  const path = useCurrentPath();
  for (const route of routes) {
    const params = matchRoute(route.pattern, path);
    if (params) return <>{route.render(params)}</>;
  }
  return <>{notFound}</>;
}

/** A link to a page inside the app. */
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

/** Go to another page as soon as this is shown. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
