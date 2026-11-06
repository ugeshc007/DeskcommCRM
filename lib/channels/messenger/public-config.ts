/** Metadados públicos; este módulo nunca importa o cofre nem transporte. */
export const MESSENGER_CONNECTION_PROVIDER = 'messenger' as const;
export const MESSENGER_CREDENTIAL_FIELDS = [
  { key: 'page_id', label: 'Facebook Page ID' },
  { key: 'token', label: 'Page access token', secret: true },
  { key: 'app_secret', label: 'Meta app secret', secret: true },
  { key: 'verify_token', label: 'Webhook verification token (16–256 letters, digits, underscores or hyphens)', secret: true },
  { key: 'graph_version', label: 'Graph API version (for example v26.0)' },
] as const;
export const MESSENGER_CONNECTION_CARD = {
  id: MESSENGER_CONNECTION_PROVIDER, name: 'Facebook Messenger', icon: 'message', phase: 9,
  auth: 'api_key', actions: [],
  description: 'Connect your organization’s Facebook Page to receive customer messages in Inbox and reply during the messaging window.',
  instructions: 'Use your own Meta app and Page access token. Save the Page ID, app secret, verification token and Graph API version. Test checks that the token belongs to this Page; it does not prove messaging permissions or webhook delivery. Keep a copy of your verification token securely: saved secrets are never returned. This setup does not activate a bot or send messages.',
} as const;
