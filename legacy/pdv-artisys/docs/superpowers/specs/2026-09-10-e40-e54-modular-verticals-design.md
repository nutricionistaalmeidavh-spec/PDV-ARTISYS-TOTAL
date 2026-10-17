# PDV ArtiSys — E40–E54 Design

> **Atualização de licenciamento (2026-10-04):** a antiga restrição de “sem licença online” abaixo foi superada para a distribuição comercial. O produto oficial exige ativação inicial pela ArtiSys; local-first/self-hosted continua descrevendo a arquitetura e a operação diária, não gratuidade para clientes.

## Status

Design aprovado em conversa em 2026-09-10. Esta especificação parte do estado atual pós-1.1.1 e define a evolução E40–E54 como uma expansão modular do mesmo PDV local-first, sem criar produtos separados por nicho.

## Objetivo

Transformar o ArtiSys PDV em um produto único capaz de atender diferentes tipos de estabelecimento através de módulos opcionais ativáveis, preservando um único núcleo transacional de venda, caixa, estoque, impressão, auditoria e dados.

O escopo cobre:

- catálogo avançado com adicionais, variações e combos;
- ficha técnica e consumo de insumos;
- motor de módulos opcionais;
- verticais de pizzaria, restaurante avançado, delivery, fast-food, mercado/padaria, varejo, serviços, oficina e autoatendimento;
- wizard inicial por segmento;
- acesso mobile local simplificado por QR Code;
- infraestrutura de validação/homologação de periféricos.

## Regras não negociáveis

- O sistema permanece **local-first** e operacional sem internet.
- O servidor local continua sendo a única autoridade sobre o SQLite.
- Terminais e dispositivos móveis continuam usando API local/LAN; nunca acesso direto ao banco.
- Não haverá SaaS, nuvem, CDN, licença online ou serviço pago obrigatório para o core.
- Todos os módulos definidos aqui fazem parte do mesmo produto e do mesmo instalador; o cliente apenas ativa ou desativa o que usa.
- Ativação de módulo é configuração funcional, não paywall nem mecanismo de cobrança.
- O `SaleService` continua sendo o motor canônico para conclusão de vendas.
- Estoque, caixa, impressão e auditoria não serão duplicados por vertical.
- Dinheiro continua representado em centavos inteiros.
- Operações mutáveis críticas continuam idempotentes.
- EventBus + outbox continuam sendo a fronteira para efeitos derivados.
- Renderer Electron continua sem acesso direto a Node, SQLite, filesystem ou serial genérico.
- Hardware continua atrás dos módulos locais `@artisys/printing` e `@artisys/serialport`/runtime de hardware existente.
- **Regra fiscal fixa:** o produto comercial opera somente com documentos e impressão **NÃO FISCAL**.
- Não haverá NFC-e, NF-e, SAT, MFE, SEFAZ, certificado digital nem provedor fiscal no fluxo comercial.
- Qualquer impressão de venda deve ser claramente identificada como **NÃO FISCAL** e nunca apresentada como substituta de documento fiscal.
- Código fiscal legado existente não pode ser dependência de execução das novas entregas e deve ficar fora da UI/fluxos comerciais; remoções destrutivas de schema legado não fazem parte deste escopo.
- **Regra de pagamentos:** pagamentos são registrados manualmente no PDV. Não haverá TEF, PinPad, API bancária, adquirente ou confirmação automática de PIX neste escopo.
- Formas manuais suportadas pelo núcleo permanecem, por exemplo: dinheiro, PIX, débito, crédito e outros meios configuráveis.
- E54 pode concluir software, diagnóstico, testes e matriz de compatibilidade, mas a validação física de equipamento que não esteja disponível deve ser marcada `BLOCKED_EXTERNAL` até teste real.

## Estado de partida

A linha atual já contém:

- núcleo de venda, caixa, estoque, financeiro e relatórios;
- restaurante com mesas/comandas;
- KDS/cozinha;
- dispositivos LAN de garçom, tablet de mesa e cozinha;
- impressão não fiscal persistida;
- multi-terminal LAN;
- backup/restore;
- importação;
- auditoria, observabilidade e QA;
- `@artisys/printing` e `@artisys/serialport` integrados localmente.

