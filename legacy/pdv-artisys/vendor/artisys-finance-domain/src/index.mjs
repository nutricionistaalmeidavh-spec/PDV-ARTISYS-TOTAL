const STOPWORDS = new Set(['PIX','PAGAMENTO','PAGTO','TRANSFERENCIA','TRANSF','LTDA','ME','EPP','SA']);

export function normalizeText(value='') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function stableHash(value='') {
  const text = String(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i=0;i<text.length;i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ (text.charCodeAt(i)+i), 16777619);
  }
  return (h1>>>0).toString(16).padStart(8,'0') + (h2>>>0).toString(16).padStart(8,'0');
}

function assertDirection(direction) {
  if (direction !== 'credit' && direction !== 'debit') throw new TypeError('direction must be credit or debit');
}

function amountCentsOf(tx) {
  const value = Number(tx?.amountCents);
  if (!Number.isInteger(value) || value < 0) throw new TypeError('amountCents must be a non-negative integer');
  return value;
}

export function businessFingerprint(tx) {
  if (!tx || typeof tx !== 'object') throw new TypeError('transaction must be an object');
  assertDirection(tx.direction);
  const amountCents = amountCentsOf(tx);
  const normalized = normalizeText(tx.normalized ?? tx.description ?? '');
  return stableHash([tx.accountId ?? '', tx.date ?? '', normalized, amountCents, tx.direction].join('|'));
}

export function sourceFingerprint(tx, sourceIdentity={}) {
  if (!tx || typeof tx !== 'object') throw new TypeError('transaction must be an object');
  const source = String(sourceIdentity.source ?? tx.source ?? '').trim();
  const documentId = String(sourceIdentity.documentId ?? sourceIdentity.fileHash ?? sourceIdentity.batchId ?? tx.batchId ?? '').trim();
  const externalId = String(sourceIdentity.externalId ?? tx.externalId ?? '').trim();
  const hasRowIndex = Number.isInteger(sourceIdentity.rowIndex);
  if (!source || (!documentId && !externalId) || (!externalId && !hasRowIndex)) {
    throw new TypeError('sourceFingerprint requires source plus externalId or documentId/fileHash/batchId with rowIndex');
  }
  const rowIdentity = externalId || `row:${sourceIdentity.rowIndex}`;
  return stableHash([source, documentId, rowIdentity].join('|'));
}

function textConditionMatches(actualValue, condition) {
  if (!condition) return true;
  const actual = normalizeText(actualValue ?? '');
  const kind = condition.kind ?? 'contains';
  if (kind === 'regex') {
    const pattern = condition.value instanceof RegExp ? condition.value : new RegExp(String(condition.value ?? ''), condition.flags ?? 'i');
    return pattern.test(actual);
  }
  if (kind === 'tokens') {
    const tokens = Array.isArray(condition.value) ? condition.value : String(condition.value ?? '').split(/\s+/);
    const normalizedTokens = tokens.map(normalizeText).filter(Boolean);
    return normalizedTokens.length > 0 && normalizedTokens.every(token => actual.includes(token));
  }
  const expected = normalizeText(condition.value ?? '');
  if (!expected) return false;
  if (kind === 'equals') return actual === expected;
  if (kind === 'startsWith') return actual.startsWith(expected);
  if (kind === 'endsWith') return actual.endsWith(expected);
  if (kind === 'contains') return actual.includes(expected);
  throw new TypeError(`unsupported text match kind: ${kind}`);
}

export function ruleMatches(tx, rule) {
  if (!rule || rule.enabled === false) return false;
  const match = rule.match ?? {};
  if (match.direction && tx.direction !== match.direction) return false;
  if (match.accountId && tx.accountId !== match.accountId) return false;
  if (match.counterparty && !textConditionMatches(tx.counterparty ?? tx.description, {kind:'contains',value:match.counterparty})) return false;
  if (match.description && !textConditionMatches(tx.normalized ?? tx.description, match.description)) return false;
  if (match.amountCents) {
    const amount = amountCentsOf(tx);
    if (match.amountCents.min != null && amount < Number(match.amountCents.min)) return false;
    if (match.amountCents.max != null && amount > Number(match.amountCents.max)) return false;
  }
  return true;
}

export function applyDeterministicRules(tx, rules=[]) {
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array');
  const ordered = rules
    .map((rule,index)=>({rule,index}))
    .filter(({rule})=>rule?.enabled !== false)
    .sort((a,b)=>(Number(b.rule.priority ?? 0)-Number(a.rule.priority ?? 0)) || a.index-b.index);
  for (const {rule} of ordered) {
    if (!ruleMatches(tx, rule)) continue;
    return {
      matched:true,
      ruleId:String(rule.id ?? ''),
      confidence:1,
      assignments:{...(rule.assign ?? {})},
      reason:rule.reason || `Regra determinística ${rule.id ?? 'sem-id'} aplicada`,
    };
  }
  return {matched:false,ruleId:null,confidence:0,assignments:{},reason:'Nenhuma regra determinística aplicável'};
}

