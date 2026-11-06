"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import {
  signupSchema,
  signupComConviteSchema,
  type SignupInput,
  type SignupComConviteInput,
} from "@/lib/auth/schemas";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { audit, hashEmail, isServiceRoleConfigured } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { enrollFromManualInvite } from "@/lib/auth/manual-invite-enrollment";
import { publicSignupAllowed } from "@/lib/saas/deployment-mode";
import { isExistingAccountError } from "@/lib/auth/existing-account-error";

export type SignUpResult =
  | {
      ok: true;
      /**
       * O provedor de auth JÁ abriu a sessão neste `signUp()` — quer dizer,
       * "Confirm email" está DESLIGADO nele e não vai existir link nenhum para
       * clicar. Quem chama precisa saber disto: a tela de "confirme seu e-mail"
       * é uma instrução impossível de cumprir nesse estado, e a pessoa fica
       * esperando para sempre um e-mail que nunca sai — autenticada, sem
       * organização, sem motivo para navegar até a saída que existe.
       *
       * Medido em 2026-09-05 na `origin/main` @ `4d50f63f`, com
       * `GOTRUE_MAILER_AUTOCONFIRM=true`: a tela dizia "Enviamos um link de
       * confirmação para …", e ao mesmo tempo o cookie `sb-deskcomm-auth`
       * estava no browser e `user_organizations` do usuário vinha `[]`.
       *
       * Achado de @KIRAzinx566, com um cliente real travado nessa tela.
       */
      sessao_ativa: boolean;
      convite_aceito?: boolean;
    }
  | {
      ok: false;
      error:
        | "validation_error"
        | "rate_limited"
        | "signup_failed"
        | "conta_ja_existe"
        | "signup_disabled";
      details?: Record<string, unknown>;
    };

/**
 * Signup self-service: cria o usuário no GoTrue e dispara o e-mail de
 * confirmação. O tenant só é provisionado quando o link é confirmado em
 * /auth/confirm (evita orgs órfãs de cadastros nunca confirmados).
 *
 * Nesta instalação o GoTrue usa confirmação automática e devolve explicitamente
 * `user_already_exists`. A tela precisa transformar isso numa saída real para
 * login; "tente novamente" só repete uma operação que nunca poderá funcionar.
 */
