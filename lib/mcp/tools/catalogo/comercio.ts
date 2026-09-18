/**
 * Capacidades de COMÉRCIO e PRIVACIDADE — o que o cliente comprou, o que existe
 * à venda, e quem pediu para sair.
 *
 * Ver `docs/handoffs/BRIEFING-ia-360.md` §4 para o contrato dos campos.
 */
import { declararTools } from "./tipos";

export const TOOLS_COMERCIO = declararTools([
  { name: 'crm_quote_store_checkout', category: 'write', rotulo: 'Prepare store quote',
    explicacao: 'Calculate catalogue prices and delivery charges for customer confirmation before reserving any stock.',
    oQueToca: 'Store quotes', risco: 'atencao', pacotes: ['vender'] },
  { name: 'crm_confirm_store_checkout', category: 'write', rotulo: 'Confirm store checkout',
    explicacao: 'Verify the customer confirmation, reserve stock once and prepare a secure payment link for that order.',
    oQueToca: 'Stock and orders', risco: 'critico', pacotes: ['vender'] },
  { name: 'crm_store_order_status', category: 'read', rotulo: 'Check store payment status',
    explicacao: 'Read the current customer’s verified order status without trusting screenshots or claims of payment.',
    oQueToca: 'Store orders', risco: 'seguro', pacotes: ['vender', 'atender'] },
  {
    name: 'crm_search_store_products', category: 'read',
    rotulo: 'Search store products',
    explicacao: 'Find this organization’s store products, exact prices and stock remaining after pending orders.',
    oQueToca: 'Store catalogue', risco: 'seguro', pacotes: ['vender', 'atender'],
  },
  {
    name: "crm_list_contact_orders",
    category: "read",
    rotulo: "Ver as compras do cliente",
    explicacao:
      "Mostra o que este cliente já comprou, quanto pagou e como está a entrega, para o assistente não prometer prazo no escuro nem repetir uma oferta já aceita.",
    oQueToca: "Compras do cliente",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "crm_search_products",
    category: "read",
    rotulo: "Procurar produto na loja",
    explicacao:
      "Procura um produto no catálogo da loja e devolve o preço exato e o que está disponível, para o assistente responder com o valor cadastrado em vez de estimar.",
    oQueToca: "Catálogo da loja",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "crm_list_privacy_requests",
    category: "read",
    rotulo: "Ver pedidos de privacidade",
    explicacao:
      "Mostra quem pediu para exportar ou apagar os próprios dados e qual o prazo, para o assistente parar de insistir com quem pediu para sair.",
    oQueToca: "Privacidade e dados do cliente",
    risco: "seguro",
    pacotes: ["organizar", "atender"],
  },
]);
