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
}

const statusConfig: {
  [key: string]: { label: string; color: string };
} = {
  DRAFT: { label: "Entwurf", color: "bg-gray-400" },
  SENT: { label: "Gesendet", color: "bg-yellow-500" },
  PAID: { label: "Bezahlt", color: "bg-green-500" },
  CANCELLED: { label: "Storniert", color: "bg-red-500" },
};

// Statuses that can be changed via dropdown
const changeableStatuses = ["DRAFT", "SENT", "PAID"];

export function StatusBadge({ status, onStatusChange }: StatusBadgeProps) {
  const { label, color } = statusConfig[status] || { label: "Unbekannt", color: "bg-gray-300" };
  const isChangeable = changeableStatuses.includes(status);

  // CANCELLED status gets special styling with strikethrough icon
  if (status === "CANCELLED") {
    return (
      <Badge variant="outline" className="border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <XCircle className="w-3 h-3 mr-1.5 text-red-500" />
        <span className="text-red-600 dark:text-red-400">{label}</span>
      </Badge>
    );
  }

  // If no onStatusChange provided or status is not changeable, render a non-interactive badge
  if (!onStatusChange || !isChangeable) {
    return (
      <Badge variant="outline">
        <span className={`w-2 h-2 rounded-full mr-2 ${color}`}></span>
        {label}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant="outline"
          className="cursor-pointer transition-colors hover:bg-muted/80"
        >
          <span className={`w-2 h-2 rounded-full mr-2 ${color}`}></span>
          {label}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {changeableStatuses.map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onStatusChange(key)}>
            {statusConfig[key].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
