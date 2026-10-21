import { ExpenseDetail } from '@/components/purchases/expense-detail';

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  return <ExpenseDetail id={(await params).id} />;
}
