import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { UiPageComponent, UiTabsComponent, type UiTab } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { AppointmentAutomationAccessComponent } from "../shared/appointment-automation-access.component";
import { AppointmentAutomationMonitorComponent } from "../shared/appointment-automation-monitor.component";
import { AppointmentAutomationPolicyComponent } from "../shared/appointment-automation-policy.component";
import { NotificationTemplateEditorComponent } from "../shared/notification-template-editor.component";

type Section = "rules" | "activity" | "templates" | "connection";

/**
 * Automatic appointment messages. «Promemoria automatici» is a guided
 * sequence that also creates the permissions it needs; «Permessi» is only
 * for reviewing or revoking them later.
 */
@Component({
  standalone: true,
  imports: [
    CommonModule,
    UiPageComponent,
    UiTabsComponent,
    AdminPageHeaderComponent,
    AppointmentAutomationPolicyComponent,
    AppointmentAutomationMonitorComponent,
    NotificationTemplateEditorComponent,
    AppointmentAutomationAccessComponent,
  ],
  template: `<ui-page>
    <alora-page-header navKey="notifications"></alora-page-header>
    <ui-tabs
      ariaLabel="Sezioni di promemoria e notifiche"
      [tabs]="tabs"
      [active]="section"
      (activeChange)="show($event)"
    ></ui-tabs>
    <section role="tabpanel" [attr.id]="'ui-tabpanel-' + section" [attr.aria-labelledby]="'ui-tab-' + section">
      <ng-container [ngSwitch]="section">
        <app-appointment-automation-policy *ngSwitchCase="'rules'" />
        <app-appointment-automation-monitor *ngSwitchCase="'activity'" />
        <app-notification-template-editor *ngSwitchCase="'templates'" />
        <app-appointment-automation-access *ngSwitchCase="'connection'" />
      </ng-container>
    </section>
  </ui-page>`,
})
export class NotificationsSettingsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs: UiTab[] = [
    { key: "rules", label: "Promemoria automatici" },
    { key: "activity", label: "Risposte e prossimi invii" },
    { key: "templates", label: "Avvisi email e app" },
    { key: "connection", label: "Permessi" },
  ];
  section: Section = this.readSection();

  show(key: string): void {
    this.section = key as Section;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: key === "rules" ? null : key },
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  private readSection(): Section {
    const value = this.route.snapshot.queryParamMap.get("section");
    return this.tabs.some((tab) => tab.key === value) ? (value as Section) : "rules";
  }
}
