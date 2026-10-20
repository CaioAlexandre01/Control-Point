# Correção de turnos que atravessam meia-noite

## Diagnóstico

O cliente, a rota Next.js e a Cloud Function selecionavam o documento
`empresa_funcionario_dataAtual`. A troca da data ocultava a jornada em andamento.
Além disso, uma jornada encerrada impedia outra entrada na mesma data, a edição
administrativa reconstruía as quatro batidas no mesmo dia e o painel ignorava
jornadas abertas em dias anteriores.

## Comportamento implementado

- Antes de registrar, consulta todos os registros do funcionário e da empresa,
  sem limitar pela data. Uma jornada com entrada e sem saída permanece aberta.
- As quatro etapas seguem os campos de batida em ordem. Inconsistências que
  impedem identificar a próxima etapa bloqueiam o registro.
- O documento original recebe as batidas seguintes, mesmo com mudança de dia,
  mês ou ano. A quarta batida encerra a jornada.
- A próxima entrada cria um documento com identificador independente da data,
  permitindo outro turno no mesmo dia. Documentos antigos mantêm seus IDs.
- A transação lê e atualiza o documento do funcionário para serializar os
  registros, inclusive duas tentativas de abertura. A etapa e o ID esperado
  protegem contra telas desatualizadas.
- Cada tentativa do cliente possui um identificador. Recibos privados em
  `users/{uid}/punchRequests/{requestId}` permitem repetir uma requisição sem
  registrar novamente, inclusive após a conclusão do turno.
- O horário oficial vem do servidor dentro da transação e é o mesmo usado
  no evento, na jornada e no cálculo. Timestamps preservam o instante UTC;
  `timeZone: America/Sao_Paulo` registra o fuso de referência.
- Folgas programadas, autenticação e validações de QR/GPS continuam em vigor.
  Uma folga do dia seguinte não interrompe um turno já aberto.
- Nenhuma migração, exclusão ou correção automática de histórico é executada.

## Relatórios e correções

Os relatórios continuam atribuindo as horas à data de abertura do turno.
Horas não são repartidas automaticamente entre dias ou meses. Dois turnos
na mesma data somam suas horas, mas contam apenas um dia trabalhado.

O painel inclui turnos abertos de qualquer data e conta encerramentos pelo
dia real da saída. As tabelas mostram a data quando uma batida pertence a
outro dia.

A edição administrativa usa data e hora completas e preserva os timestamps
dos campos não alterados. A API autentica o administrador, valida a sequência,
detecta versões desatualizadas e grava a auditoria na mesma transação.
Reabrir um turno enquanto outro está aberto é bloqueado. O ajuste manual do
total de minutos existente foi preservado.

## Arquivos desta correção

- `functions/src/workday-state.ts`: sequência, identificação de turno aberto,
  fuso e cálculo de horas.
- `functions/src/punch-service.ts`: transação compartilhada e idempotência.
- `functions/src/index.ts` e os três arquivos correspondentes em
  `functions/lib/`: callable atualizada e saída compilada.
- `src/app/api/ponto/registrar/route.ts`: integração da API com o serviço.
- `src/lib/workday.ts`: seleção independente da data e recarga pelo ID salvo.
- `src/app/ponto/page.tsx`: bloqueio de duplo clique/carregamento e identificação
  das batidas do turno.
- `src/app/api/admin/registros/[workdayId]/route.ts`,
  `src/lib/admin-actions.ts` e `src/app/admin/registros/page.tsx`:
  correções administrativas transacionais com datas completas.
- `firestore.rules`: correções passam pela API; gravação direta é bloqueada.
- `src/app/admin/page.tsx`: indicadores de turnos abertos e encerrados.
- `src/lib/queries.ts`: ordenação das jornadas iniciadas na mesma data.
- `src/app/admin/relatorios/page.tsx` e `src/lib/workday-summary.ts`:
  resumo sem duplicar dias com mais de um turno.
- `src/lib/punch-time.ts` e `src/types/index.ts`: datas, fuso e metadados.
- `tests/workday.test.mjs`, `tests/overnight.emulator.mjs`,
  `tests/load-typescript.mjs` e `tests/flows.emulator.mjs`: regressão e integração.

Os arquivos de UI, dependências e AGENTS.md que já estavam modificados pela
tarefa anterior não fazem parte desta correção.

## Validação

Testes cobrem expediente no mesmo dia, saída no dia seguinte, intervalo
atravessando meia-noite, mudanças de mês/ano, recuperação com uma, duas e
três batidas, próxima entrada após quatro batidas, leitura após recarga,
concorrência, repetição de requisição, manutenção de IDs antigos e correções
administrativas conflitantes. A integração usa exclusivamente emuladores
locais de Auth e Firestore com o projeto `demo-ponto-uau`.

## Atenção na publicação

- Publicar Next.js, Cloud Function e regras do Firestore de forma coordenada;
  evitar registros durante a troca entre implementações. Uma callable antiga
  ainda publicada continuaria usando a lógica por data.
- Após a atualização, recarregar abas antigas, especialmente as administrativas:
  a versão antiga tenta salvar correções diretamente no Firestore.
- Havendo mais de um turno aberto antigo, é necessária revisão administrativa
  explícita. O sistema não escolhe nem encerra um deles automaticamente.
- A consulta lê o histórico do funcionário para reconhecer também registros
  legados sem migração. O custo de leitura cresce com esse histórico.
- Não houve publicação nem acesso de escrita aos dados de produção nesta tarefa.
