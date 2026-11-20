/** Channel-specific setup errors stay at the provider boundary. Pure client-safe data. */
export const CHANNEL_SETUP_EN: Readonly<Record<string, string>> = {
  'Suba o Docker (docker compose up -d waha) e tente novamente.':
    'Start the Docker service (docker compose up -d waha) and try again.',
  'O WhatsApp (WAHA) não está configurado neste ambiente (faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY) — sem ele o número não pode ser desconectado do aparelho.':
    'WhatsApp (WAHA) is not configured in this environment (WAHA_API_BASE_URL and/or WAHA_API_KEY are missing) — without it the number cannot be disconnected from the device.',
  'O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.':
    'WhatsApp (WAHA) is not configured in this environment: WAHA_API_BASE_URL and/or WAHA_API_KEY are missing. Configure them and try again.',
  'O servidor de o WhatsApp (WAHA) foi encontrado, mas recusou a conexão: nada está atendendo naquela porta. Confirme que o serviço está no ar e que a porta configurada é a dele.':
    'The WhatsApp (WAHA) server was found, but it refused the connection: nothing is listening on that port. Confirm that the service is running and that the configured port is correct.',
};
