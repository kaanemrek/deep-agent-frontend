"use client";

import { useCallback, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message, type Assistant } from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import { useClient } from "@/providers/ClientProvider";
import type { StateType } from "@/app/hooks/useChat";

/** Like useChat but with local (non-URL) thread state — for compare view */
export function useCompareChat(
  activeAssistant: Assistant | null,
  initialThreadId?: string | null,
) {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId ?? null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useClient();

  const stream = useStream<StateType>({
    assistantId: activeAssistant?.assistant_id || "",
    client: client ?? undefined,
    reconnectOnMount: !!initialThreadId,
    threadId,
    onThreadId: setThreadId,
    onFinish: () => {
      if (startTime != null) setElapsedMs(Date.now() - startTime);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[CompareChat] stream error:", msg);
      setError(msg);
      if (startTime != null) setElapsedMs(Date.now() - startTime);
    },
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    fetchStateHistory: false,
  });

  const sendMessage = useCallback(
    (content: string) => {
      setStartTime(Date.now());
      setElapsedMs(null);
      const newMessage: Message = { id: uuidv4(), type: "human", content };
      stream.submit(
        { messages: [newMessage] },
        {
          optimisticValues: (prev) => ({
            messages: [...(prev.messages ?? []), newMessage],
          }),
          config: { ...(activeAssistant?.config ?? {}), recursion_limit: 100 },
        }
      );
    },
    [stream, activeAssistant?.config]
  );

  const totalTokens = (stream.values?.messages ?? []).reduce((acc: number, msg: Message) => {
    const usage = (msg as any).usage_metadata;
    return acc + (usage?.total_tokens ?? 0);
  }, 0);

  return {
    stream,
    threadId,
    messages:    stream.values?.messages ?? [],
    isLoading:   stream.isLoading,
    sendMessage,
    totalTokens,
    elapsedMs,
    error,
  };
}