E40–E54 devem ampliar essa base, não substituí-la.

---

# Arquitetura modular transversal

## Registro de módulos

Criar um registro canônico de módulos no core, com identificadores estáveis:

- `RESTAURANT`
- `PIZZERIA`
- `DELIVERY`
- `FAST_FOOD`
- `MARKET_BAKERY`
- `RETAIL`
- `SERVICES`
- `WORKSHOP`
- `SELF_SERVICE`

O núcleo básico do PDV não é módulo desativável.

Cada módulo declara:

- id;
- nome;
- descrição curta;
- dependências funcionais;
- recursos/capabilities expostos;
- rotas/UI que devem ficar disponíveis;
- status `ENABLED|DISABLED`.

A ativação é persistida localmente em settings e auditada.

## Regra de isolamento

Desativar um módulo deve:

- esconder suas telas e atalhos;
- bloquear criação de novas operações específicas por API;
- manter dados históricos existentes legíveis para auditoria/relatórios quando necessário;
- nunca apagar dados automaticamente.

Ativar um módulo deve ser reversível sem reinstalação.

## Dependências

Exemplos:

- `PIZZERIA` pode reutilizar recursos de catálogo avançado e produção/KDS, mas não deve obrigar `RESTAURANT` se o negócio operar apenas retirada/delivery.
- `DELIVERY` pode funcionar com `PIZZERIA`, `FAST_FOOD` ou sozinho.
- `SELF_SERVICE` reutiliza catálogo/pedidos e deve funcionar apenas com fluxos explicitamente habilitados pelo administrador.
- `SERVICES` e `WORKSHOP` não dependem de mesas/KDS.

## Gating de backend e UI

O bloqueio não pode existir apenas visualmente. Cada endpoint/serviço específico deve validar a capability/módulo necessário antes de executar mutação.

O frontend lê o registro de módulos e monta navegação/telas dinamicamente.

---

# E40 — Adicionais, complementos, variações e combos

## Objetivo

Criar um modelo genérico de customização de produto reutilizável por pizzaria, lanchonete, açaí, varejo e outros nichos.

## Capacidades

- grupos de opções por produto;
- seleção única ou múltipla;
- mínimo/máximo de escolhas;
- opção obrigatória ou opcional;
- acréscimo ou redução de preço em centavos;
- variações com SKU/código quando aplicável;
- combos formados por etapas/grupos;
- snapshot das escolhas no item da venda/pedido;
- descrição imprimível das escolhas.

Exemplos:

- tamanho P/M/G;
- ponto da carne;
- adicionais de bacon/queijo;
- remover ingrediente;
- escolha de bebida do combo;
- cor/tamanho no varejo.

## Regra de preço

O preço final do item deve ser calculado deterministicamente a partir de:

`preço base + variação + opções + regras do combo`

O valor efetivamente vendido fica snapshotted no item, para preservar histórico mesmo após edição de cadastro.

## Integração

- Balcão;
- restaurante/comandas;
- mobile garçom/tablet;
- autoatendimento futuro;
- impressão não fiscal;
- relatórios.

---

# E41 — Ficha técnica, ingredientes e baixa de insumos

## Objetivo

Permitir controlar estoque de ingredientes/insumos consumidos na venda de produtos preparados.

## Modelo

Cada produto preparado pode possuir uma ficha técnica versionada com componentes:

- ingrediente/produto de estoque;
- quantidade;
- unidade base;
- fator de conversão quando necessário;
- perda opcional configurada.

Exemplo:

`X-Bacon -> pão 1 un + carne 0,150 kg + queijo 2 un + bacon 0,040 kg`

## Estoque

A conclusão da venda continua passando pelo mecanismo canônico de estoque. Para item com ficha técnica:

- não reduzir estoque do produto final se ele for marcado como produzido/sem estoque próprio;
- reduzir os insumos rastreados;
- registrar movimentos no ledger existente;
- usar referência idempotente ligada à venda/item;
- devolver insumos proporcionalmente quando uma devolução válida exigir reversão de estoque.

