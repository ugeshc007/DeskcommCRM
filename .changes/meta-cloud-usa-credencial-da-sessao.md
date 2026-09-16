---
impacto: nada_mudou
secao: corrigido
titulo: Respostas do canal oficial saem com a credencial salva na conexão
---

Quando o canal oficial do WhatsApp era conectado pela tela, a credencial ficava
salva corretamente naquela conexão, mas uma verificação antiga ainda procurava
somente a configuração global do servidor. A mensagem do cliente chegava, a IA
preparava a resposta e ela permanecia em **fila** sem ser entregue.

Agora o envio consulta a credencial da própria conexão e mantém o isolamento entre
organizações. Instalações antigas que configuraram uma credencial global continuam
funcionando como antes, e uma conexão realmente sem credencial continua visível como
mensagem em fila em vez de ser marcada incorretamente como enviada.
