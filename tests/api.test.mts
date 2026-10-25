import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Context } from '@netlify/functions';

test('facilitator access and session lifecycle', async (t) => {
  let password: string | undefined = randomBytes(32).toString('hex');
  Object.assign(globalThis, { Netlify: { env: { get: () => password } } });
  let selected: unknown[] = [];
  let count = 1;
  const inserted: { table: unknown; value: any }[] = [];
  let deletes = 0;
  mock.module('drizzle-orm/netlify-db', { namedExports: { drizzle: () => ({
    select: () => ({ from: () => ({ where: async () => selected, then: (resolve: Function) => resolve(selected) }) }),
    delete: () => { deletes++; return { where: async () => [] }; },
    insert: (table: unknown) => ({ values: (value: any) => {
      inserted.push({ table, value });
      return { then: (resolve: Function) => resolve([]), onConflictDoUpdate: () => ({ returning: async () => [{ count }] }) };
    } }),
  }) } });
  const { default: handler } = await import('../netlify/functions/api.mts');
  const context = { ip: '127.0.0.1' } as Context;
  const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => handler(new Request('https://example.test/api/' + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }), context);

  await t.test('rejects unauthenticated board reads and resets', async () => {
    assert.equal((await call('board')).status, 401);
    assert.equal((await call('board', 'DELETE')).status, 401);
    assert.equal(deletes, 0);
  });
  await t.test('rejects cross-site login', async () => {
    assert.equal((await call('login', 'POST', { password }, { origin: 'https://elsewhere.test' })).status, 403);
  });
  await t.test('rejects incorrect passwords and limits attempts', async () => {
    assert.equal((await call('login', 'POST', { password: '' })).status, 401);
    count = 11;
    assert.equal((await call('login', 'POST', { password })).status, 429);
    count = 1;
  });
  let cookie = '';
  await t.test('creates a secure cookie and stores only a session digest', async () => {
    const response = await call('login', 'POST', { password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie')!;
    assert.ok(cookie.includes('HttpOnly; Secure; SameSite=Strict; Path=/'));
    assert.ok(cookie.includes('Max-Age=43200'));
    const session = inserted.at(-1)!.value;
    assert.equal(session.id.length, 64);
    assert.notEqual(session.id, cookie.split(';')[0].slice(4));
    assert.ok(session.expires > Date.now());
  });
  await t.test('rejects a revoked session and clears logout cookies', async () => {
    selected = [];
    assert.equal((await call('board', 'GET', undefined, { cookie })).status, 401);
    const response = await call('logout', 'POST', undefined, { cookie });
    assert.equal(response.status, 204);
    assert.ok(response.headers.get('set-cookie')!.includes('Max-Age=0'));
  });
  await t.test('serves the board for an authorized session', async () => {
    selected = [{ data: { team: 'Prueba' }, updated: 123 }];
    const response = await call('board', 'GET', undefined, { cookie });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rows, [{ team: 'Prueba', updated: 123 }]);
    selected = [];
  });
  await t.test('accepts team progress without granting board access', async () => {
    const response = await call('progress', 'POST', { pid: 'team-test-123', data: { team: 'Prueba', opened: [1, 1, 9], pts: 999 } });
    assert.equal(response.status, 204);
    const record = inserted.at(-1)!.value;
    assert.deepEqual(record.data.opened, [1]);
    assert.equal(record.data.pts, null);
    assert.equal((await call('board')).status, 401);
    assert.equal((await call('progress', 'POST', { pid: 'bad' })).status, 400);
  });
  await t.test('fails closed when password configuration is missing', async () => {
    password = undefined;
    assert.equal((await call('login', 'POST', {})).status, 503);
    assert.equal((await call('board')).status, 503);
  });
});