export async function signUp(
  input: SignupInput | SignupComConviteInput,
  /**
   * Token de convite, quando a conta está sendo criada para ACEITAR um convite.
   * Viaja até `/auth/confirm` pelo `user_metadata` — o mesmo canal que
   * `org_name` já usa e que o e2e do signup exercita. Ele não dá acesso a nada
   * sozinho: quem decide é `decidirConviteDoSignup`, comparando a assinatura do
   * token com o e-mail que o provedor de auth confirmou.
   */
  inviteToken?: string,
): Promise<SignUpResult> {
  const temConvite = typeof inviteToken === "string" && inviteToken.trim() !== "";
  // No SaaS gerenciado, organização nasce pela plataforma. Convite assinado
  // continua criando a conta de um membro da organização já existente.
  // A guarda vive também na action: esconder o formulário não protege uma
  // Server Action, que segue alcançável por POST direto.
  if (
    !publicSignupAllowed(
      env.SAAS_DEPLOYMENT_MODE,
      temConvite,
      env.SAAS_PUBLIC_SIGNUP_ENABLED,
    )
  ) {
    return { ok: false, error: "signup_disabled" };
  }
  const parsed = temConvite
    ? signupComConviteSchema.safeParse(input)
    : signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? env.NEXT_PUBLIC_APP_URL;
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Criar conta é fluxo raro por pessoa: teto baixo por IP evita fábrica de
  // organizações (cada signup provisiona tenant). Issue #64.
  if (await authRateLimited("signup", null, AUTH_LIMITS.signup)) {
    return { ok: false, error: "rate_limited" };
  }

  // Só vira convite se o token verificar E for para este e-mail. Divergência
  // aqui não é erro do usuário — é tentativa de entrar em organização alheia
  // colando um token que chegou para outra pessoa.
  let convite: string | null = null;
  if (temConvite && inviteToken) {
    const payload = verifyInviteToken(inviteToken);
    if (!payload) {
      return { ok: false, error: "validation_error", details: { invite: ["convite_invalido"] } };
    }
    if (payload.email.trim().toLowerCase() !== parsed.data.email.trim().toLowerCase()) {
      return { ok: false, error: "validation_error", details: { invite: ["email_divergente"] } };
    }
    convite = inviteToken;
  }

  if (convite && isServiceRoleConfigured()) {
    const payload = verifyInviteToken(convite);
    if (!payload) return { ok: false, error: "validation_error" };
    const manual = await enrollFromManualInvite({
      payload,
      fullName: (parsed.data as SignupComConviteInput).full_name,
      password: parsed.data.password,
      requestId,
    });
    if (manual.kind === "accepted") return { ok: true, sessao_ativa: true, convite_aceito: true };
    if (manual.kind === "already_exists") return { ok: false, error: "conta_ja_existe" };
    if (manual.kind === "invalid") return { ok: false, error: "validation_error", details: { invite: ["convite_invalido"] } };
    if (manual.kind === "failed") return { ok: false, error: "signup_failed" };
    // Email was delivered: preserve the provider's ordinary confirmation flow.
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Ver comentário equivalente em requestPasswordReset.ts: ?type=signup
      // sobrevive ao redirect do GoTrue e é o que distingue este fluxo do de
      // recovery quando a verificação chega via `code` (PKCE), não `token_hash`.
      emailRedirectTo: `${origin}/auth/confirm?type=signup`,
      // O convite é revalidado no servidor mesmo tendo sido validado ao montar
      // a tela: o campo de e-mail do formulário é adulterável no cliente, e a
      // decisão que importa acontece com o e-mail JÁ confirmado pelo provedor.
      // `full_name` vai junto no convite: sem ele a pessoa entra na equipe sem
      // nome e aparece como um pedaço de identificador em toda tela que a
      // nomeia. No caminho sem convite ele não existe — ali quem dá o nome é o
      // onboarding, que o convidado não percorre.
      data: convite
        ? {
            invite_token: convite,
            full_name: (parsed.data as SignupComConviteInput).full_name,
            // Até entrar numa organização, não existe locale de tenant para
            // resolver. A pessoa precisa continuar no idioma da instalação
            // já na tela seguinte ao cadastro.
            locale: env.APP_LOCALE,
          }
        : {
            org_name: (parsed.data as SignupInput).org_name,
            locale: env.APP_LOCALE,
          },
    },
  });

  if (error) {
    if (error.status === 429) return { ok: false, error: "rate_limited" };

    // ── O BECO SEM SAÍDA DE QUEM JÁ TEM CONTA ────────────────────────────
    //
    // Medido em produção em 2026-09-10: quem foi revogado e recebeu convite
    // novo chega aqui, porque já tem conta. O GoTrue devolve
    // "User already registered", e a tela dizia "Não foi possível criar a
    // conta. Tente novamente." — instrução impossível: tentar de novo nunca
    // vai funcionar. A pessoa tentou TRÊS vezes; está nas três linhas de
    // `auth.signup_failed` da trilha.
    //
    // O caminho certo existe e é curto (entrar e aceitar o convite), mas a
    // tela não levava até ele.
    //
    const jaExiste = isExistingAccountError(error);
    if (jaExiste) {
      await audit({
        action: "auth.signup_failed",
        metadata: {
          email_hash: hashEmail(parsed.data.email),
          reason: convite === null ? "conta_ja_existe" : "conta_ja_existe_com_convite",
        },
        requestId,
        ip,
        userAgent,
      });
      return { ok: false, error: "conta_ja_existe" };
    }

    await audit({
      action: "auth.signup_failed",
      metadata: {
        email_hash: hashEmail(parsed.data.email),
        reason: error.message,
      },
      requestId,
      ip,
      userAgent,
    });
    return { ok: false, error: "signup_failed" };
  }

  await audit({
    action: "auth.signup_requested",
    actorUserId: data.user?.id ?? null,
    metadata: { email_hash: hashEmail(parsed.data.email) },
    requestId,
    ip,
    userAgent,
  });

  // `data.session` é o único sinal confiável de que o provedor não vai mandar
  // e-mail nenhum: ele vem preenchido exatamente quando a confirmação está
  // desligada (ou já resolvida) e o GoTrue devolveu tokens junto do usuário.
  return { ok: true, sessao_ativa: data.session !== null };
}
