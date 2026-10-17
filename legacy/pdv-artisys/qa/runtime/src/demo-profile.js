import { createFixtureRegistry, resolveFixturePacks } from './fixture-registry.js';
import { collectProfileSecretValues, redactSecrets } from './redaction.js';

export function resolveDemoCredentials(profile, env = process.env) {
  const credentials = {};
  for (const [key, envName] of Object.entries(profile?.account || {})) {
    if (!key.endsWith('Env')) continue;
    if (typeof envName !== 'string' || !envName) throw new TypeError(`${key} must name an environment variable`);
    const value = env[envName];
    if (value == null || value === '') throw new Error(`Missing environment variable: ${envName}`);
    credentials[key.slice(0, -3)] = value;
  }
  return credentials;
}

function hookContext({ profile, context, credentials, account, workspace, fixtures }) {
  return {
    ...(context || {}),
    profile,
    strategy: profile.workspace?.strategy || 'persistent',
    credentials,
    account: account ?? null,
    workspace: workspace ?? null,
    fixtures: fixtures || [],
  };
}

function safeId(value) {
  if (!value || typeof value !== 'object') return null;
  return value.id == null ? null : String(value.id);
}

function publicMetadata({ profile, accountCreated, account, workspace, fixtures = [], extra = null, env = process.env }) {
  const metadata = {
    profile: profile.name || profile.id || 'default',
    strategy: profile.workspace?.strategy || 'persistent',
    accountCreated: Boolean(accountCreated),
    accountId: safeId(account),
    workspaceId: safeId(workspace),
    fixtures: fixtures.map(pack => ({ id: pack.id, revision: pack.revision })),
    ...(extra && typeof extra === 'object' ? { adapterStatus: extra } : {}),
  };
  return redactSecrets(metadata, collectProfileSecretValues(profile, env));
}

async function findOrCreateAccount({ profile, adapter, credentials, context }) {
  const base = hookContext({ profile, context, credentials });
  let account = null;
  let accountCreated = false;

  if (typeof adapter.findDemoAccount === 'function') account = await adapter.findDemoAccount(base);
  if (!account && profile.account?.createIfMissing) {
    if (typeof adapter.findDemoAccount !== 'function' || typeof adapter.createDemoAccount !== 'function') {
      throw new Error('createIfMissing requires findDemoAccount and createDemoAccount adapter hooks');
    }
    account = await adapter.createDemoAccount(base);
    accountCreated = true;
  }

  return { account, accountCreated };
}

async function authenticateAndResolveWorkspace({ profile, adapter, credentials, context, account }) {
  const accountContext = hookContext({ profile, context, credentials, account });
  if (typeof adapter.authenticateDemoAccount === 'function') await adapter.authenticateDemoAccount(accountContext);

  if (profile.workspace?.strategy === 'snapshot' && typeof adapter.importDemoSnapshot === 'function') {
    await adapter.importDemoSnapshot(accountContext);
  }

  let workspace = null;
  if (typeof adapter.ensureDemoWorkspace === 'function') {
    workspace = await adapter.ensureDemoWorkspace(accountContext);
  }
  return workspace;
}

async function resetWorkspaceIfRequested({ profile, adapter, credentials, context, account, workspace, policy }) {
  if (policy == null || policy === false) return false;
  if (workspace?.demo !== true) {
    throw new Error('Refusing destructive reset outside an explicitly marked demo workspace');
  }
  if (typeof adapter.resetDemoWorkspace !== 'function') {
    throw new Error('Demo workspace reset requested but adapter.resetDemoWorkspace is not implemented');
  }
  await adapter.resetDemoWorkspace(hookContext({ profile, context, credentials, account, workspace }), policy);
  return true;
}

async function seedFixtures({ profile, adapter, credentials, context, account, workspace }) {
  const fixtureIds = profile.fixtures || [];
  if (fixtureIds.length === 0) return [];
  if (typeof adapter.seedDemoFixtures !== 'function') {
    throw new Error('Demo fixtures requested but adapter.seedDemoFixtures is not implemented');
  }
  const registry = createFixtureRegistry(adapter.fixturePacks || []);
  const fixtures = resolveFixturePacks(registry, fixtureIds);
  await adapter.seedDemoFixtures(hookContext({ profile, context, credentials, account, workspace, fixtures }), fixtures);
  return fixtures;
}

export async function prepareDemoProfile({ profile, adapter, env = process.env, context = {} }) {
  if (!profile) return null;
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Demo adapter is required');
  const credentials = resolveDemoCredentials(profile, env);
  const { account, accountCreated } = await findOrCreateAccount({ profile, adapter, credentials, context });
  const workspace = await authenticateAndResolveWorkspace({ profile, adapter, credentials, context, account });
  await resetWorkspaceIfRequested({
    profile,
    adapter,
    credentials,
    context,
    account,
    workspace,
    policy: profile.workspace?.resetBeforeRun,
  });
  const fixtures = await seedFixtures({ profile, adapter, credentials, context, account, workspace });
  return {
    account,
    workspace,
    credentials,
    secretValues: collectProfileSecretValues(profile, env),
    metadata: publicMetadata({ profile, accountCreated, account, workspace, fixtures, env }),
    accountCreated,
    fixtures,
  };
}

export async function resetDemoProfile({ profile, adapter, env = process.env, context = {}, policy }) {
  if (!profile) throw new TypeError('Demo profile is required');
  const credentials = resolveDemoCredentials(profile, env);
  const { account } = await findOrCreateAccount({ profile: { ...profile, account: { ...(profile.account || {}), createIfMissing: false } }, adapter, credentials, context });
  const workspace = await authenticateAndResolveWorkspace({ profile, adapter, credentials, context, account });
  const resetPolicy = policy ?? profile.workspace?.resetBeforeRun ?? 'baseline';
  await resetWorkspaceIfRequested({ profile, adapter, credentials, context, account, workspace, policy: resetPolicy });
  return publicMetadata({ profile, accountCreated: false, account, workspace, env });
}

export async function getDemoProfileStatus({ profile, adapter, env = process.env, context = {} }) {
  if (!profile) throw new TypeError('Demo profile is required');
  const credentials = resolveDemoCredentials(profile, env);
  const base = hookContext({ profile, context, credentials });
  if (typeof adapter.getDemoProfileStatus === 'function') {
    const status = await adapter.getDemoProfileStatus(base);
    return publicMetadata({ profile, accountCreated: false, account: null, workspace: null, extra: status, env });
  }
  const account = typeof adapter.findDemoAccount === 'function' ? await adapter.findDemoAccount(base) : null;
  return {
    ...publicMetadata({ profile, accountCreated: false, account, workspace: null, env }),
    exists: Boolean(account),
  };
}

export async function finalizeDemoProfile({ profile, adapter, prepared, context = {} }) {
  if (!profile || !prepared) return null;
  if (profile.workspace?.strategy !== 'snapshot' || typeof adapter.exportDemoSnapshot !== 'function') return prepared.metadata;
  await adapter.exportDemoSnapshot(hookContext({
    profile,
    context,
    credentials: prepared.credentials,
    account: prepared.account,
    workspace: prepared.workspace,
    fixtures: prepared.fixtures,
  }));
  return prepared.metadata;
}
