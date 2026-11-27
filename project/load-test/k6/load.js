// Teste de carga do Distributed Wagering Processor (REQUISITOS §14). Executado por ../run.sh.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://nginx';
const SCENARIOS = (__ENV.SCENARIOS || 'health').split(',').map((s) => s.trim()).filter(Boolean);
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '60s';
const VUS = Number(__ENV.VUS || 50);
const WALLETS = Number(__ENV.WALLETS || 20);
const PROVIDER = __ENV.PROVIDER_ID || 'load-test';

// Resultados de negócio por status HTTP (api.md §11): 503 com CONCURRENCY_CONFLICT é conflito de lock esgotado.
const lockConflicts = new Counter('wagering_http_lock_conflicts');
const rejections = new Counter('wagering_http_rejections');
const replays = new Counter('wagering_http_replays');
const unexpected = new Rate('wagering_http_unexpected');

const ALL = {
  health: {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: VUS,
    exec: 'health',
  },
  distinct: {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: VUS,
    exec: 'distinctWallets',
  },
  hot: {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: VUS,
    exec: 'hotWallet',
  },
  duplicate: {
    executor: 'per-vu-iterations',
    vus: VUS,
    iterations: 1,
    exec: 'duplicate',
  },
};

const unknown = SCENARIOS.filter((name) => !ALL[name]);
if (unknown.length) {
  throw new Error(`unknown scenarios: ${unknown.join(', ')} (use ${Object.keys(ALL).join(', ')})`);
}

export const options = {
  scenarios: Object.fromEntries(SCENARIOS.map((name) => [name, ALL[name]])),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    wagering_http_unexpected: ['rate<0.01'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };
const uuid = () => crypto.randomUUID();
const needsWallets = SCENARIOS.some((name) => name !== 'health');

function createWallet(balance) {
  const res = http.post(
    `${BASE_URL}/wallets`,
    JSON.stringify({ playerId: uuid(), initialBalance: { amount: balance, currency: 'BRL' } }),
    { ...json, tags: { name: 'POST /wallets' } },
  );
  if (res.status !== 201) {
    throw new Error(`POST /wallets returned ${res.status}: the wallets endpoint is required by these scenarios`);
  }
  return res.json();
}

export function setup() {
  // Um id por execução: a Idempotency-Key do cenário duplicate não pode colidir com a de um teste anterior.
  const runId = uuid();
  if (!needsWallets) {
    return { runId };
  }
  const wallets = Array.from({ length: WALLETS }, () => createWallet('1000000.00'));
  const hot = createWallet('1000000.00');
  return { runId, wallets, hot };
}

function submit(wallet, key, external) {
  const body = {
    providerId: PROVIDER,
    externalTransactionId: external,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: `round-${external}`,
    gameId: 'load-test',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  };
  const res = http.post(`${BASE_URL}/wagering/transactions`, JSON.stringify(body), {
    headers: { ...json.headers, 'Idempotency-Key': key },
    tags: { name: 'POST /wagering/transactions' },
  });
  classify(res);
  return res;
}

function classify(res) {
  const code = res.status >= 400 ? safeCode(res) : undefined;
  if (res.status === 503 && code === 'CONCURRENCY_CONFLICT') {
    lockConflicts.add(1);
  }
  if (res.status === 422) {
    rejections.add(1);
  }
  if (res.status < 400 && safeReplay(res)) {
    replays.add(1);
  }
  // 201, 202 e 422 são resultados de negócio; 503 de lock é esperado sob disputa.
  const expected = [201, 202, 422].includes(res.status) || (res.status === 503 && code === 'CONCURRENCY_CONFLICT');
  unexpected.add(!expected);
}

function safeCode(res) {
  try {
    return res.json('code');
  } catch (e) {
    return undefined;
  }
}

function safeReplay(res) {
  try {
    return res.json('idempotentReplay') === true;
  } catch (e) {
    return false;
  }
}

export function health() {
  const res = http.get(`${BASE_URL}/health/live`, { tags: { name: 'GET /health/live' } });
  check(res, { 'health 200': (r) => r.status === 200 });
  unexpected.add(res.status !== 200);
}

// Wallets diferentes em paralelo: mede o caminho sem disputa.
export function distinctWallets(data) {
  const wallet = data.wallets[Math.floor(Math.random() * data.wallets.length)];
  const external = uuid();
  submit(wallet, `${PROVIDER}:${external}`, external);
}

// Todas as apostas na mesma wallet: mede conflitos de lock e o custo do retry.
export function hotWallet(data) {
  const external = uuid();
  submit(data.hot, `${PROVIDER}:${external}`, external);
}

// A mesma aposta enviada por todas as VUs ao mesmo tempo: um débito e o resto replay.
export function duplicate(data) {
  const external = `duplicate-${data.runId}`;
  const res = submit(data.hot, `${PROVIDER}:${external}`, external);
  check(res, { 'duplicate is 201 or replay': (r) => r.status === 201 });
}

export function handleSummary(data) {
  const out = __ENV.OUT_DIR || '/results';
  return {
    [`${out}/summary.json`]: JSON.stringify(data, null, 2),
    [`${out}/k6.md`]: toMarkdown(data),
    stdout: `\nk6: scenarios=${SCENARIOS.join(',')} summary in ${out}\n`,
  };
}

function metric(data, name, stat) {
  const m = data.metrics[name];
  if (!m) return '—';
  const v = m.values[stat];
  return v === undefined ? '—' : String(Math.round(v * 100) / 100);
}

function toMarkdown(data) {
  const reqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : {};
  const rows = [
    ['Requisições', String(reqs.count ?? 0)],
    ['Throughput (req/s)', reqs.rate ? reqs.rate.toFixed(1) : '0'],
    ['Latência p50 (ms)', metric(data, 'http_req_duration', 'med')],
    ['Latência p95 (ms)', metric(data, 'http_req_duration', 'p(95)')],
    ['Latência p99 (ms)', metric(data, 'http_req_duration', 'p(99)')],
    ['Taxa de erro HTTP (status >= 400)', metric(data, 'http_req_failed', 'rate')],
    ['Taxa de resultado inesperado', metric(data, 'wagering_http_unexpected', 'rate')],
    ['Conflitos de lock (503 CONCURRENCY_CONFLICT)', metric(data, 'wagering_http_lock_conflicts', 'count')],
    ['Rejeições (422)', metric(data, 'wagering_http_rejections', 'count')],
    ['Replays (idempotentReplay)', metric(data, 'wagering_http_replays', 'count')],
  ];
  return ['| Métrica | Valor |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n') + '\n';
}