export function dedupeBySourceFingerprint(existing=[], incoming=[]) {
  const seen = new Set(existing.map(item=>item?.sourceFingerprint).filter(Boolean));
  const accepted = [];
  const duplicates = [];
  for (const item of incoming) {
    const fp = item?.sourceFingerprint;
    if (!fp) throw new TypeError('incoming transaction is missing sourceFingerprint');
    if (seen.has(fp)) duplicates.push(item);
    else { seen.add(fp); accepted.push(item); }
  }
  return {accepted,duplicates};
}

function dayDistance(a,b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const av = Date.parse(`${a}T00:00:00Z`);
  const bv = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return Number.POSITIVE_INFINITY;
  return Math.abs(av-bv)/86400000;
}

export function reconcileAccountTransfers(transactions=[], accounts=[], options={}) {
  const maxDays = Number.isFinite(options.maxDays) ? Number(options.maxDays) : 1;
  const amountToleranceCents = Number.isFinite(options.amountToleranceCents) ? Math.max(0,Number(options.amountToleranceCents)) : 0;
  const byId = new Map(accounts.map(account=>[account.id,account]));
  const used = new Set();
  const internalTransfers = [];
  const withdrawals = [];
  const returns = [];
  for (let i=0;i<transactions.length;i++) {
    const a = transactions[i];
    if (used.has(a.id)) continue;
    for (let j=i+1;j<transactions.length;j++) {
      const b = transactions[j];
      if (used.has(b.id) || a.accountId === b.accountId || a.direction === b.direction) continue;
      if (Math.abs(Number(a.amountCents)-Number(b.amountCents)) > amountToleranceCents) continue;
      const dd = dayDistance(a.date,b.date);
      if (dd > maxDays) continue;
      const debit = a.direction === 'debit' ? a : b;
      const credit = a.direction === 'credit' ? a : b;
      const debitAccount = byId.get(debit.accountId);
      const creditAccount = byId.get(credit.accountId);
      if (!debitAccount || !creditAccount) continue;
      const pair = {debitId:debit.id,creditId:credit.id,amountCents:Math.min(Number(debit.amountCents),Number(credit.amountCents)),dayDistance:dd};
      if (debitAccount.ownership === 'business' && creditAccount.ownership === 'business') internalTransfers.push(pair);
      else if (debitAccount.ownership === 'business' && creditAccount.ownership === 'personal') withdrawals.push(pair);
      else if (debitAccount.ownership === 'personal' && creditAccount.ownership === 'business') returns.push(pair);
      else continue;
      used.add(a.id); used.add(b.id); break;
    }
  }
  return {internalTransfers,withdrawals,returns,matchedTransactionIds:[...used]};
}

function nameScore(description, beneficiaryName) {
  const tokens = normalizeText(beneficiaryName).split(' ').filter(token=>token.length>=3 && !STOPWORDS.has(token));
  if (!tokens.length) return 0;
  const descriptionNormalized = normalizeText(description);
  return tokens.filter(token=>descriptionNormalized.includes(token)).length/tokens.length;
}

function allocationTotals(matches=[]) {
  const byObligation = new Map();
  const byTransaction = new Map();
  for (const match of matches) for (const allocation of match.allocations ?? []) {
    const value = Number(allocation.amountCents ?? 0);
    byObligation.set(allocation.obligationId,(byObligation.get(allocation.obligationId) ?? 0)+value);
    byTransaction.set(match.transactionId,(byTransaction.get(match.transactionId) ?? 0)+value);
  }
  return {byObligation,byTransaction};
}

function candidateBaseScore(tx, obligation, remaining, target) {
  const ns = nameScore(tx.description, obligation.beneficiaryName);
  const dd = dayDistance(tx.date, obligation.dueDate);
  const exact = remaining === target;
  let score = exact ? 0.55 : 0;
  score += ns * 0.30;
  score += dd <= 3 ? 0.15 : dd <= 7 ? 0.10 : dd <= 15 ? 0.05 : 0;
  if (tx.category && obligation.category && tx.category === obligation.category) score += 0.05;
  if (!exact && target < remaining && ns >= 0.5) score = Math.max(score,0.72);
  return {score:Math.min(0.99,score),nameScore:ns,dayDistance:dd,exact};
}

export function updatePairStats(stats={accepted:0,rejected:0,manual:0}, decision) {
  const next = {accepted:Number(stats?.accepted ?? 0),rejected:Number(stats?.rejected ?? 0),manual:Number(stats?.manual ?? 0)};
  if (!['accepted','rejected','manual'].includes(decision)) throw new TypeError('decision must be accepted, rejected or manual');
  next[decision] += 1;
  return next;
}

