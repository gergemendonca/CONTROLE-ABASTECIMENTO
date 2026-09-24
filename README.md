# Controle de Abastecimento

Aplicativo de controle de abastecimentos e viagens, preparado para publicação no Cloudflare Workers com banco D1.

## Funções incluídas

- Lançamento de abastecimento com fluxo para celular.
- Área administrativa para cadastrar, editar e apagar viagens com confirmação.
- Solicitação de abastecimento com seleção de uma ou várias viagens na mesma página.
- Preenchimento de litros e KM por roteiro e envio da solicitação pelo WhatsApp.
- Cadastro de contatos WhatsApp no Adm.
- Lista de abastecimentos dos últimos 30 dias.
- Bloqueio de quilometragem repetida e conflito de período de viagem para o mesmo carro.

## Preparação no Cloudflare

1. Crie um banco D1 chamado `controle-abastecimento-db`.
2. Copie o ID do banco para `wrangler.jsonc`, substituindo `SUBSTITUA_PELO_ID_DO_BANCO_D1`.
3. No painel do Worker, cadastre os segredos `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET`.
4. Aplique, uma única vez e na ordem, os arquivos SQL da pasta `drizzle/` no banco D1.
5. Publique o repositório conectado ao GitHub.

## Segurança administrativa

A senha do Adm não é enviada nas chamadas do aplicativo. Após a entrada, o servidor cria uma sessão assinada, válida por oito horas. Nunca coloque os valores dos segredos em arquivos do repositório.
