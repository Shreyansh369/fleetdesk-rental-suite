import type { VehicleStatus } from "./types";

const TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  available: ["reserved", "maintenance", "out_of_service", "cleaning"],
  reserved: ["available", "rented", "maintenance", "out_of_service"],
  rented: ["overdue", "cleaning", "maintenance", "available"],
  overdue: ["cleaning", "maintenance", "available"],
  cleaning: ["available", "maintenance", "out_of_service"],
  maintenance: ["available", "out_of_service"],
  out_of_service: ["maintenance", "available"],
};

export function isValidVehicleTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
