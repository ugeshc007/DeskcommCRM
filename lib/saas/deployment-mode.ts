/**
 * Modo de distribuição da instalação.
 *
 * O default é o produto que já existe: self-host completo, sem dependência de
 * cobrança. O modo gerenciado só nasce quando o operador o escolhe
 * explicitamente; typo não pode transformar uma instalação comunitária em
 * SaaS nem fechar o cadastro por acidente.
 */
export type SaasDeploymentMode = "self_hosted" | "managed_saas";

export function resolveSaasDeploymentMode(raw: string | null | undefined): SaasDeploymentMode {
  return raw?.trim().toLowerCase() === "managed_saas" ? "managed_saas" : "self_hosted";
}

export function isManagedSaas(raw: string | null | undefined): boolean {
  return resolveSaasDeploymentMode(raw) === "managed_saas";
}

/** Convites continuam válidos; o operador pode abrir o cadastro no SaaS gerenciado. */
export function publicSignupAllowed(
  raw: string | null | undefined,
  hasValidInvite: boolean,
  managedPublicSignup = false,
): boolean {
  return !isManagedSaas(raw) || hasValidInvite || managedPublicSignup;
}
