import { LiveOnly } from "@/components/live-only";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <LiveOnly>
      <LoginForm />
    </LiveOnly>
  );
}
