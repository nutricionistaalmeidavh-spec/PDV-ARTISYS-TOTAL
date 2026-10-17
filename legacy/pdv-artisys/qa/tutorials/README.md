# Vídeos Tutoriais do ArtiSys

Este diretório define o roadmap dos microtutoriais do PDV. O limite é **30 segundos por vídeo** e o core obrigatório usa apenas recursos locais/open source já compatíveis com o projeto: ArtiSys QA/Playwright + FFmpeg.

## Princípio de experiência

Cada tutorial deve ajudar a pessoa a completar **uma única tarefa**. O vídeo não deve ensinar a interface inteira.

Os textos de pós-edição seguem o loop:

1. **Orientar** — dizer qual tarefa será feita.
2. **Ação-chave** — explicar somente a decisão que pode não ser óbvia.
3. **Confirmar** — mostrar qual resultado comprova que terminou.
4. **Recuperar** — usar apenas quando o fluxo tiver uma recuperação relevante.

Por isso o catálogo limita cada vídeo a **2–4 overlays**, com até 60 caracteres por texto. Não repetir em texto o que um botão já explica claramente.

## Fases

- **P0 (01–12):** operação diária de balcão e caixa.
- **P1 (13–21):** cadastro, estoque, histórico e relatórios.
- **P2 (22–28):** compras, pedidos e financeiro.
- **P3 (29–36):** usuários, terminais, impressão, backup e módulos.

A fonte canônica de nomes, duração e textos é [catalog.json](./catalog.json).

## Pipeline

1. O cenário QA executa a tarefa real e grava o vídeo bruto.
2. O vídeo é mantido com duração natural de até 30s; quando necessário, o runtime de demo já pode normalizar mídia com FFmpeg.
3. A edição final aplica somente os overlays do catálogo:
   `npm run qa:tutorials:edit -- --tutorial 10-abrir-caixa --input caminho/raw.mp4`
4. O MP4 final recebe o nome definido em `outputFile`.
5. Após revisão, o arquivo final é colocado no Drive em **pdv-artisys/videos tutoriais**.

## Validação

`npm run qa:tutorials:validate`

A validação garante 36 itens, IDs e nomes únicos, duração máxima de 30s, audiência válida e overlays curtos dentro do tempo do vídeo.

## Critério de aceite de cada tutorial

- a tarefa pode ser reconhecida pelo título sem contexto externo;
- o caminho gravado corresponde ao caminho real do usuário;
- o vídeo termina mostrando o estado resultante, não apenas o clique;
- não há segredo, dado real de cliente ou credencial na gravação;
- o texto não cobre controles necessários;
- a pessoa consegue entender o resultado mesmo sem áudio;
- o nome final segue o catálogo para facilitar busca no Drive.

Os tutoriais não substituem feedback, mensagens de erro ou orientação necessária dentro do produto. Se um vídeo precisar explicar uma operação básica porque a UI não torna o próximo passo previsível, isso deve gerar uma melhoria de UX separada.