## Custo

Calcular custo teórico do produto a partir dos componentes e seus custos atuais, sem alterar o snapshot histórico de custo da venda já concluída.

## Escopo excluído

Não é MRP industrial completo. Não inclui ordem de produção, lote fabril ou planejamento avançado de produção nesta entrega.

---

# E42 — Motor de módulos opcionais

## Objetivo

Permitir que um único instalador adapte o produto ao estabelecimento sem poluir a interface.

## Fluxo

Em `Configurações > Módulos`, administrador pode habilitar/desabilitar módulos permitidos.

Todos os módulos do produto estão disponíveis sem compra adicional nesta fase.

## Requisitos

- persistência local;
- audit trail;
- dependências validadas;
- API de capabilities;
- UI dinâmica;
- testes garantindo que módulo desativado não aceita mutações específicas;
- dados históricos preservados.

---

# E43 — Módulo Pizzaria

## Objetivo

Atender regras específicas de pizza sem contaminá-las no catálogo genérico.

## Capacidades

- tamanhos;
- sabores;
- número máximo de sabores por tamanho;
- meio a meio e múltiplos sabores;
- bordas;
- adicionais;
- observações;
- regras de preço configuráveis por estabelecimento.

## Regra de preço de múltiplos sabores

O administrador escolhe explicitamente entre políticas suportadas, por exemplo:

- maior preço entre sabores selecionados;
- média proporcional dos sabores.

Não haverá regra implícita fixa.

## Produção

A impressão/KDS deve mostrar claramente tamanho, sabores, frações, borda e adicionais.

---

# E44 — Restaurante avançado

## Objetivo

Completar operações comuns de salão sobre o restaurante já existente.

## Capacidades

- dividir conta por item;
- dividir valor igualmente;
- pagamento parcial;
- taxa de serviço configurável, inclusive 10%;
- couvert como item/taxa configurável;
- juntar mesas;
- transferir itens selecionados entre mesas/sessões;
- cancelamento de item com motivo;
- autorização por papel para cancelamentos sensíveis;
- trilha de auditoria.

## Regra transacional

Mesmo com divisão de conta, cada fechamento gera venda(s) canônica(s) pelo `SaleService`. A sessão de mesa só fecha quando não restarem itens/saldos pendentes.

---

# E45 — Módulo Delivery

## Objetivo

Controlar entrega e retirada sem serviço externo obrigatório.

## Capacidades

- cliente;
- telefone;
- endereços;
- bairro/região;
- taxa de entrega;
- retirada no balcão;
- entregador/motoboy;
- observações;
- previsão manual de entrega;
- status operacional.

Status mínimos:

`NEW -> PREPARING -> READY -> OUT_FOR_DELIVERY -> DELIVERED`

Para retirada:

`NEW -> PREPARING -> READY -> PICKED_UP`

Cancelamento deve exigir motivo e respeitar permissões.

## Pagamento

O módulo registra forma de pagamento manual. Não integra maquininha, banco ou gateway.

---

# E46 — Módulo Fast-food/Lanchonete

## Objetivo

Otimizar operação rápida de balcão/retirada.

## Capacidades

- combos apoiados pelo E40;
- adicionais;
- geração de número/senha do pedido;
- fila de produção;
- status preparando/pronto/entregue;
- retirada no balcão;
- painel simples de pedidos prontos na LAN quando ativado.

O fluxo deve reutilizar pedido/venda existentes e KDS quando habilitado.

---

# E47 — Módulo Mercado/Conveniência/Padaria

## Objetivo

Atender varejo alimentar com alta velocidade e itens por peso.

## Capacidades

- produtos por unidade ou peso;
- leitura de peso via adaptador existente quando configurado;
- entrada manual de peso como fallback operacional;
- etiquetas/códigos de balança conforme formatos explicitamente suportados;
- consulta rápida de preço;
- estoque mínimo;
- fluxo de balcão otimizado para teclado/leitor;
- encomenda/retirada simples para padaria.

