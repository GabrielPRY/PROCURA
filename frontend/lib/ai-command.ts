import { apiRequest } from "@/lib/api";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function askAdvisor(payload: {
  username: string;
  cg: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  situation: string;
  mode: string;
  reference_price: number;
}) {
  return apiRequest<{ status: string; answer: string }>("/ai/advisor", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function askCopilot(payload: {
  username: string;
  cg: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  question: string;
  history: ChatMessage[];
}) {
  return apiRequest<{ status: string; answer: string }>("/ai/copilot", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
