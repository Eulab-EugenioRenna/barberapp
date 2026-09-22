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
    subject: "Prenotazione interna registrata per {{customer.firstName}}",
    body: "Nuova prenotazione registrata per {{customer.firstName}} {{customer.lastName}} il {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedInternal,
    channel: NotificationChannel.in_app,
    title: "Prenotazione interna",
    body: "Hai una nuova prenotazione per {{customer.firstName}} {{customer.lastName}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedPublic,
    channel: NotificationChannel.email,
    subject:
      "Prenotazione ricevuta da {{customer.firstName}} {{customer.lastName}}",
    body: "Abbiamo ricevuto una prenotazione pubblica per il servizio {{service.name}} del {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCreatedPublic,
    channel: NotificationChannel.in_app,
    title: "Nuova prenotazione pubblica",
    body: "Nuova richiesta di prenotazione da {{customer.firstName}} {{customer.lastName}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentRequested,
    channel: NotificationChannel.email,
    subject: "Richiesta prenotazione ricevuta",
    body: "La richiesta per {{service.name}} del {{appointment.startsAt}} e' stata ricevuta.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentRequested,
    channel: NotificationChannel.in_app,
    title: "Richiesta da confermare",
    body: "Una nuova richiesta di prenotazione e' in attesa di conferma.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentConfirmed,
    channel: NotificationChannel.email,
    subject: "Prenotazione confermata",
    body: "La tua prenotazione per {{service.name}} del {{appointment.startsAt}} e' confermata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentConfirmed,
    channel: NotificationChannel.in_app,
    title: "Prenotazione confermata",
    body: "La prenotazione di {{customer.firstName}} {{customer.lastName}} e' stata confermata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentAssigned,
    channel: NotificationChannel.email,
    subject: "Nuova assegnazione appuntamento",
    body: "Ti e' stato assegnato l'appuntamento di {{customer.firstName}} {{customer.lastName}} del {{appointment.startsAt}}.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentAssigned,
    channel: NotificationChannel.in_app,
    title: "Nuova assegnazione",
    body: "Ti e' stato assegnato un nuovo appuntamento.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentReassigned,
    channel: NotificationChannel.email,
    subject: "Appuntamento riassegnato",
    body: "L'appuntamento di {{customer.firstName}} {{customer.lastName}} del {{appointment.startsAt}} e' stato riassegnato.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentReassigned,
    channel: NotificationChannel.in_app,
    title: "Appuntamento riassegnato",
    body: "Un appuntamento e' stato riassegnato sul tuo calendario.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCancelled,
    channel: NotificationChannel.email,
    subject: "Prenotazione annullata",
    body: "La prenotazione per {{service.name}} del {{appointment.startsAt}} e' stata annullata.",
  },
  {
    eventType: NOTIFICATION_EVENT_TYPES.appointmentCancelled,
    channel: NotificationChannel.in_app,
    title: "Prenotazione annullata",
    body: "Un appuntamento e' stato annullato.",
  },
];
