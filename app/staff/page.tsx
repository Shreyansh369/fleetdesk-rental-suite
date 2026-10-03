import { ProtectedPage } from "@/components/protected-page";
import { StaffDirectory } from "@/components/staff-directory";

export default function StaffPage() {
  return (
    <ProtectedPage>
      <StaffDirectory />
    </ProtectedPage>
  );
}
