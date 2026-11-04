import type { OrganizationPlan } from "../shared/types";
import { getDatabase } from "./db";

export async function getOrganizationPlan(canvasId: string): Promise<OrganizationPlan | undefined> {
  return (await getDatabase()).get("organizationPlans", canvasId);
}

export async function saveOrganizationPlan(plan: OrganizationPlan): Promise<void> {
  await (await getDatabase()).put("organizationPlans", plan);
}
