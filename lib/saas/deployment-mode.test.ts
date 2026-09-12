import { describe, expect, it } from "vitest";

import {
  isManagedSaas,
  publicSignupAllowed,
  resolveSaasDeploymentMode,
} from "./deployment-mode";

describe("modo de distribuição SaaS", () => {
  it.each([undefined, null, "", "self_hosted", "SELF_HOSTED", "typo"])(
    "%s preserva o self-host como comportamento retrocompatível",
    (raw) => {
      expect(resolveSaasDeploymentMode(raw)).toBe("self_hosted");
      expect(isManagedSaas(raw)).toBe(false);
      expect(publicSignupAllowed(raw, false)).toBe(true);
    },
  );

  it("managed_saas fecha só o cadastro de empresa e mantém convite válido", () => {
    expect(resolveSaasDeploymentMode(" MANAGED_SAAS ")).toBe("managed_saas");
    expect(publicSignupAllowed("managed_saas", false)).toBe(false);
    expect(publicSignupAllowed("managed_saas", true)).toBe(true);
  });
});
