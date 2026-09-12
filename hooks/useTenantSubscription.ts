"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { OrganizationBillingEvent, OrganizationSubscription, SaasNotice } from "@/lib/saas/subscription";

type Result = { data: { subscription: OrganizationSubscription | null; events?: OrganizationBillingEvent[]; notices?: SaasNotice[] } };
export function useTenantSubscription(id: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "tenant", id, "subscription"], queryFn: () => apiClient.get<Result>(`/api/v1/admin/tenants/${id}/subscription`) });
  const mutation = useMutation({ mutationFn: (body: unknown) => apiClient.patch<Result>(`/api/v1/admin/tenants/${id}/subscription`, body), onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "tenant", id, "subscription"] }) });
  return { ...query, save: mutation.mutateAsync, isSaving: mutation.isPending, saveError: mutation.error };
}
