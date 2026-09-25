import { NotificationChannel } from "@prisma/client";
import {
  NOTIFICATION_EVENT_TYPES,
  NotificationEventType,
} from "./notifications.constants";

type NotificationTemplateSeed = {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  subject?: string;
  title?: string;
  body: string;
};

export const DEFAULT_NOTIFICATION_TEMPLATES: NotificationTemplateSeed[] = [
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedInternal,
    channel: NotificationChannel.email,
    subject: "Nuovo appuntamento per {{customer.firstName}}",
    body: "Hai registrato un appuntamento per {{customer.firstName}} {{customer.lastName}} il {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedInternal,
    channel: NotificationChannel.in_app,
    title: "Nuovo appuntamento",
    body: "Hai una nuova prenotazione per {{customer.firstName}} {{customer.lastName}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedPublic,
    channel: NotificationChannel.email,
    subject:
      "Richiesta di {{customer.firstName}} {{customer.lastName}}",
    body: "Hai ricevuto una richiesta per {{service.name}} il {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedPublic,
    channel: NotificationChannel.in_app,
    title: "Nuova richiesta online",
    body: "Nuova richiesta di prenotazione da {{customer.firstName}} {{customer.lastName}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentRequested,
    channel: NotificationChannel.email,
    subject: "Richiesta prenotazione ricevuta",
    body: "La richiesta per {{service.name}} del {{appointment.startsAt}} è stata ricevuta.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentRequested,
    channel: NotificationChannel.in_app,
    title: "Richiesta da confermare",
    body: "Una nuova richiesta di prenotazione è in attesa di conferma.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentConfirmed,
    channel: NotificationChannel.email,
    subject: "Prenotazione confermata",
    body: "La tua prenotazione per {{service.name}} del {{appointment.startsAt}} è confermata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentConfirmed,
    channel: NotificationChannel.in_app,
    title: "Prenotazione confermata",
    body: "La prenotazione di {{customer.firstName}} {{customer.lastName}} è stata confermata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentAssigned,
    channel: NotificationChannel.email,
    subject: "Nuova assegnazione appuntamento",
    body: "Ti è stato assegnato l'appuntamento di {{customer.firstName}} {{customer.lastName}} del {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentAssigned,
    channel: NotificationChannel.in_app,
    title: "Nuova assegnazione",
    body: "Ti è stato assegnato un nuovo appuntamento.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentReassigned,
    channel: NotificationChannel.email,
    subject: "Appuntamento riassegnato",
    body: "L'appuntamento di {{customer.firstName}} {{customer.lastName}} del {{appointment.startsAt}} è stato riassegnato.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentReassigned,
    channel: NotificationChannel.in_app,
    title: "Appuntamento riassegnato",
    body: "Un appuntamento è stato riassegnato nella tua agenda.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCancelled,
    channel: NotificationChannel.email,
    subject: "Prenotazione annullata",
    body: "La prenotazione per {{service.name}} del {{appointment.startsAt}} è stata annullata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCancelled,
    channel: NotificationChannel.in_app,
    title: "Prenotazione annullata",
    body: "Un appuntamento è stato annullato.",
  },
];
