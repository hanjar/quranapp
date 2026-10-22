import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('routes', () => {
  it('has a lazy /doa-khatam page placed before the verse-link catch-alls', async () => {
    const i = routes.findIndex((r) => r.path === 'doa-khatam');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(routes.findIndex((r) => r.path === ':surah'));
    expect(routes[i].title).toBe('Doa Khatam · Mushaf Digital');
    const cmp = await (routes[i].loadComponent as () => Promise<unknown>)();
    expect(cmp).toBeTruthy();
  });
});
