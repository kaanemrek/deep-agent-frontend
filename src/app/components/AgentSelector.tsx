"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const AGENT_OPTIONS = [
  { value: "deep_agent", label: "Deep Agent" },
  { value: "standard_agent", label: "Standard Agent" },
] as const;

export type AgentId = (typeof AGENT_OPTIONS)[number]["value"];

interface AgentSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px] border-border bg-card text-foreground text-sm">
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {AGENT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
