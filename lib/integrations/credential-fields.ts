import { MESSENGER_CONNECTION_PROVIDER, MESSENGER_CREDENTIAL_FIELDS } from '@/lib/channels/messenger/public-config';
/** Métadados públicos de formulário; nenhum segredo ou transporte neste módulo. */
export const CREDENTIAL_FIELDS:Record<string,readonly {key:string;label:string;secret?:boolean;optional?:boolean}[]>={
 [MESSENGER_CONNECTION_PROVIDER]:MESSENGER_CREDENTIAL_FIELDS,
 inbound_webhook:[{key:'signing_secret',label:'Webhook signing secret (at least 32 characters)',secret:true}],
 mailchimp:[{key:'token',label:'API key',secret:true},{key:'server',label:'Server prefix (for example us21)'},{key:'list_id',label:'Audience ID'}],
 segment:[{key:'token',label:'HTTP source write key',secret:true}],
 dialogflow:[{key:'token',label:'Google OAuth access token',secret:true},{key:'project_id',label:'Google Cloud project ID'}],
 custom_api:[{key:'url',label:'Fixed HTTPS endpoint'},{key:'token',label:'Bearer token',secret:true},{key:'method',label:'HTTP method (GET or POST)'}],
 n8n:[{key:'url',label:'Production webhook URL',secret:true},{key:'token',label:'X-Webhook-Token secret',secret:true}],
 zapier:[{key:'url',label:'Zapier Catch Hook URL',secret:true}],
 salesforce:[{key:'instance_url',label:'Instance URL (https://your-domain.my.salesforce.com/)'},{key:'token',label:'Access token',secret:true}],
 calendly:[{key:'token',label:'Personal access token',secret:true},{key:'event_type_id',label:'Event type ID'}],
 airtable:[{key:'token',label:'Personal access token',secret:true},{key:'base_id',label:'Base ID'},{key:'table_id',label:'Table ID'}],
 hubspot:[{key:'token',label:'Private app token',secret:true}],
 stripe:[{key:'token',label:'Restricted API key',secret:true},{key:'webhook_secret',label:'Stripe endpoint signing secret (add after registering the callback)',secret:true,optional:true}],
 slack:[{key:'token',label:'Bot token',secret:true},{key:'channel_id',label:'Staff channel ID'}],
 sendgrid:[{key:'token',label:'API key',secret:true},{key:'from_email',label:'Verified sender email'},{key:'staff_email',label:'Staff recipient email'}],
};
