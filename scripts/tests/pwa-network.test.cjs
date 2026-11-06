const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

const corePath = 'apps/web-admin/src/app/core/';
function loadTs(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => mocks[name] ?? require(name),
    setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  });
  return module.exports;
}

function worker() {
  const handlers = new Map();
  const deleted = [];
  let claimed = false;
  let skipped = false;
  vm.runInNewContext(readFileSync('apps/web-admin/public/service-worker.js', 'utf8'), {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      keys: async () => ['barber-admin-runtime', 'barber-admin-v1', 'another-app'],
      delete: async (key) => { deleted.push(key); return true; },
    },
  });
  return { handlers, deleted, claimed: () => claimed, skipped: () => skipped };
}

test('worker retains install/push, clears historical caches and leaves network untouched', async () => {
  const w = worker();
  let pending;
  const event = { waitUntil: (promise) => { pending = promise; } };
  w.handlers.get('install')(event);
  await pending;
  assert.equal(w.skipped(), true);
  w.handlers.get('activate')(event);
  await pending;
  assert.deepEqual(w.deleted, ['barber-admin-runtime', 'barber-admin-v1', 'another-app']);
  assert.equal(w.handlers.has('push'), true);
  assert.equal(w.handlers.has('notificationclick'), true);
  assert.equal(w.claimed(), true);
  assert.equal(w.handlers.has('fetch'), false);
});

test('old application tabs receive the ALORA remote-only cache cleanup acknowledgement', async () => {
  const w = worker();
  let pending;
  let reply;
  w.handlers.get('message')({
    data: { type: 'CLEAR_CACHES' },
    ports: [{ postMessage: (value) => { reply = value; } }],
    waitUntil: (promise) => { pending = promise; },
  });
  await pending;
  assert.equal(reply.ok, true);
  assert.equal(reply.remoteOnly, true);
});

function facade(api) {
  const signal = (initial) => {
    let value = initial;
    const read = () => value;
    read.set = (next) => { value = next; };
    read.update = (fn) => { value = fn(value); };
    return read;
  };
  const { AdminFacade } = loadTs(corePath + 'admin.facade.ts', {
    '@angular/core': { Injectable: () => (cls) => cls, signal, computed: (fn) => fn, inject: (token) => token },
    './admin-api.service': { AdminApiService: api },
    './auth-api.service': { AuthApiService: {} },
    './session.store': { SessionStore: {} },
    './session-refresh.service': { SessionRefreshService: {} },
  });
  return new AdminFacade();
}

test('slow customer search cannot replace the newer results', async () => {
  const older = new rx.Subject();
  const newer = new rx.Subject();
  const f = facade({ loadCustomersPage: (_page, search) => search === 'old' ? older : newer });
  const oldRequest = f.reloadCustomers('old');
  const newRequest = f.reloadCustomers('new');
  newer.next({ items: [{ id: 'new' }], hasMore: false });
  await newRequest;
  older.next({ items: [{ id: 'old' }], hasMore: true });
  await oldRequest;
  assert.equal(f.customers()[0].id, 'new');
  assert.equal(f.customersHasMore(), false);
});

test('double pagination click loads once and ignores results after a new search', async () => {
  const page = new rx.Subject();
  let requests = 0;
  const f = facade({ loadCustomersPage: (number) => {
    requests += 1;
    return number === 2 ? page : rx.of({ items: [{ id: 'new' }], hasMore: false });
  } });
  f.customersHasMore.set(true);
  const pending = f.loadMoreCustomers();
  await f.loadMoreCustomers();
  assert.equal(requests, 1);
  await f.reloadCustomers('new');
  page.next({ items: [{ id: 'old' }], hasMore: true });
  await pending;
  assert.equal(f.customers().length, 1);
  assert.equal(f.customers()[0].id, 'new');
});

test('API reads bypass HTTP cache; writes and external requests pass through', async () => {
  const { apiNetworkInterceptor } = loadTs(corePath + 'api-network.interceptor.ts', {
    '@angular/common/http': { HttpErrorResponse: class extends Error {} },
    './api-config': { ADMIN_API_URL: '/api' },
  });
  for (const [method, url, shouldClone] of [
    ['GET', '/api/customers', true], ['POST', '/api/sales', false],
    ['GET', 'https://other.test/api', false],
  ]) {
    let cloned = false;
    const request = { method, url, clone: (options) => {
      cloned = true;
      assert.equal(options.setHeaders['Cache-Control'], 'no-cache, no-store');
      return request;
    } };
    await rx.firstValueFrom(apiNetworkInterceptor(request, () => rx.of('ok')));
    assert.equal(cloned, shouldClone);
  }
});


test('a stalled API read exits with actionable feedback after twenty seconds', () => {
  const { TestScheduler } = require('rxjs/testing');
  class ResponseError extends Error {
    constructor(options) { super(options.statusText); Object.assign(this, options); }
  }
  const { apiNetworkInterceptor } = loadTs(corePath + 'api-network.interceptor.ts', {
    '@angular/common/http': { HttpErrorResponse: ResponseError },
    './api-config': { ADMIN_API_URL: '/api' },
  });
  new TestScheduler((actual, expected) => assert.deepEqual(actual, expected)).run(({ expectObservable }) => {
    const request = { method: 'GET', url: '/api/appointments', clone() { return this; } };
    const result = apiNetworkInterceptor(request, () => rx.NEVER).pipe(
      rx.catchError((error) => rx.of(error.error.message)),
    );
    expectObservable(result).toBe('20s (a|)', {
      a: 'Il server impiega troppo tempo a rispondere. Riprova tra poco.',
    });
  });
});
