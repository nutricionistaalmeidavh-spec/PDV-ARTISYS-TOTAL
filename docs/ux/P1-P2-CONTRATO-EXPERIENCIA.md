# P1/P2 — contrato de experiência e canonicidade

**Modo:** desenho preventivo de fluxo, com base na estrutura e contratos existentes do PDV desktop. Não é uma auditoria visual de telas em execução. Nenhum renderer paralelo foi criado; o renderer original foi transferido para `apps/web/` e está em adaptação.

## Usuários e tarefas

- **Proprietário/administrador:** entrar, reconhecer a empresa selecionada e verificar sua filial antes de operar. A criação inicial de empresa é uma tarefa administrativa explícita, atualmente somente por CLI.
- **Gerente:** entrar na empresa à qual foi vinculado, acessar somente o que seu perfil canônico autoriza, reconhecer quando perdeu acesso.
- **Operador/caixa:** entrar, reconhecer empresa e filial para não fazer lançamentos no estabelecimento errado; no estágio P1/P2 ainda não há operações comerciais disponíveis.
- **ArtiSys:** verificar isolamento e saúde da API sem entrar em bancos de cliente nem reutilizar licenças desktop.

## Modelo mental versus modelo técnico

| Conceito para a pessoa | Identidade e relação | Contrato implementado |
| --- | --- | --- |
| Minha conta | `users.id` | E-mail global normalizado, conta ativa/inativa |
| Empresa/estabelecimento | `tenants.id` | Uma mesma conta pode pertencer a mais de uma empresa, mas não herda permissões entre elas |
| Meu acesso nessa empresa | `(tenant_id,user_id)` | Perfil canônico por vínculo ativo; `OWNER` herda `ADMINISTRATOR` somente no próprio tenant |
| Filial | `(tenant_id,branches.id)` | Filiais sempre lidas em consulta filtrada pelo tenant efetivamente autorizado |
| Minha sessão | hash de token HTTP | Sessão durável, revogável e com prazo de expiração; dados não ficam em sessão global do Worker |
| Venda/caixa/estoque | entidades de domínio originais | **Não migradas**; não há novo endpoint ou caminho de gravação |

## Caminho proposto (sem inventar uma segunda UI)

1. **Entrar:** aproveitar o overlay de autenticação que já existe em `apps/web/index.html`, em etapa futura de adaptação web. Não adicioná-lo de novo.
2. **Reconhecer empresa:** a API fornece empresas acessíveis; caso haja mais de uma, a mesma topbar canônica deve permitir a escolha, exibindo nome e identidade da empresa.
3. **Reconhecer filial:** quando o fluxo exigir filial, selecionar apenas entre as disponibilizadas pela API para aquela empresa. A escolha de filial não autoriza outras empresas.
4. **Acessar o trabalho:** primeiro um gate de sessão/vínculo ativo; depois o serviço de autorização original; depois os serviços de negócio existentes. Nenhum segundo `SaleService` e nenhuma gravação direta pela UI.
5. **Confirmar:** após mutações comerciais futuras, refletir somente o estado confirmado e relido do servidor. Não confirmar a venda por clique ou toast otimista.
6. **Recuperar:** se sessão expira, preserva o preenchimento não sensível enquanto reautentica; se empresa/filial foi desativada, informar que o acesso foi retirado e permitir escolher outra empresa autorizada. Não alternar silenciosamente a empresa durante operação de caixa.

## Estados que a futura UI deverá apresentar

| Estado | Feedback esperado | Recuperação |
| --- | --- | --- |
| Validando credenciais | Progressão local; um envio por vez | Botão reabilitado após falha |
| Credenciais inválidas | Erro genérico de login, sem revelar existência de conta | Corrigir senha ou recuperar acesso (fluxo ainda não implementado) |
| Tentativas bloqueadas | Aviso de tentativas excessivas | Aguardar política validada; nunca afirmar prazo não confirmado na UI |
| Empresa sem vínculo ativo | Negação sem dados do tenant | Selecionar outro vínculo válido ou contatar administrador |
| Sessão expirada/revogada | Solicitar autenticação novamente | Não apagar automaticamente trabalho não sensível não submetido |
| API fora do ar/limite Free | Aviso de indisponibilidade | Não emitir confirmação falsa de venda ou estoque |
| Transação de negócio pendente | Não alterar projeção como estado final | Idempotência/reconsulta obrigatórias antes de oferecer repetição |

## Regras de integração do renderer existente

- Preservar o registro de rotas, a camada de APIs e a evolução de `apps/web`, mas substituir dependências Electron/IPC **mediante contratos adaptadores explícitos**, nunca copiando/reescrevendo um segundo renderer.
- Não hospedar o HTML Electron integral em produção sem revisar preload, CSP, estado de rede, impressão e tratamento de perda de conexão.
- Mudar rótulos de `servidor local`, `rede LAN` e `terminal` somente quando a superfície web corresponder à experiência real.
- Não inserir menus técnicos de `tenant_id`, D1, binding ou schema para operadores.
- Validar visualmente em navegador quando a UI original estiver adaptada; esses critérios estão **não avaliados** no momento.

## Critérios de aceite rastreáveis

- Login válido mantém sessão após nova requisição e logout bloqueia token revogado.
- Um usuário do tenant A não acessa nem identifica dados do tenant B por URL.
- A redução/desativação de vínculo afeta a requisição seguinte; perfil não pode ser escalado pelo frontend.
- O perfil `CASHIER` não recebe `users.view`; `READ_ONLY` segue exatamente as permissões definidas no PDV atual (inclusive `users.view`).
- Não existem operações paralelas de venda, estoque, caixa ou pedido.
- A confirmação de "online e utilizável" fica bloqueada até termos **renderer adaptado, núcleos transacionais testados, hardening de autenticação e QA de ponta a ponta**.

A validação humana futura será: entregar tarefas de "entrar, reconhecer estabelecimento e descobrir sua filial" sem indicar controles e confirmar que usuários encontram as informações, entendem acesso e conseguem recuperar-se de sessão expirada. Esses testes de usabilidade ainda não foram executados.
