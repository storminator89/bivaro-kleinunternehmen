import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
  onStatusChange: (newStatus: string) => void;
}

const statusConfig: {
  [key: string]: { label: string; color: string };
} = {
  DRAFT: { label: "Entwurf", color: "bg-gray-400" },
  SENT: { label: "Gesendet", color: "bg-yellow-500" },
  PAID: { label: "Bezahlt", color: "bg-green-500" },
};

export function StatusBadge({ status, onStatusChange }: StatusBadgeProps) {
  const { label, color } = statusConfig[status] || { label: "Unbekannt", color: "bg-gray-300" };

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
        {Object.keys(statusConfig).map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onStatusChange(key)}>
            {statusConfig[key].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
