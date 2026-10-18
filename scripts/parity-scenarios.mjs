// A scenario inventory is a PLAN, not proof. No inferred "pass" status.
import {DESKTOP_REPO,DESKTOP_SHA,WEB_REPO,requireProof} from './parity-rules.mjs';

const DIMENSIONS=['nominal','authorization','tenant-isolation','failure-recovery'];
const PHYSICAL=/printer|print|impress|thermal|peripheral|serial|balan|scale|barcode|gaveta|drawer|hardware|physical|device|lan|kds|peso|weighted|weight|terminal/i;

const EXPECTATIONS={
  nominal:({name,acceptance})=>({
    given:'Dados fixos e equivalentes para a operação "'+name+'" na versão desktop e na web.',
    when:'Executar as mesmas ações na origem fixada e no núcleo/API web.',
    then:acceptance,
    compare:'Confrontar estado persistido, valores exatos, efeitos colaterais e respostas; anexar fixture e teste reproduzível.'
  }),
  authorization:({name})=>({
    given:'Dois atores da mesma empresa: perfil permitido e perfil sem permissão para "'+name+'".',
    when:'Repetir a operação no desktop e na API/web com cada perfil.',
    then:'O perfil autorizado executa; o não autorizado não altera dados nem produz efeitos externos.',
    compare:'Comparar autorização por papel, resposta de erro e invariância das tabelas de negócio.'
  }),
  'tenant-isolation':({name})=>({
    given:'Duas empresas A e B com dados e sessões autenticadas separadas para "'+name+'".',
    when:'Tentar consultar ou alterar dados de B com sessão de A, inclusive IDs conhecidos.',
    then:'Nenhum registro, pagamento, saldo ou dado pessoal atravessa o escopo da empresa.',
    compare:'Comparar visibilidade e persistência antes/depois em ambas as empresas.'
  }),
  'failure-recovery':({name})=>({
    given:'Operação "'+name+'" com tentativa duplicada, falha de infraestrutura e repetição.',
    when:'Injetar a falha antes/depois da confirmação e reexecutar com a mesma chave quando cabível.',
    then:'Sem escrita parcial, efeito duplicado, débito indevido ou perda de rastreabilidade; recuperação equivalente.',
    compare:'Comparar estado anterior e posterior, contagens de lançamento, logs sanitizados e trilha de auditoria.'
  }),
  'physical-device':({name})=>({
    given:'Equipamento e versões de driver/protocolo identificados para "'+name+'", com bancada documentada.',
    when:'Executar ciclo real, desconexão/reconexão e repetição da tarefa no desktop e na ponte web.',
    then:'Resultado equivalente no dispositivo físico e recuperação após falha, com evidência independente.',
    compare:'Exigir modelo, firmware, OS, observação sem dados pessoais, evidência física e assinatura de homologação.'
  })
};

export function buildScenarioCatalog(matrix,inventory){
  requireProof(Array.isArray(matrix?.modules)&&Array.isArray(inventory?.contracts),'missing P0 inventories');
  requireProof(matrix.desktop?.commit===DESKTOP_SHA && inventory.baseline?.commit===DESKTOP_SHA,
    'P0 scenarios must use the pinned desktop baseline');
  const entries=[
    ...matrix.modules.flatMap(module=>module.contracts.map(contract=>({contract,module:module.id,
      scope:'seven-screen-operations',desktopFiles:module.desktopEvidence||[]}))),
    ...inventory.contracts.map(contract=>({contract,module:contract.owner,
      scope:'full-desktop',desktopFiles:[contract.sourceEvidence?.file]}))
  ];
  const ids=new Set();
  return entries.flatMap(({contract,module,scope,desktopFiles})=>{
    requireProof(typeof contract.id==='string'&&!ids.has(contract.id),'duplicate scenario contract '+contract.id);
    ids.add(contract.id);
    const name=contract.name||contract.capability;
    requireProof(typeof name==='string'&&typeof contract.acceptance==='string',
      'missing scenario subject or acceptance '+contract.id);
    const dims=PHYSICAL.test(name)?[...DIMENSIONS,'physical-device']:DIMENSIONS;
    return dims.map(dimension=>{
      const expected=EXPECTATIONS[dimension]({name,acceptance:contract.acceptance});
      return {
        id:contract.id+'/'+dimension,contractId:contract.id,scope,module,dimension,
        subject:name,expected,
        desktopSource:{repo:DESKTOP_REPO,commit:DESKTOP_SHA,files:desktopFiles},
        webSource:{repo:WEB_REPO,evidence:contract.webEvidence||null},
        state:'pending-independent-comparison'
      };
    });
  });
}

