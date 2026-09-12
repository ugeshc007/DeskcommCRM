"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

import { copyToClipboard } from "@/lib/clipboard";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = Sentry.captureException(error);
    setEventId(id);
  }, [error]);

  const displayId = eventId ?? error.digest ?? "—";
  // Este boundary não pode depender do provider que acabou de falhar. O `lang`
  // do documento é definido pelo layout antes da árvore da aplicação; ler esse
  // valor mantém a última saída de segurança no mesmo idioma sem criar outra
  // dependência capaz de lançar.
  const idioma = typeof document === "undefined" ? "pt-BR" : document.documentElement.lang;
  const texto = idioma.startsWith("en")
    ? {
        titulo: "Something went wrong",
        ajuda: "Try again in a moment. If the problem persists, contact support with the ID below.",
        copiado: "Copied!",
        copiar: "Copy ID",
        tentar: "Try again",
      }
    : idioma.startsWith("es")
      ? {
          titulo: "Algo salió mal",
          ajuda: "Inténtalo de nuevo en unos instantes. Si el problema continúa, contacta al soporte con el ID de abajo.",
          copiado: "¡Copiado!",
          copiar: "Copiar ID",
          tentar: "Intentar de nuevo",
        }
      : {
          titulo: "Algo deu errado",
          ajuda: "Tente novamente em instantes. Se persistir, contate o suporte com o ID abaixo.",
          copiado: "Copiado!",
          copiar: "Copiar ID",
          tentar: "Tentar de novo",
        };

  return (
    <html lang={idioma} suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "white",
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem", fontWeight: 600 }}>
            {texto.titulo}
          </h1>
          <p style={{ color: "#57534e", margin: "0 0 1.5rem" }}>
            {texto.ajuda}
          </p>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              background: "#f5f5f4",
              padding: "0.5rem",
              borderRadius: 6,
              marginBottom: "1rem",
              wordBreak: "break-all",
            }}
          >
            ID: {displayId}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(displayId).then((ok) => {
                  if (ok) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                });
              }}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #d6d3d1",
                background: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {copied ? texto.copiado : texto.copiar}
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #1c1917",
                background: "#1c1917",
                color: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {texto.tentar}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
