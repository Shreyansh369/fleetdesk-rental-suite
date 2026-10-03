import { ReservationComposer } from "@/components/reservation-composer";
import { ProtectedPage } from "@/components/protected-page";

export default function RentalsPage() {
  return <ProtectedPage><ReservationComposer /></ProtectedPage>;
}
