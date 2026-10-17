export function retailEventStatus(status: string, customFields: unknown): string {
  if (status === "won") return "Converted";
  if (status === "lost") return "Lost";
  const value = customFields && typeof customFields === "object" && "retail_status" in customFields
    ? customFields.retail_status : null;
  return typeof value === "string" && value.length > 0 ? value : "Created";
}
