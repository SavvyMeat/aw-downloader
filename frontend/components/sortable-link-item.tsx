"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Modifier } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, GripVertical, X } from "lucide-react";

interface SortableLinkItemProps {
  id: string;
  value: string;
  isEditing: boolean;
  baseUrl: string;
  onChange?: (value: string) => void;
  onRemove?: () => void;
}

export function SortableLinkItem({
  id,
  value,
  isEditing,
  baseUrl,
  onChange,
  onRemove,
}: SortableLinkItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fullUrl = value ? `${baseUrl}/play/${value}` : "";

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-2 p-2 bg-card border rounded-md"
      >
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none p-1 hover:bg-muted rounded"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        
        <Input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="es: one-piece.12345"
          className="flex-1 h-8 text-sm font-mono"
        />
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
      <code className="flex-1 text-xs text-muted-foreground font-mono truncate">
        {value}
      </code>
      
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={() => window.open(fullUrl, "_blank")}
          title={`Apri ${fullUrl}`}
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </Button>
      )}
    </div>
  );
}
