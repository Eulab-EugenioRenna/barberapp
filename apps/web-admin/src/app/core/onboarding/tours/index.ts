import type { TourDefinition } from "../tour.types";
import { ACCOUNT_TOUR } from "./account.tour";
import { APPOINTMENTS_TOUR } from "./appointments.tour";
import { COLLABORATORS_TOUR } from "./collaborators.tour";
import { CUSTOMERS_TOUR } from "./customers.tour";
import { DASHBOARD_TOUR } from "./dashboard.tour";
import { GENERAL_TOUR } from "./general.tour";
import { INVENTORY_TOUR } from "./inventory.tour";
import { LOCATIONS_TOUR } from "./locations.tour";
import { MY_AGENDA_TOUR } from "./my-agenda.tour";
import { NOTIFICATIONS_TOUR } from "./notifications.tour";
import { PLATFORM_TOUR } from "./platform.tour";
import { SALES_TOUR } from "./sales.tour";
import { SERVICES_TOUR } from "./services.tour";
import { SETTINGS_TOUR } from "./settings.tour";
import { WHATSAPP_TOUR } from "./whatsapp.tour";

/** Every guide of the admin: the general one plus one per page (same order as the menu). */
export const ADMIN_TOURS: readonly TourDefinition[] = [
  GENERAL_TOUR,
  DASHBOARD_TOUR,
  APPOINTMENTS_TOUR,
  SALES_TOUR,
  CUSTOMERS_TOUR,
  WHATSAPP_TOUR,
  SERVICES_TOUR,
  INVENTORY_TOUR,
  LOCATIONS_TOUR,
  COLLABORATORS_TOUR,
  NOTIFICATIONS_TOUR,
  SETTINGS_TOUR,
  MY_AGENDA_TOUR,
  ACCOUNT_TOUR,
  PLATFORM_TOUR,
];
