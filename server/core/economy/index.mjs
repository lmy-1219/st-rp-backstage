const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => own(value, key));
const safe = value => Number.isSafeInteger(value);
const id = value => typeof value === 'string'
  && value.length >= 1
  && value.length <= 512
  && value.trim().length > 0
  && !/[\u0000-\u001f\u007f]/u.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const copy = value => structuredClone(value);
const rejected = code => ({ version: 1, status: 'rejected', code });
const pending = code => ({ version: 1, status: 'pending', code });

function same(left, right) {
  if (left === right) return true;
  if (!object(left) || !object(right)) return false;
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] && same(left[key], right[key]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validScope(value) {
  return exact(value, ['storyId', 'chatId', 'branchId'])
    && id(value.storyId) && id(value.chatId) && id(value.branchId);
}

const anchorKeys = ['sourceId', 'revision', 'ledgerRecordId', 'ledgerSourceKey'];
function validAnchor(value) {
  return exact(value, anchorKeys)
    && hash(value.sourceId) && hash(value.revision)
    && id(value.ledgerRecordId) && id(value.ledgerSourceKey);
}

const intentExtra = {
  quote: ['fromInstanceId', 'toInstanceId', 'amount'],
  accept: ['parentIntentId'],
  reserve: ['parentIntentId'],
  settle: ['parentIntentId'],
  release: ['parentIntentId'],
  refund: ['parentIntentId', 'amount'],
  transfer: ['fromInstanceId', 'toInstanceId', 'amount'],
};

function validateIntent(value, scope, currency) {
  if (!object(value) || !own(value, 'kind') || typeof value.kind !== 'string'
    || !own(intentExtra, value.kind)) return 'INVALID_INPUT';
  const fields = ['intentId', 'businessOrder', 'scope', 'currency', 'kind', ...intentExtra[value.kind]];
  if (!exact(value, fields) || !id(value.intentId) || !safe(value.businessOrder) || value.businessOrder < 0
    || !validScope(value.scope) || typeof value.currency !== 'string' || !id(value.currency)) return 'INVALID_INPUT';
  if (!same(value.scope, scope)) return 'SCOPE_MISMATCH';
  if (value.currency !== currency) return 'CURRENCY_MISMATCH';
  if (own(value, 'parentIntentId') && !id(value.parentIntentId)) return 'INVALID_INPUT';
  if (own(value, 'fromInstanceId') && (!id(value.fromInstanceId) || !id(value.toInstanceId)
    || value.fromInstanceId === value.toInstanceId)) return 'INVALID_INPUT';
  if (own(value, 'amount') && (!safe(value.amount) || value.amount <= 0 || Object.is(value.amount, -0))) return 'INVALID_AMOUNT';
  return null;
}

function validateSourceView(value, scope) {
  if (!exact(value, ['kind', 'version', 'scope', 'ledgerViewId', 'coverage', 'sources'])
    || value.kind !== 'economy-source-view' || value.version !== 1
    || !validScope(value.scope) || !hash(value.ledgerViewId)
    || !['complete', 'pending'].includes(value.coverage) || !Array.isArray(value.sources)) {
    return { error: 'INVALID_SOURCE_VIEW' };
  }
  if (!same(value.scope, scope)) return { error: 'SCOPE_MISMATCH' };
  const sourceIds = new Set();
  const indexes = new Set();
  const records = new Set();
  for (const source of value.sources) {
    if (!exact(source, ['sourceId', 'revision', 'authorId', 'ledgerSourceKey', 'index', 'state', 'recordIds'])
      || !hash(source.sourceId) || !hash(source.revision) || !id(source.authorId)
      || !id(source.ledgerSourceKey) || !safe(source.index) || source.index < 0
      || !['pending', 'settled'].includes(source.state) || !Array.isArray(source.recordIds)
      || (source.state === 'pending' && source.recordIds.length !== 0)
      || sourceIds.has(source.sourceId) || indexes.has(source.index)) {
      return { error: 'INVALID_SOURCE_VIEW' };
    }
    sourceIds.add(source.sourceId);
    indexes.add(source.index);
    const local = new Set();
    for (const record of source.recordIds) {
      if (!id(record) || local.has(record) || records.has(record)) return { error: 'INVALID_SOURCE_VIEW' };
      local.add(record);
      records.add(record);
    }
  }
  return { sources: value.sources };
}

function validateBinding(value) {
  if (!object(value) || !id(value.intentId) || !['active', 'withdrawn', 'pending'].includes(value.state)) return false;
  if (value.state === 'pending') return exact(value, ['intentId', 'state']);
  if (!exact(value, ['intentId', 'state', 'original', 'current', 'replacements'])
    || !validAnchor(value.original) || !validAnchor(value.current) || !Array.isArray(value.replacements)) return false;
  let cursor = value.original;
  const visited = new Set([canonical(cursor)]);
  for (const replacement of value.replacements) {
    if (!exact(replacement, ['from', 'to']) || !validAnchor(replacement.from) || !validAnchor(replacement.to)
      || !same(replacement.from, cursor) || same(replacement.from, replacement.to)
      || visited.has(canonical(replacement.to))) return false;
    cursor = replacement.to;
    visited.add(canonical(cursor));
  }
  return same(cursor, value.current);
}

function accepted(anchor, sources) {
  return sources.some(source => source.state === 'settled'
    && source.sourceId === anchor.sourceId
    && source.revision === anchor.revision
    && source.ledgerSourceKey === anchor.ledgerSourceKey
    && source.recordIds.includes(anchor.ledgerRecordId));
}

function validateDependencies(intents) {
  const byId = new Map(intents.map(intent => [intent.intentId, intent]));
  const expected = { accept: 'quote', reserve: 'accept', settle: 'reserve', release: 'reserve', refund: 'settle' };
  for (const intent of intents) {
    if (!own(expected, intent.kind)) continue;
    const parent = byId.get(intent.parentIntentId);
    if (!parent || parent.kind !== expected[intent.kind] || parent.businessOrder >= intent.businessOrder) return false;
  }
  return true;
}

function applyBusiness(intents, bindingById, accounts) {
  const reservations = [];
  const settlements = [];
  const reservationByIntent = new Map();
  const settlementByIntent = new Map();
  const acceptedQuotes = new Set();
  const reservedAccepts = new Set();
  const processedReservations = new Set();

  const available = account => account.balance - account.reserved;
  const pair = intent => {
    const from = accounts.get(intent.fromInstanceId);
    const to = accounts.get(intent.toInstanceId);
    if (!from || !to) return null;
    return [from, to];
  };

  for (const intent of intents) {
    if ((intent.kind === 'quote' || intent.kind === 'transfer') && !pair(intent)) {
      return rejected('UNKNOWN_ACCOUNT');
    }
    if (bindingById.get(intent.intentId).state === 'withdrawn') continue;
    if (intent.kind === 'accept') {
      if (acceptedQuotes.has(intent.parentIntentId)) return rejected('BUSINESS_STATE');
      acceptedQuotes.add(intent.parentIntentId);
    } else if (intent.kind === 'reserve') {
      if (reservedAccepts.has(intent.parentIntentId)) return rejected('BUSINESS_STATE');
      const quote = intents.find(candidate => candidate.intentId === intents.find(item => item.intentId === intent.parentIntentId).parentIntentId);
      const accountsPair = pair(quote);
      if (!accountsPair) return rejected('UNKNOWN_ACCOUNT');
      const [from] = accountsPair;
      if (available(from) < quote.amount) return rejected('INSUFFICIENT_FUNDS');
      from.reserved += quote.amount;
      const row = { intentId: intent.intentId, acceptIntentId: intent.parentIntentId,
        fromInstanceId: quote.fromInstanceId, toInstanceId: quote.toInstanceId, amount: quote.amount, state: 'open' };
      reservations.push(row);
      reservationByIntent.set(intent.intentId, row);
      reservedAccepts.add(intent.parentIntentId);
    } else if (intent.kind === 'settle' || intent.kind === 'release') {
      if (processedReservations.has(intent.parentIntentId)) return rejected('BUSINESS_STATE');
      const reservation = reservationByIntent.get(intent.parentIntentId);
      if (!reservation || reservation.state !== 'open') return rejected('BUSINESS_STATE');
      const from = accounts.get(reservation.fromInstanceId);
      const to = accounts.get(reservation.toInstanceId);
      from.reserved -= reservation.amount;
      reservation.state = intent.kind === 'settle' ? 'settled' : 'released';
      processedReservations.add(intent.parentIntentId);
      if (intent.kind === 'settle') {
        from.balance -= reservation.amount;
        to.balance += reservation.amount;
        const row = { intentId: intent.intentId, fromInstanceId: reservation.fromInstanceId,
          toInstanceId: reservation.toInstanceId, amount: reservation.amount, refunded: 0 };
        settlements.push(row);
        settlementByIntent.set(intent.intentId, row);
      }
    } else if (intent.kind === 'refund') {
      const settlement = settlementByIntent.get(intent.parentIntentId);
      if (!settlement) return rejected('BUSINESS_STATE');
      if (settlement.refunded + intent.amount > settlement.amount) return rejected('REFUND_EXCEEDED');
      const from = accounts.get(settlement.toInstanceId);
      const to = accounts.get(settlement.fromInstanceId);
      if (available(from) < intent.amount) return rejected('INSUFFICIENT_FUNDS');
      from.balance -= intent.amount;
      to.balance += intent.amount;
      settlement.refunded += intent.amount;
    } else if (intent.kind === 'transfer') {
      const accountsPair = pair(intent);
      if (!accountsPair) return rejected('UNKNOWN_ACCOUNT');
      const [from, to] = accountsPair;
      if (available(from) < intent.amount) return rejected('INSUFFICIENT_FUNDS');
      from.balance -= intent.amount;
      to.balance += intent.amount;
    }
  }
  return { reservations, settlements };
}

export function rebuildEconomy(input) {
  try {
    if (!exact(input, ['kind', 'version', 'scope', 'currency', 'openingBalances', 'sourceView', 'intents', 'bindings'])
      || input.kind !== 'economy-rebuild' || input.version !== 1 || !validScope(input.scope)
      || !id(input.currency) || !Array.isArray(input.openingBalances)
      || !Array.isArray(input.intents) || !Array.isArray(input.bindings)) return rejected('INVALID_INPUT');

    const accounts = new Map();
    let total = 0;
    for (const opening of input.openingBalances) {
      if (!exact(opening, ['instanceId', 'balance']) || !id(opening.instanceId)
        || !safe(opening.balance) || opening.balance < 0 || accounts.has(opening.instanceId)) return rejected('INVALID_INPUT');
      if (!safe(total + opening.balance)) return rejected('OVERFLOW');
      total += opening.balance;
      accounts.set(opening.instanceId, { instanceId: opening.instanceId, opening: opening.balance,
        balance: opening.balance, reserved: 0 });
    }

    const sourceResult = validateSourceView(input.sourceView, input.scope);
    if (sourceResult.error) return rejected(sourceResult.error);

    const unique = new Map();
    const counts = new Map();
    for (const intent of input.intents) {
      const error = validateIntent(intent, input.scope, input.currency);
      if (error) return rejected(error);
      const signature = canonical(intent);
      if (unique.has(intent.intentId) && unique.get(intent.intentId).signature !== signature) return rejected('IDEMPOTENCY_CONFLICT');
      if (!unique.has(intent.intentId)) unique.set(intent.intentId, { intent, signature });
      counts.set(intent.intentId, (counts.get(intent.intentId) ?? 0) + 1);
    }
    const intents = [...unique.values()].map(value => value.intent);
    const orders = new Set();
    for (const intent of intents) {
      if (orders.has(intent.businessOrder)) return rejected('ORDER_CONFLICT');
      orders.add(intent.businessOrder);
    }
    intents.sort((a, b) => a.businessOrder - b.businessOrder);
    if (!validateDependencies(intents)) return rejected('DEPENDENCY_INVALID');

    const bindingById = new Map();
    for (const binding of input.bindings) {
      if (!validateBinding(binding) || !unique.has(binding.intentId) || bindingById.has(binding.intentId)) return rejected('INVALID_BINDING');
      bindingById.set(binding.intentId, binding);
    }

    if (input.sourceView.coverage === 'pending') return pending('COVERAGE_PENDING');
    if (sourceResult.sources.some(source => source.state === 'pending')) return pending('SOURCE_PENDING');
    if (intents.some(intent => !bindingById.has(intent.intentId) || bindingById.get(intent.intentId).state === 'pending')) {
      return pending('BINDING_PENDING');
    }
    for (const intent of intents) {
      const binding = bindingById.get(intent.intentId);
      const isAccepted = accepted(binding.current, sourceResult.sources);
      if (binding.state === 'withdrawn' && isAccepted) return rejected('WITHDRAWAL_CONFLICT');
      if (binding.state === 'active' && !isAccepted) return pending('REBIND_REQUIRED');
    }
    const byId = new Map(intents.map(intent => [intent.intentId, intent]));
    for (const intent of intents) {
      if (!own(intent, 'parentIntentId') || bindingById.get(intent.intentId).state === 'withdrawn') continue;
      if (bindingById.get(byId.get(intent.parentIntentId).intentId).state === 'withdrawn') return pending('DEPENDENCY_WITHDRAWN');
    }

    const business = applyBusiness(intents, bindingById, accounts);
    if (business.status) return business;
    const balances = [...accounts.values()].sort((a, b) => a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0)
      .map(account => ({ ...account, available: account.balance - account.reserved }));
    if (balances.some(row => !safe(row.balance) || !safe(row.reserved) || !safe(row.available)
      || row.balance < 0 || row.reserved < 0 || row.available < 0)) return rejected('OVERFLOW');

    return {
      version: 1,
      status: 'applied',
      scope: copy(input.scope),
      currency: input.currency,
      ledgerViewId: input.sourceView.ledgerViewId,
      projection: { total, balances, reservations: business.reservations, settlements: business.settlements },
      receipts: intents.map(intent => ({ intentId: intent.intentId, businessOrder: intent.businessOrder,
        kind: intent.kind, status: bindingById.get(intent.intentId).state === 'withdrawn' ? 'withdrawn' : 'applied',
        current: copy(bindingById.get(intent.intentId).current) })),
      duplicates: [...counts.entries()].filter(([, count]) => count > 1)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([intentId, count]) => ({ intentId, status: 'duplicate', ignoredCount: count - 1 })),
    };
  } catch {
    return rejected('INVALID_INPUT');
  }
}
