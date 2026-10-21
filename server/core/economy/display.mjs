const DISPLAY_ERROR = Object.freeze({
  kind: 'economy-display-error',
  version: 1,
  status: 'rejected',
  code: 'INVALID_VIEW_INPUT',
});

const AMOUNT_LABELS = new Map([
  ['balance', '账面余额'],
  ['reserved', '已预留'],
  ['available', '可用余额'],
]);

const OPERATION_LABELS = new Map([
  ['quote', '报价'],
  ['accept', '接受报价'],
  ['reserve', '预留'],
  ['settle', '付款'],
  ['release', '释放预留'],
  ['refund', '退款'],
  ['transfer', '内部转账'],
]);

const STATE_LABELS = new Map([
  ['applied', '已应用'],
  ['withdrawn', '已撤回'],
]);

const PENDING_LABELS = new Map([
  ['COVERAGE_PENDING', '来源覆盖待确认'],
  ['SOURCE_PENDING', '来源记录待确认'],
  ['BINDING_PENDING', '交易绑定待确认'],
  ['REBIND_REQUIRED', '来源需要重绑'],
  ['DEPENDENCY_WITHDRAWN', '撤回依赖待解决'],
]);

const REJECTED_LABELS = new Map([
  ['INVALID_INPUT', '输入格式无效'],
  ['INVALID_SOURCE_VIEW', '来源视图无效'],
  ['SCOPE_MISMATCH', '作用域不一致'],
  ['CURRENCY_MISMATCH', '币种不一致'],
  ['INVALID_AMOUNT', '金额无效'],
  ['OVERFLOW', '金额超出安全范围'],
  ['UNKNOWN_ACCOUNT', '账户未登记'],
  ['IDEMPOTENCY_CONFLICT', '同一交易内容冲突'],
  ['ORDER_CONFLICT', '交易顺序冲突'],
  ['INVALID_BINDING', '来源绑定无效'],
  ['WITHDRAWAL_CONFLICT', '撤回声明冲突'],
  ['DEPENDENCY_INVALID', '交易依赖无效'],
  ['BUSINESS_STATE', '交易状态不允许'],
  ['INSUFFICIENT_FUNDS', '可用余额不足'],
  ['REFUND_EXCEEDED', '退款超过原实付'],
]);

const ID_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const VIEW_ID = /^[0-9a-f]{64}$/u;

function inspectRecord(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== 'string')) return null;
  const allowed = new Set(expectedKeys);
  if (keys.some(key => !allowed.has(key))) return null;

  const fields = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    fields[key] = descriptor.value;
  }
  return fields;
}

function inspectArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') return null;

  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    if (keys[index] !== String(index)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    items.push(descriptor.value);
  }
  return items;
}

function isId(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 512
    && value.trim().length > 0
    && !ID_CONTROL_CHARACTERS.test(value);
}

function readContext(value, status) {
  const context = inspectRecord(value, ['scope', 'calculationId', 'windowGeneration', 'ledgerViewId']);
  if (!context) return null;
  const scope = inspectRecord(context.scope, ['storyId', 'chatId', 'branchId']);
  if (!scope || !isId(scope.storyId) || !isId(scope.chatId) || !isId(scope.branchId)) return null;
  if (!isId(context.calculationId) || !isId(context.windowGeneration)) return null;
  if (status === 'applied') {
    if (typeof context.ledgerViewId !== 'string' || !VIEW_ID.test(context.ledgerViewId)) return null;
  } else if (context.ledgerViewId !== null
    && (typeof context.ledgerViewId !== 'string' || !VIEW_ID.test(context.ledgerViewId))) {
    return null;
  }
  return {
    scope: {
      storyId: scope.storyId,
      chatId: scope.chatId,
      branchId: scope.branchId,
    },
    calculationId: context.calculationId,
    windowGeneration: context.windowGeneration,
    ledgerViewId: context.ledgerViewId,
  };
}

function readRecipient(value) {
  const recipient = inspectRecord(value, ['type', 'id']);
  if (!recipient || (recipient.type !== 'player' && recipient.type !== 'character') || !isId(recipient.id)) return null;
  return {type: recipient.type, id: recipient.id};
}