## Limite

Formatos específicos de etiqueta de balança só podem ser declarados compatíveis após teste documentado em E54.

---

# E48 — Módulo Varejo

## Objetivo

Atender roupas, calçados, acessórios e comércio com variantes.

## Capacidades

- grade de variações como cor/tamanho;
- SKU/código de barras por variante;
- preço/custo por variante quando necessário;
- saldo de estoque por variante;
- busca por produto pai ou variante;
- relatórios agregados e detalhados.

O motor genérico de variações deve reutilizar E40, evitando um segundo modelo paralelo.

---

# E49 — Módulo Serviços

## Objetivo

Atender estabelecimentos que vendem serviços junto ou sem produtos.

## Capacidades

- cadastro de serviços;
- duração estimada;
- agenda local;
- profissionais;
- vínculo serviço-profissional;
- comissão configurável;
- status de atendimento;
- venda de serviço pelo fluxo canônico do PDV;
- produtos adicionais na mesma venda.

## Agenda

A agenda é local e não sincroniza Google/Outlook neste escopo.

---

# E50 — Módulo Oficina

## Objetivo

Atender oficina mecânica e serviços técnicos básicos.

## Capacidades

- cadastro de veículo/equipamento vinculado ao cliente;
- ordem de serviço;
- sintomas/relato;
- diagnóstico;
- itens/peças;
- mão de obra;
- orçamento;
- aprovação manual registrada;
- status da OS;
- fechamento da OS em venda canônica.

Status mínimos:

`OPEN -> DIAGNOSIS -> QUOTED -> APPROVED -> IN_PROGRESS -> READY -> CLOSED`

Cancelamento exige motivo.

---

# E51 — Módulo Autoatendimento

## Objetivo

Permitir pedido pelo próprio cliente em tablet/totem local.

## Capacidades

- catálogo visual;
- categorias;
- adicionais/variações;
- carrinho;
- observações;
- envio para produção;
- número do pedido;
- modo mesa quando vinculado a mesa;
- modo retirada quando configurado.

## Segurança

- dispositivo pareado/vinculado;
- sem acesso administrativo;
- sem acesso a caixa/relatórios/configurações;
- cliente não escolhe livremente identidade de mesa quando dispositivo estiver fixado.

## Pagamento

Nenhum pagamento eletrônico integrado. Quando necessário, o pedido segue para pagamento manual no caixa/atendimento definido pelo estabelecimento.

---

# E52 — Wizard inicial por segmento

## Objetivo

Esconder a complexidade técnica da configuração inicial.

## Fluxo sugerido

1. identificar estabelecimento;
2. escolher segmento principal;
3. recomendar módulos;
4. confirmar módulos ativos;
5. configurar caixa básico;
6. configurar impressão opcional;
7. configurar rede/mobile opcional;
8. criar primeiro usuário administrador/operacional conforme fluxo atual;
9. concluir e abrir dashboard adequado.

## Perfis sugeridos

- Restaurante;
- Pizzaria;
- Lanchonete/Fast-food;
- Mercado/Conveniência;
- Padaria;
- Loja/Varejo;
- Serviços;
- Oficina;
- Genérico.

A recomendação é editável e nunca bloqueia combinação personalizada.

---

# E53 — QR Code e acesso mobile local simplificado

## Objetivo

Reduzir configuração manual de IP/URL para dispositivos da LAN.

## Capacidades

- servidor mostra URL LAN atual;
- gera QR Code localmente, sem serviço externo;
- QR aponta para `/mobile` ou fluxo de pareamento específico;
- criação de dispositivo continua gerando credencial individual;
- UI orienta copiar/ler credencial quando necessário;
- diagnóstico informa se dispositivo e servidor estão na mesma rede e se a porta está acessível.

## Regra de segurança

O transporte continua HTTP em LAN confiável. Não será apresentado como HTTPS nem exposto diretamente à internet.

## Regra de produto

Não chamar esta interface de PWA compatível/instalável enquanto os requisitos técnicos de instalação segura não forem realmente atendidos. O objetivo de E53 é acesso local simples por QR, não alegação de PWA.

