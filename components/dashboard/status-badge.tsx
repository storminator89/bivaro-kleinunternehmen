import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { XCircle } from "lucide-react";

export interface StatusBadgeProps {
  status: string;
  onStatusChange?: (newStatus: string) => void;
  availableStatuses?: string[];
}

const statusConfig: {
  [key: string]: { label: string; color: string; surface: string };
} = {
  DRAFT: { label: "Entwurf", color: "bg-muted-foreground", surface: "bg-secondary text-foreground" },
  SENT: { label: "Gesendet", color: "bg-caution", surface: "bg-caution-surface text-caution-foreground" },
  PAID: { label: "Bezahlt", color: "bg-positive", surface: "bg-positive-surface text-positive-foreground" },
  CANCELLED: { label: "Storniert", color: "bg-critical", surface: "bg-critical-surface text-critical-foreground" },
};

// Statuses that can be changed via dropdown
const changeableStatuses = ["DRAFT", "SENT", "PAID"];

export function StatusBadge({ status, onStatusChange, availableStatuses }: StatusBadgeProps) {
  const { label, color, surface } = statusConfig[status] || { label: "Unbekannt", color: "bg-muted-foreground", surface: "bg-secondary text-foreground" };
  const options = availableStatuses === undefined
    ? changeableStatuses
    : changeableStatuses.filter((value) => availableStatuses.includes(value));
  const isChangeable = changeableStatuses.includes(status) && options.length > 0;

  // CANCELLED status gets special styling with strikethrough icon
  if (status === "CANCELLED") {
    return (
      <Badge variant="outline" className="border-transparent bg-critical-surface text-critical-foreground">
        <XCircle className="w-3 h-3 mr-1.5 text-critical" />
        <span className="text-critical-foreground">{label}</span>
      </Badge>
    );
  }

  // If no onStatusChange provided or status is not changeable, render a non-interactive badge
  if (!onStatusChange || !isChangeable) {
    return (
      <Badge variant="outline" className={`border-transparent px-2.5 py-1 ${surface}`}>
        <span className={`w-2 h-2 rounded-full mr-2 ${color}`}></span>
        {label}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Zahlungsstatus: ${label}`} className={`inline-flex min-h-11 items-center rounded-md px-2.5 text-xs font-medium transition-colors hover:brightness-95 ${surface}`}>
          <span className={`w-2 h-2 rounded-full mr-2 ${color}`}></span>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onStatusChange(key)}>
            {statusConfig[key].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