export function adjustScoreWithFeedback(baseScore, stats={}, options={}) {
  const acceptedBoost = Number.isFinite(options.acceptedBoost) ? Number(options.acceptedBoost) : 0.05;
  const rejectedPenalty = Number.isFinite(options.rejectedPenalty) ? Number(options.rejectedPenalty) : 0.08;
  const manualBoost = Number.isFinite(options.manualBoost) ? Number(options.manualBoost) : 0.02;
  const delta = Number(stats.accepted ?? 0)*acceptedBoost - Number(stats.rejected ?? 0)*rejectedPenalty + Number(stats.manual ?? 0)*manualBoost;
  return Math.max(0,Math.min(0.99,Number(baseScore)+delta));
}

export function suggestReconciliation(transactions=[], obligations=[], confirmedMatches=[], options={}) {
  const minConfidence = Number.isFinite(options.minConfidence) ? Number(options.minConfidence) : 0.65;
  const totals = allocationTotals(confirmedMatches);
  const open = obligations.map(obligation=>({
    obligation,
    remaining:Math.max(0,Number(obligation.amountCents ?? 0)-(totals.byObligation.get(obligation.id) ?? 0)),
  })).filter(item=>item.remaining>0);
  const pairStats = options.pairStats ?? {};
  const result = [];
  for (const tx of transactions) {
    if (tx.direction !== 'debit') continue;
    const already = totals.byTransaction.get(tx.id) ?? 0;
    if (already >= Number(tx.amountCents ?? 0)) continue;
    const target = Number(tx.amountCents ?? 0)-already;
    const candidates = open.map(item=>{
      const raw = candidateBaseScore(tx,item.obligation,item.remaining,target);
      const key = `${tx.id}|${item.obligation.id}`;
      const score = adjustScoreWithFeedback(raw.score,pairStats[key]);
      return {...item,...raw,score};
    }).filter(item=>item.score>=minConfidence).sort((a,b)=>b.score-a.score);
    const best = candidates[0];
    if (!best) continue;
    const reasons = [];
    if (best.exact) reasons.push('Valor exato');
    else if (target < best.remaining) reasons.push('Pagamento parcial');
    if (best.nameScore >= 0.5) reasons.push('beneficiário reconhecido');
    if (best.dayDistance <= 7) reasons.push('data próxima ao vencimento');
    if (tx.category && best.obligation.category && tx.category === best.obligation.category) reasons.push('categoria compatível');
    result.push({
      transactionId:tx.id,
      allocations:[{obligationId:best.obligation.id,amountCents:Math.min(target,best.remaining)}],
      confidence:best.score,
      kind:best.exact ? 'exact' : 'partial',
      reason:reasons.join('. ') || 'Correspondência determinística por score',
      evidence:{nameScore:best.nameScore,dayDistance:best.dayDistance,exactAmount:best.exact},
    });
  }
  return result.sort((a,b)=>b.confidence-a.confidence);
}

export const BASIC_PT_BR_FINANCE_RULES = Object.freeze([
  {id:'ptbr-taxes',priority:80,match:{description:{kind:'regex',value:'\\b(SIMPLES|DARF|DAS|RECEITA FEDERAL|FGTS|INSS)\\b'}},assign:{category:'Tributos e encargos'},reason:'Palavra-chave de tributo/encargo'},
  {id:'ptbr-food',priority:60,match:{description:{kind:'regex',value:'\\b(IFOOD|PIZZA|RESTAUR|CONVENIENCIA|SUPERMERC)'}},assign:{category:'Alimentação'},reason:'Palavra-chave de alimentação'},
  {id:'ptbr-fuel',priority:60,match:{description:{kind:'regex',value:'\\b(POSTO|COMBUST|SHELL|IPIRANGA)\\b'}},assign:{category:'Combustível'},reason:'Palavra-chave de combustível'},
  {id:'ptbr-health',priority:60,match:{description:{kind:'regex',value:'\\b(DROG|FARMAC|RAIA)'}},assign:{category:'Farmácia e saúde'},reason:'Palavra-chave de saúde/farmácia'},
  {id:'ptbr-bank-fees',priority:70,match:{description:{kind:'regex',value:'\\b(TARIFA|IOF|JUROS)\\b'}},assign:{category:'Tarifas bancárias'},reason:'Palavra-chave de tarifa bancária'},
  {id:'ptbr-materials',priority:60,match:{description:{kind:'regex',value:'\\b(MATERIAL|DEPOSITO|CONSTRUCAO)\\b'}},assign:{category:'Materiais'},reason:'Palavra-chave de material/construção'},
]);
