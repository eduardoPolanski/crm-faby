# Baileys + Supabase Worker

Worker privado para conectar WhatsApp via Baileys e sincronizar leads, conversas e mensagens com Supabase.

## Configuração

1. Aplique a migration em supabase/migrations no SQL Editor do Supabase.
2. Copie .env.example para .env.
3. Preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e WHATSAPP_OWNER_ID.
4. Execute docker compose up -d --build.
5. Consulte o QR Code salvo em whatsapp_sessions.qr_code pelo frontend autenticado.

O WHATSAPP_OWNER_ID precisa ser o UUID de um usuário existente em auth.users. A chave service role é usada somente no container.

## Execução direta na VPS

Docker não é obrigatório. Instale Node.js 20 ou superior, copie .env.example para .env, instale as dependências e compile:

    npm install
    npm run build
    node --max-old-space-size=256 dist/index.js

Para manter o processo ativo após fechar o SSH, use um supervisor como systemd ou PM2.

## Envio

O frontend cria uma linha em outbound_messages com owner_id, conversation_id, destination_jid, message_type = text e text_content. O worker recebe o INSERT via Realtime e também recupera mensagens pending ao iniciar.

Mensagens de texto são suportadas diretamente. Outros tipos devem ser adaptados em src/processors/outbound.ts; mídia não é baixada nem armazenada nesta primeira versão.
