'use strict';
const { randomBytes } = require('node:crypto');

function createReturnApprovalStore({ now = () => Date.now(), randomBytesFn = randomBytes, ttlMs = 120_000 } = {}) {
  const approvals = new Map();
  const normalizeNullable = value => value == null ? null : String(value);

  function issue({ requesterSessionToken, requesterUserId, terminalId, saleId, authorizedBy } = {}) {
    const sessionToken = String(requesterSessionToken || '').trim();
    const requesterId = String(requesterUserId || '').trim();
    const normalizedSaleId = String(saleId || '').trim();
    const authorizerId = String(authorizedBy?.userId || '').trim();
    if (!sessionToken || !requesterId || !normalizedSaleId) throw new Error('Dados da autorizacao incompletos.');
    if (!authorizerId) throw new Error('Identidade do autorizador e obrigatoria.');

    const approvalToken = randomBytesFn(32).toString('hex');
    const expiresAtMs = now() + ttlMs;
    const safeAuthorizedBy = Object.freeze({
      userId: authorizerId,
      profileId: String(authorizedBy?.profileId || '').trim() || null,
      name: String(authorizedBy?.name || '')
    });
    approvals.set(approvalToken, {
      requesterSessionToken: sessionToken,
      requesterUserId: requesterId,
      terminalId: normalizeNullable(terminalId),
      saleId: normalizedSaleId,
      scope: 'return.complete',
      authorizedBy: safeAuthorizedBy,
      expiresAtMs
    });
    return {
      approvalToken,
      authorizedBy: { ...safeAuthorizedBy },
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  function consume(token, expected = {}) {
    const key = String(token || '').trim();
    const approval = approvals.get(key);
    if (!approval) throw new Error('Autorizacao invalida ou ja consumida.');
    if (approval.expiresAtMs <= now()) {
      approvals.delete(key);
      throw new Error('Autorizacao expirada.');
    }
    const matches = approval.requesterSessionToken === String(expected.requesterSessionToken || '').trim()
      && approval.requesterUserId === String(expected.requesterUserId || '').trim()
      && approval.terminalId === normalizeNullable(expected.terminalId)
      && approval.saleId === String(expected.saleId || '').trim()
      && approval.scope === String(expected.scope || '').trim();
    if (!matches) throw new Error('Autorizacao nao corresponde ao vinculo ou escopo desta devolucao.');
    approvals.delete(key);
    return { ...approval.authorizedBy };
  }

  return Object.freeze({ issue, consume });
}

module.exports = { createReturnApprovalStore };
