import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";

interface CollapsibleKpiCardProps {
  title: string;
  value: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function CollapsibleKpiCard({ title, value, icon, children }: CollapsibleKpiCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const detailsId = useId();

  return (
    <Card className="overflow-hidden rounded-xl border-border/80 bg-card/80">
      <CardHeader className="space-y-0 p-0">
        <button
          type="button"
          className={`flex min-h-14 w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-secondary/40 ${isOpen ? 'border-b border-border/80' : ''}`}
          aria-expanded={isOpen}
          aria-controls={detailsId}
          onClick={() => setIsOpen((value) => !value)}
        >
          <span className="flex items-center gap-3">
            {icon && <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </span>
          {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 py-4">
          <div className="text-2xl font-semibold tracking-[-0.03em] tabular-nums">{value}</div>
        </div>
        {isOpen && children && (
          <div id={detailsId} className="border-t border-border/70 bg-secondary/30 px-4 pb-4">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