function readAccounts(value) {
  const accounts = inspectArray(value);
  if (!accounts) return null;
  const seen = new Set();
  const result = [];

  for (const valueAccount of accounts) {
    const account = inspectRecord(valueAccount, ['instanceId', 'amounts']);
    if (!account || !isId(account.instanceId) || seen.has(account.instanceId)) return null;
    seen.add(account.instanceId);

    if (account.amounts === null || typeof account.amounts !== 'object' || Array.isArray(account.amounts)) return null;
    const amountKeys = Reflect.ownKeys(account.amounts);
    if (Object.getPrototypeOf(account.amounts) !== Object.prototype
      && Object.getPrototypeOf(account.amounts) !== null) return null;
    if (amountKeys.length < 1
      || amountKeys.length > AMOUNT_LABELS.size
      || amountKeys.some(key => typeof key !== 'string' || !AMOUNT_LABELS.has(key))) return null;

    const values = new Map();
    for (const key of amountKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(account.amounts, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      const amount = descriptor.value;
      if (!Number.isSafeInteger(amount) || amount < 0 || Object.is(amount, -0)) return null;
      values.set(key, amount);
    }

    const fields = [];
    for (const [key, label] of AMOUNT_LABELS) {
      if (values.has(key)) fields.push({key, label, value: values.get(key)});
    }
    result.push({instanceId: account.instanceId, fields});
  }
  return result;
}

function readOperations(value) {
  const operations = inspectArray(value);
  if (!operations) return null;
  const seen = new Set();
  const result = [];

  for (const valueOperation of operations) {
    const operation = inspectRecord(valueOperation, ['intentId', 'kind', 'state']);
    if (!operation
      || !isId(operation.intentId)
      || seen.has(operation.intentId)
      || !OPERATION_LABELS.has(operation.kind)
      || !STATE_LABELS.has(operation.state)) return null;
    seen.add(operation.intentId);
    result.push({
      intentId: operation.intentId,
      kind: operation.kind,
      state: operation.state,
      kindLabel: OPERATION_LABELS.get(operation.kind),
      stateLabel: STATE_LABELS.get(operation.state),
    });
  }
  return result;
}

function invalid() {
  return {...DISPLAY_ERROR};
}

export function adaptEconomyDisplay(input) {
  try {
    const shell = inspectRecord(input, Reflect.ownKeys(input ?? {}).filter(key => typeof key === 'string'));
    if (!shell || shell.kind !== 'economy-visible-input' || shell.version !== 1) return invalid();
    if (shell.status !== 'applied' && shell.status !== 'pending' && shell.status !== 'rejected') return invalid();

    const expectedKeys = shell.status === 'applied'
      ? ['kind', 'version', 'context', 'recipient', 'status', 'currency', 'accounts', 'operations']
      : ['kind', 'version', 'context', 'recipient', 'status', 'code'];
    const fields = inspectRecord(input, expectedKeys);
    if (!fields) return invalid();

    const context = readContext(fields.context, fields.status);
    const recipient = readRecipient(fields.recipient);
    if (!context || !recipient) return invalid();

    if (fields.status === 'applied') {
      if (!isId(fields.currency)) return invalid();
      const accounts = readAccounts(fields.accounts);
      const operations = readOperations(fields.operations);
      if (!accounts || !operations) return invalid();
      return {
        kind: 'economy-display',
        version: 1,
        context,
        recipient,
        status: 'applied',
        statusLabel: '当前已确认',
        currency: fields.currency,
        accounts,
        operations,
      };
    }

    const labels = fields.status === 'pending' ? PENDING_LABELS : REJECTED_LABELS;
    if (!labels.has(fields.code)) return invalid();
    return {
      kind: 'economy-display',
      version: 1,
      context,
      recipient,
      status: fields.status,
      statusLabel: fields.status === 'pending' ? '待核对' : '已拒绝',
      code: fields.code,
      reasonLabel: labels.get(fields.code),
    };
  } catch {
    return invalid();
  }
}