---

# E54 — Infraestrutura de homologação de periféricos

## Objetivo

Transformar suporte de hardware em evidência verificável, sem prometer modelos não testados.

## Capacidades de software

- tela/diagnóstico de hardware;
- teste de impressão;
- teste de abertura de gaveta;
- leitura de balança;
- detecção/seleção explícita de porta serial;
- status do driver;
- configuração de baud/paridade/stop bits quando aplicável;
- captura de erro sanitizada;
- exportação de diagnóstico;
- matriz de compatibilidade versionada no repositório.

## Matriz

Cada combinação recebe status:

- `VERIFIED`
- `PARTIAL`
- `UNSUPPORTED`
- `BLOCKED_EXTERNAL`

Evidência deve registrar:

- fabricante/modelo;
- tipo de conexão;
- driver;
- configuração;
- sistema operacional;
- data do teste;
- resultado;
- limitações conhecidas.

## Critério de conclusão

E54 está concluída quando a infraestrutura de teste, documentação e matriz estiverem implementadas e verificadas por testes automatizados. Modelos físicos indisponíveis permanecem `BLOCKED_EXTERNAL` e não impedem a conclusão do software.

---

# Política não fiscal

Durante E40–E54, toda superfície comercial deve convergir para o caminho não fiscal.

## UI

- remover/ocultar opções fiscais da experiência comum;
- não oferecer emissão NFC-e/NF-e;
- documentos impressos usam nomenclatura não fiscal;
- configurações novas não solicitam certificado ou credencial fiscal.

## Runtime

- novas funcionalidades não importam nem dependem do domínio fiscal;
- o caminho de impressão não fiscal continua independente;
- código/schema legado pode permanecer temporariamente apenas para compatibilidade e migração segura, sem ser capability comercial ativa.

## Documentação

README, capabilities, limitations e manuais de operação devem deixar explícito que o ArtiSys PDV desta linha é **não fiscal**.

---

# Política de pagamentos manuais

O sistema registra o meio informado pelo operador e fecha a venda contabilmente no PDV.

Não faz parte de E40–E54:

- TEF;
- automação de maquininha;
- PinPad;
- adquirentes;
- checkout online;
- confirmação automática de PIX;
- API bancária;
- gateway de pagamento.

Esse desenho mantém o sistema sem dependência técnica paga e reduz suporte externo.

---

# Dados e migrations

Novas tabelas devem ser adicionadas por migrations incrementais e não destrutivas.

Princípios:

- IDs estáveis;
- timestamps persistidos;
- status enumerados/validados;
- chaves únicas para idempotência onde necessário;
- índices para consultas operacionais;
- snapshots em vendas/pedidos para preservar histórico;
- não apagar estruturas antigas automaticamente;
- backup pré-migration continua obrigatório pelo processo existente.

O número exato da próxima versão de schema será definido no plano de implementação após inspeção final das migrations em `main`.

---

# API e LAN

Novas APIs seguem `/api/v1` e os padrões já existentes.

Regras:

- autenticação/terminal/device conforme perfil;
- RBAC no servidor;
- capability/module guard no servidor;
- `mutationId` para mutações críticas;
- respostas determinísticas para retries;
- sem CORS amplo desnecessário;
- sem exposição à internet;
- tablets/dispositivos específicos recebem apenas capabilities necessárias.

---

# UI desktop e mobile

## Desktop

A navegação é composta a partir dos módulos ativos.

O usuário de mercado não deve ver Pizzaria/OS/mesas; o usuário de oficina não deve ver KDS se não estiver habilitado.

## Mobile

A aplicação local continua servida pelo próprio servidor.

A UI muda por tipo de dispositivo e módulos ativos:

- garçom;
- tablet de mesa;
- cozinha;
- autoatendimento;
- painel de retirada quando aplicável.

Nenhuma dependência de CDN/framework remoto será introduzida.

---

# Impressão

Todas as novas saídas usam o caminho local já existente.

Documentos possíveis incluem:

