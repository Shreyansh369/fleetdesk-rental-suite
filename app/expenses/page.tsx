import { ExpenseRecorder } from "@/components/expense-recorder";
import { ProtectedPage } from "@/components/protected-page";

export default function ExpensesPage() {
  return (
    <ProtectedPage>
      <ExpenseRecorder />
    </ProtectedPage>
  );
}
