import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface CollapsibleKpiCardProps {
  title: string;
  value: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function CollapsibleKpiCard({ title, value, icon, children }: CollapsibleKpiCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="bg-card border rounded-xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/20">
      <CardHeader 
        className={`flex flex-row items-center justify-between space-y-0 pb-2 cursor-pointer ${isOpen ? 'border-b' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-2">
          {icon && (
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
          )}
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6 rounded-full hover:bg-primary/10 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
        >
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-6 py-4">
          <div className="text-2xl font-bold">{value}</div>
        </div>
        {isOpen && children && (
          <div className="px-6 pb-4 border-t bg-muted/30">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}