- cupom/recibo de venda não fiscal;
- pré-conta;
- ticket de cozinha;
- senha de pedido;
- pedido delivery;
- ordem de serviço/orçamento;
- fechamento de caixa.

Quando o documento puder ser confundido com comprovante fiscal, deve conter indicação clara de **NÃO FISCAL**.

---

# Auditoria e permissões

Devem gerar auditoria, quando aplicável:

- ativar/desativar módulo;
- cancelamento de item/pedido;
- transferência/divisão de mesa;
- alteração de taxa de serviço;
- alteração de regra de preço de pizza;
- aprovação/cancelamento de OS;
- alteração de ficha técnica;
- alteração de comissão;
- bloqueio/rotação de dispositivo;
- alterações críticas de hardware.

Papéis existentes devem ser estendidos minimamente, evitando uma matriz completamente nova quando permissões atuais forem suficientes.

---

# Estratégia de testes

Cada entrega deve possuir testes de domínio e integração; rotas e UI críticas devem entrar nos gates existentes.

## Gates mínimos

- `npm test`;
- lint/check dos novos arquivos;
- `npm run verify`;
- `npm run verify:release` antes de qualquer release posterior;
- testes de migrations;
- testes de module gating;
- testes de idempotência de mutações críticas;
- fluxo completo de venda por cada vertical que fecha em `SaleService`;
- fluxo de estoque/ficha técnica;
- regressão do restaurante E30–E39;
- regressão de impressão e hardware local.

## Cenários obrigatórios

1. PDV com todos os módulos desligados continua operando balcão/caixa/estoque.
2. Habilitar e desabilitar módulo não perde histórico.
3. Pizzaria calcula preço determinístico e imprime composição correta.
4. Ficha técnica baixa insumos uma única vez mesmo com retry de evento.
5. Divisão de conta não duplica venda nem estoque.
6. Delivery não exige internet.
7. Varejo controla saldo por variante.
8. Serviço/OS fecha no motor canônico de venda.
9. Autoatendimento não acessa funções administrativas.
10. Nenhuma nova rota fiscal é necessária para operar.
11. Nenhum pagamento depende de serviço externo.
12. E54 diferencia suporte implementado de hardware fisicamente verificado.

---

# Ordem de implementação

A ordem recomendada preserva dependências:

1. E40 — catálogo avançado;
2. E41 — ficha técnica/insumos;
3. E42 — motor de módulos;
4. E43 — pizzaria;
5. E44 — restaurante avançado;
6. E45 — delivery;
7. E46 — fast-food;
8. E47 — mercado/conveniência/padaria;
9. E48 — varejo;
10. E49 — serviços;
11. E50 — oficina;
12. E51 — autoatendimento;
13. E52 — wizard;
14. E53 — QR/mobile;
15. E54 — homologação/diagnóstico de hardware.

Implementações podem compartilhar migrations/componentes quando isso reduzir risco, mas cada E deve continuar tendo critérios de aceite próprios.

---

# Fora do escopo E40–E54

- emissão fiscal;
- NFC-e/NF-e/SAT/MFE;
- TEF/PinPad;
- integração bancária/PIX automático;
- marketplace/iFood;
- e-commerce;
- sincronização em nuvem;
- operação offline independente de cada terminal com reconciliação posterior;
- assinatura/licenciamento por módulo;
- cobrança recorrente;
- app nativo iOS/Android;
- MRP/ERP industrial completo;
- contabilidade/fiscal tributária.

---

# Critério global de aceite

E40–E54 somente podem ser considerados entregues quando:

- cada capability estiver implementada no núcleo existente, sem motor paralelo de venda/estoque/caixa;
- módulos puderem ser ativados/desativados com proteção no backend e UI;
- regressões E01–E39 continuarem verdes;
- operação principal continuar local-first e sem internet;
- não houver dependência fiscal ou de pagamento eletrônico;
- toda impressão de venda permanecer não fiscal;
- testes automatizados cobrirem os fluxos críticos;
- limitações de hardware físico estiverem explicitamente marcadas, sem alegações não verificadas.
