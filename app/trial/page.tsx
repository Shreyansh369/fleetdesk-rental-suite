import { LiveOnly } from "@/components/live-only";
import { SignupForm } from "@/components/signup-form";

export default function TrialPage() {
  return (
    <LiveOnly>
      <SignupForm variant="trial" />
    </LiveOnly>
  );
}
