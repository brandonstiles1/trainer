"use client";

import { PlanDesignChat } from "@/components/chat/plan-design-chat";

export function ChatClient({ goalId }: { goalId: string }) {
  return (
    <PlanDesignChat goalId={goalId} mode="new" autoSendFirst redirectTo="/today" />
  );
}
