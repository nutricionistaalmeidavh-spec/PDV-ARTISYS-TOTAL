'use strict';
const {statusForError}=require('./http-error-status');

function bearer(request) {
  const value = String(request.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Corpo da requisicao excede o limite permitido.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('JSON invalido.');
    error.statusCode = 400;
    throw error;
  }
}

function createReturnAuthorizationRouter({
  runtime,
  sessionStore,
  approvalStore,
  bodyLimitBytes = 1024 * 1024,
  requireTerminalAuth = false
} = {}) {
  if (!runtime) throw new TypeError('runtime is required.');
  if (!sessionStore) throw new TypeError('sessionStore is required.');
  if (!approvalStore) throw new TypeError('approvalStore is required.');

  function authenticate(request) {
    const token = bearer(request);
    const session = sessionStore.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessionStore.delete(token);
      const error = new Error('Sessao invalida ou expirada.');
      error.statusCode = 401;
      throw error;
    }
    if (requireTerminalAuth) {
      const terminal = runtime.terminals.listTerminals().find(item => item.terminalId === session.terminalId);
      if (!terminal || terminal.status !== 'ACTIVE') {
        const error = new Error('Terminal nao autorizado.');
        error.statusCode = 401;
        throw error;
      }
    }
    const user = runtime.catalog.getUser(session.userId);
    if (!user || !user.active) {
      sessionStore.delete(token);
      const error = new Error('Usuario inativo ou inexistente.');
      error.statusCode = 401;
      throw error;
    }
    return { token, session, user };
  }

  async function executeMutation(request, pathname, statusCode, handler) {
    const mutationId = String(request.headers['x-mutation-id'] || '').trim();
    if (!mutationId || !runtime.mutations) return { statusCode, payload:await handler(mutationId || null) };
    return runtime.mutations.execute(
      { mutationId, method:request.method, path:pathname },
      async () => ({ statusCode, payload:await handler(mutationId) })
    );
  }

  return async function returnAuthorizationRoute(request, response) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (request.method !== 'POST' || !['/api/v1/auth/authorize','/api/v1/returns'].includes(pathname)) return false;

    try {
      const { token, session } = authenticate(request);
      const body = await readJson(request, bodyLimitBytes);
      const terminalId = session.terminalId || String(body.terminalId || body.resource?.terminalId || '').trim() || null;

      if (pathname === '/api/v1/auth/authorize') {
        if (String(body.scope || '') !== 'return.complete') {
          sendJson(response, 400, { error:'Escopo de autorizacao invalido.' });
          return true;
        }
        const saleId = String(body.resource?.saleId || '').trim();
        if (!saleId) {
          sendJson(response, 400, { error:'Venda e obrigatoria para autorizacao.' });
          return true;
        }
        if (session.terminalId && body.resource?.terminalId && String(body.resource.terminalId) !== String(session.terminalId)) {
          sendJson(response, 403, { error:'Terminal da autorizacao nao corresponde a sessao.' });
          return true;
        }
        const sale = runtime.sales.getSale(saleId);
        if (!sale || sale.status !== 'COMPLETED') {
          sendJson(response, 400, { error:'Somente venda concluida pode receber devolucao.' });
          return true;
        }
        const verified = runtime.catalog.verifyUserPassword(body.username, body.password);
        if (!verified.ok) {
          sendJson(response, 401, { error:'Usuario ou senha de autorizacao invalidos.' });
          return true;
        }
        if (!runtime.authorization.can({principal:{kind:'human',id:verified.user.id},capability:'returns.approve'})) {
          sendJson(response, 403, { error:'Permissao para autorizar devolucoes necessaria.' });
          return true;
        }
        const access=runtime.profiles.getUserAccess(verified.user.id);
        const issued = approvalStore.issue({
          requesterSessionToken:token,
          requesterUserId:session.userId,
          terminalId,
          saleId,
          authorizedBy:{
            userId:verified.user.id,
            name:verified.user.name,
            profileId:access.profile?.id||null
          }
        });
        sendJson(response, 200, {
          approvalToken:issued.approvalToken,
          authorizedBy:{
            id:verified.user.id,
            name:verified.user.name,
            profileId:access.profile?.id||null
          },
          expiresAt:issued.expiresAt
        });
        return true;
      }

      const result = await executeMutation(request, pathname, 201, async mutationId => {
        let authorizedBy = { userId:session.userId, name:session.name || '' };
        const requesterPrincipal={kind:'human',id:session.userId};
        const requesterCanManage=runtime.authorization.can({principal:requesterPrincipal,capability:'returns.manage'});
        if(!requesterCanManage){
          const error=new Error('Permissao insuficiente para registrar devolucao.');
          error.statusCode=403;
          throw error;
        }
        const requesterCanApprove=runtime.authorization.can({principal:requesterPrincipal,capability:'returns.approve'});
        if (!requesterCanApprove) {
          const approvalToken = String(body.approvalToken || '').trim();
          if (!approvalToken) {
            const error = new Error('Autorizacao de gerente necessaria para devolucao.');
            error.statusCode = 403;
            throw error;
          }
          try {
            authorizedBy = approvalStore.consume(approvalToken, {
              requesterSessionToken:token,
              requesterUserId:session.userId,
              terminalId,
              saleId:body.saleId,
              scope:'return.complete'
            });
          } catch (cause) {
            const error = new Error(cause.message);
            error.statusCode = 403;
            throw error;
          }
        }
        const { approvalToken:_approvalToken, ...returnInput } = body;
        const ret = runtime.returns.createReturn({
          ...returnInput,
          terminalId,
          operatorId:session.userId,
          actor:{ kind:'human', userId:session.userId, terminalId },
          authorizedBy,
          mutationId
        });
        const dispatch = await runtime.dispatchPending();
        return { return:ret, dispatch };
      });
      sendJson(response, result.statusCode, result.payload);
      return true;
    } catch (error) {
      sendJson(response, statusForError(error), { error:error.message || 'Erro na autorizacao da devolucao.' });
      return true;
    }
  };
}

module.exports = { createReturnAuthorizationRouter };
