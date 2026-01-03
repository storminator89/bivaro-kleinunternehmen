import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Activity {
  id: number;
  type: 'expense' | 'income';
  description: string;
  date: string;
  amount: number;
}

interface RecentActivityProps {
  activities: Activity[];
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <Card className="bg-card border rounded-xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
      <CardContent className="p-0">
        <div className="space-y-0">
          {activities.length > 0 ? (
            activities.map((activity) => (
              <div key={`${activity.type}-${activity.id}`} className="flex items-center p-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                <div className="flex-1">
                  <p className="text-sm font-medium leading-none">{activity.description}</p>
                  <p className="text-sm text-muted-foreground">{new Date(activity.date).toLocaleDateString('de-DE')}</p>
                </div>
                <div className={`text-right font-medium ${activity.type === 'income' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                  {formatCurrency(activity.amount)}
                </div>
                <Badge variant={activity.type === 'income' ? 'default' : 'destructive'} className="ml-4">
                  {activity.type === 'income' ? 'Einnahme' : 'Ausgabe'}
                </Badge>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <p>Keine Aktivitäten vorhanden</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
