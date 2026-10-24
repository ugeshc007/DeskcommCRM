"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export function useArchiveInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/team/invites/${id}/archive`, {}),
    onError: showApiError,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["team", "invites"] }); },
  });
}