const RUNNERS={
  'node-test':/^(?:apps\/api\/test\/[^/]+\.test\.mjs|packages\/core\/test\/[^/]+\.test\.js|scripts\/[^/]+\.test\.mjs)$/,
  playwright:/^scripts\/web-browser-e2e\.mjs$/
};
export function validateScenarioEvidence(scenarios,registry,readSource){
  requireProof(registry?.schemaVersion===1 && registry.desktopBaselineCommit===DESKTOP_SHA,
    'P0 evidence registry baseline mismatch');
  requireProof(Array.isArray(registry.results),'P0 evidence results must be an array');
  const scenarioById=new Map(scenarios.map(s=>[s.id,s]));
  requireProof(scenarioById.size===scenarios.length,'P0 catalog duplicates scenario IDs');
  const seen=new Set();
  for(const result of registry.results){
    requireProof(!seen.has(result.scenarioId),'duplicate P0 scenario evidence '+result.scenarioId);
    seen.add(result.scenarioId);
    const scenario=scenarioById.get(result.scenarioId);
    requireProof(scenario,'unknown scenario evidence '+result.scenarioId);
    requireProof(result.desktopBaselineCommit===DESKTOP_SHA,'scenario proof not bound to pinned desktop '+result.scenarioId);
    requireProof(typeof result.desktopFixtureId==='string'&&result.desktopFixtureId.trim().length>=8,
      'scenario proof lacks desktop fixture '+result.scenarioId);
    if(result.method==='automated'){
      requireProof(RUNNERS[result.testRunner]?.test(result.testFile),
        'scenario proof not in executed Node/Chromium suite '+result.scenarioId);
      requireProof(typeof result.testContains==='string'&&result.testContains.length>=8&&
        typeof result.testAssertionContains==='string'&&/^(?:await\s+)?assert\./.test(result.testAssertionContains),
        'scenario evidence missing executable assertion '+result.scenarioId);
      const source=readSource(result.testFile);
      const at=source.indexOf(result.testContains);
      requireProof(at>=0 && source.slice(at,at+8000).includes(result.testAssertionContains),
        'scenario assertion not attached to named test '+result.scenarioId);
      requireProof(typeof result.fixtureFile==='string'&&/^docs\/parity\/fixtures\/[a-z0-9-]+\.json$/.test(result.fixtureFile),
        'scenario proof missing versioned input/expected fixture '+result.scenarioId);
      requireProof(readSource(result.fixtureFile).includes(result.desktopFixtureId),
        'scenario desktop fixture missing from reference file '+result.scenarioId);
    }else if(result.method==='physical'){
      requireProof(scenario.dimension==='physical-device','physical evidence may only certify physical-device scenarios');
      requireProof(typeof result.deviceModel==='string'&&result.deviceModel.length>=3&&
        typeof result.platform==='string'&&result.platform.length>=3&&
        typeof result.independentReviewer==='string'&&result.independentReviewer.length>=3&&
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull|actions\/runs)\/[0-9]+/.test(result.reviewUrl||''),
        'physical scenario requires independent hardware evidence '+result.scenarioId);
    }else{
      requireProof(false,'unsupported P0 proof method '+result.scenarioId);
    }
  }
  return {total:scenarios.length,verified:seen.size,pending:scenarios.length-seen.size,
    complete:scenarios.length>0&&seen.size===scenarios.length};
}
