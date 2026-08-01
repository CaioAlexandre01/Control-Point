# Ponto Uau

Sistema de registro de ponto para Vercel com Next.js, Firebase Authentication e Cloud Firestore. A API Route usa Firebase Admin para repetir no servidor as validações de usuário, empresa, QR Code, GPS, raio e sequência.

## Instalação

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

## Variáveis de ambiente

Configuração pública do aplicativo Web Firebase:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Credenciais privadas usadas exclusivamente pela API:

```env
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

Não use `NEXT_PUBLIC_` nas credenciais administrativas. Quebras de linha escapadas como `\n` na chave privada são tratadas automaticamente.

## Obter as credenciais administrativas

No Firebase Console:

1. Abra **Configurações do projeto > Contas de serviço**.
2. Clique em **Gerar nova chave privada**.
3. No JSON baixado, copie:
   - `project_id` para `FIREBASE_ADMIN_PROJECT_ID`;
   - `client_email` para `FIREBASE_ADMIN_CLIENT_EMAIL`;
   - `private_key` para `FIREBASE_ADMIN_PRIVATE_KEY`.
4. Não salve o JSON no repositório.

## Configuração do Firebase

1. Em **Authentication > Sign-in method**, ative **E-mail/senha**.
2. Em **Authentication > Settings > Authorized domains**, adicione o domínio da Vercel.
3. Crie o Cloud Firestore em modo de produção.
4. Publique regras e índices:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Não é necessário ativar o plano Blaze ou publicar Firebase Functions.

## Publicação na Vercel

1. Importe o repositório na Vercel.
2. Se houver vários projetos, configure o **Root Directory** para a pasta deste projeto.
3. Cadastre todas as variáveis em **Settings > Environment Variables**.
4. Atualize `NEXT_PUBLIC_APP_URL` com a URL final.
5. Faça o deploy.
6. Adicione o domínio final aos domínios autorizados do Firebase Authentication.

A câmera e a localização funcionam na Vercel porque a aplicação é servida por HTTPS.

## Primeiro acesso

Abra `/setup` para criar a empresa e o primeiro administrador. Depois disso, o setup é bloqueado e os acessos passam por `/login`.

## Validação

```bash
npm run typecheck
npm run lint
npm run build
```

## Limitações do MVP

- Correções administrativas ajustam totais, mas ainda não editam cada timestamp visualmente.
- Horas extras consideram uma jornada padrão de 8 horas.
- Não há escala, feriados, banco de horas ou regras sindicais.
- Navegadores não fornecem prova criptográfica de GPS; coordenadas adulteradas exigem mitigação nativa ou MDM.
