export const metadata = { title: 'Checkout status' };

/** Página estática: nenhum ID, segredo ou parâmetro do retorno prova pagamento. */
export default function CheckoutReturnPage() {
  return <main className="mx-auto max-w-lg space-y-4 p-8">
    <h1 className="text-2xl font-semibold">Return to your conversation</h1>
    <p>The store will confirm your order after checking the payment provider’s verified update.</p>
    <p>This page does not confirm payment. If you cancelled checkout or need help, return to your conversation with the store. Do not share card details or security codes in chat.</p>
  </main>;
}
