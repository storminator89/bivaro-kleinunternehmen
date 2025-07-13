import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RecentActivityProps {
  activities: any[];
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Letzte Aktivitäten</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={`${activity.type}-${activity.id}`} className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium leading-none">{activity.description}</p>
                <p className="text-sm text-muted-foreground">{new Date(activity.date).toLocaleDateString('de-DE')}</p>
              </div>
              <div className={`text-right ${activity.type === 'income' ? 'text-green-500' : 'text-red-500'}`}>
                {formatCurrency(activity.amount)}
              </div>
              <Badge variant={activity.type === 'income' ? 'default' : 'destructive'} className="ml-4">
                {activity.type === 'income' ? 'Einnahme' : 'Ausgabe'}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
