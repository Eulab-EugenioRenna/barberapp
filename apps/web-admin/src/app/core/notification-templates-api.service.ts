import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

export interface NotificationTemplateView {
  id: string;
  eventType: string;
  channel: "email" | "in_app";
  subject: string | null;
  title: string | null;
  body: string;
  updatedAt: string;
}
export interface TemplateDraft {
  subject: string;
  title: string;
  body: string;
}
export interface TemplatePreview extends TemplateDraft {
  placeholders: string[];
  sampleOnly: boolean;
}

@Injectable({ providedIn: "root" })
export class NotificationTemplatesApiService {
  private readonly http = inject(HttpClient);
  private readonly root = `${ADMIN_API_URL}/notifications/templates`;
  list() {
    return firstValueFrom(this.http.get<NotificationTemplateView[]>(this.root));
  }
  private path(template: NotificationTemplateView) {
    return `${this.root}/${encodeURIComponent(template.eventType)}/${encodeURIComponent(template.channel)}`;
  }
  preview(template: NotificationTemplateView, draft: TemplateDraft) {
    return firstValueFrom(
      this.http.post<TemplatePreview>(this.path(template) + "/preview", draft),
    );
  }
  save(template: NotificationTemplateView, draft: TemplateDraft) {
    return firstValueFrom(
      this.http.patch<NotificationTemplateView>(this.path(template), {
        ...draft,
        expectedUpdatedAt: template.updatedAt,
      }),
    );
  }
}
