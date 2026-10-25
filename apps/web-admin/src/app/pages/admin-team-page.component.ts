import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Component, OnInit, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import type { TeamOverview, TeamRole, TeamUser } from "@eulab/connect/server";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";

interface LocalTeamUser { id: string; firstName: string; lastName: string; role: string; permissions: string[]; permissionsConfigured: boolean; collaborator: { id: string } | null; }
interface LocalTeamContext { users: LocalTeamUser[]; collaborators: { id: string; firstName: string; lastName: string; userId: string | null; isActive: boolean }[]; functions: { key: string; name: string }[]; }
interface LocalPolicyDraft { id: string; role: "manager" | "reception" | "collaborator"; permissions: string[]; collaboratorId: string | null; }

@Component({
  selector: "alora-admin-team-page",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="grid gap-4" aria-labelledby="team-title">
      <header class="panel rounded-[2rem] p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div><p class="eyebrow text-[var(--accent)]">Squadra · Accessi</p>
            <h2 id="team-title" class="mt-1 font-display text-3xl">Le persone, i loro ruoli.</h2>
            <p class="mt-2 max-w-2xl text-sm opacity-75">Gestisci l’accesso a questa attività e le funzioni assegnate a ciascuna persona.</p>
          </div>
          <button class="secondary-btn" type="button" [disabled]="busy || loading" (click)="load()">Aggiorna</button>
        </div>
        <p *ngIf="loading" class="mt-4 text-sm" role="status">Caricamento della squadra…</p>
        <p *ngIf="feedback" class="mt-4 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
        <p *ngIf="overview && !canManage" class="mt-4 rounded-2xl border border-current/10 p-3 text-sm">Puoi consultare la squadra. Per modificarla serve l’abilitazione alla gestione di ruoli e accessi.</p>
      </header>

      <ng-container *ngIf="overview as team">
        <article *ngIf="canAssociateSelf" class="panel grid gap-3 rounded-[2rem] p-5">
          <h3 class="font-display text-2xl">Il mio profilo professionista</h3>
          <p class="text-sm opacity-75">Se esegui servizi, associa il tuo account al tuo profilo nella squadra per consultare le attività assegnate a te.</p>
          <p class="text-sm">{{ selfProfessionalLabel }}</p>
          <div class="flex flex-wrap gap-2"><button class="secondary-btn" type="button" [disabled]="busy" (click)="editSelfProfessional()">Cambia associazione</button><a *ngIf="hasPersonalAgenda" class="secondary-btn" routerLink="/my-agenda">Apri la mia agenda</a></div>
          <form *ngIf="selfDraft as draft" class="grid gap-3 rounded-2xl border border-current/10 p-4" (ngSubmit)="saveSelfProfessional()">
            <label class="field"><span>Il tuo professionista</span><select name="selfProfessional" [(ngModel)]="draft.collaboratorId" [disabled]="busy"><option [ngValue]="null">Nessun professionista</option><option *ngFor="let person of localContext?.collaborators" [ngValue]="person.id" [disabled]="!person.isActive || !!person.userId && person.userId !== draft.id">{{ person.firstName }} {{ person.lastName }}{{ !person.isActive ? ' · non attivo' : person.userId && person.userId !== draft.id ? ' · già associato' : '' }}</option></select></label>
            <p class="text-sm opacity-75">Confermi questo profilo per le tue attività? Gli appuntamenti mantengono il professionista assegnato.</p>
            <div class="flex gap-2"><button class="primary-btn" type="submit" [disabled]="busy">Conferma associazione</button><button class="secondary-btn" type="button" [disabled]="busy" (click)="selfDraft = null">Annulla</button></div>
          </form>
        </article>
        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <article class="panel rounded-[2rem] p-5">
            <div class="flex items-center justify-between gap-3"><h3 class="font-display text-2xl">Ruoli</h3>
              <button *ngIf="canManage" type="button" class="primary-btn" [disabled]="busy" (click)="editRole()">Nuovo ruolo</button>
            </div>
            <p *ngIf="!team.roles.length" class="mt-4 text-sm opacity-70">Non ci sono ancora ruoli per questa attività.</p>
            <div *ngFor="let role of team.roles" class="mt-3 rounded-2xl border border-current/10 p-4">
              <div class="flex flex-wrap items-center justify-between gap-2"><strong>{{ role.name }}</strong>
                <div *ngIf="canEditRole(role)" class="flex gap-2">
                  <button type="button" class="secondary-btn" [disabled]="busy" (click)="editRole(role)">Modifica</button>
                  <button type="button" class="secondary-btn" [disabled]="busy" (click)="deleteRoleId = role.id">Elimina</button>
                </div>
              </div>
              <p class="mt-2 text-sm opacity-75">{{ roleSummary(role) }}</p>
              <div *ngIf="deleteRoleId === role.id" class="mt-3 border-t border-current/10 pt-3">
                <p class="text-sm">Eliminare questo ruolo e le sue assegnazioni?</p>
                <div class="mt-2 flex gap-2"><button type="button" class="primary-btn" [disabled]="busy" (click)="removeRole(role)">Conferma eliminazione</button><button type="button" class="secondary-btn" [disabled]="busy" (click)="deleteRoleId = ''">Annulla</button></div>
              </div>
            </div>

            <form *ngIf="roleDraft && canManage" class="mt-5 grid gap-3 rounded-2xl border border-current/10 p-4" (ngSubmit)="saveRole()">
              <h4 class="font-display text-xl">{{ roleDraft.id ? 'Modifica ruolo' : 'Nuovo ruolo' }}</h4>
              <label class="field"><span>Nome del ruolo</span><input name="roleName" required maxlength="120" [(ngModel)]="roleDraft.name" [disabled]="busy" /></label>
              <fieldset class="grid max-h-80 gap-2 overflow-auto" [disabled]="busy"><legend class="mb-2 text-sm font-semibold">Funzioni concedibili</legend>
                <label *ngFor="let fn of team.functions" class="flex items-start gap-2 text-sm"><input type="checkbox" [disabled]="!fn.delegable" [checked]="roleDraft.permissions.includes(fn.key)" (change)="togglePermission(fn.key, $any($event.target).checked)" /><span>{{ fn.name }}<span *ngIf="!fn.delegable" class="block text-xs opacity-60">Fuori dalla tua delega</span></span></label>
              </fieldset>
              <div class="flex flex-wrap gap-2"><button class="primary-btn" type="submit" [disabled]="busy || !roleDraft.name.trim()">Salva ruolo</button><button class="secondary-btn" type="button" [disabled]="busy" (click)="roleDraft = null">Annulla</button></div>
            </form>
          </article>

          <article class="panel rounded-[2rem] p-5"><h3 class="font-display text-2xl">Account associati</h3>
            <p class="mt-2 text-sm opacity-75">I professionisti senza account continuano a essere gestiti nella sezione Squadra.</p>
            <p *ngIf="!team.users.length" class="mt-4 text-sm opacity-70">Nessun account associato a questa installazione.</p>
            <div *ngFor="let user of team.users" class="mt-3 rounded-2xl border border-current/10 p-4">
              <div class="flex flex-wrap justify-between gap-2"><strong>{{ user.displayName }}</strong><span class="text-xs">{{ user.accessRevoked ? 'Accesso revocato' : !user.identityEnabled || !user.membershipEnabled ? 'Account sospeso' : 'Account attivo' }}</span></div>
              <p class="mt-2 text-sm opacity-75">{{ userRoles(user) }}</p>
              <p *ngIf="localUser(user) as local" class="mt-1 text-xs opacity-65">{{ localRoleLabel(local.role) }} · {{ local.permissionsConfigured ? 'Permessi ALORA configurati' : 'Impostazioni precedenti conservate' }}</p>
              <div *ngIf="canEditUser(user)" class="mt-3 flex flex-wrap gap-2"><button class="secondary-btn" type="button" [disabled]="busy" (click)="editUser(user)">Assegna ruoli</button>
                <button *ngIf="canEditLocalUser(user)" class="secondary-btn" type="button" [disabled]="busy" (click)="editLocalPolicy(user)">Visibilità in ALORA</button>
                <button *ngIf="!user.accessRevoked" class="secondary-btn" type="button" [disabled]="busy" (click)="revokeSubject = user.subject">Revoca accesso ad ALORA</button>
                <button *ngIf="user.accessRevoked" class="secondary-btn" type="button" [disabled]="busy" (click)="changeAccess(user, true)">Ripristina accesso</button>
              </div>
              <div *ngIf="revokeSubject === user.subject" class="mt-3 border-t border-current/10 pt-3"><p class="text-sm">Revocare l’accesso a questa attività? L’identità e gli accessi alle altre app restano conservati.</p><div class="mt-2 flex gap-2"><button class="primary-btn" type="button" [disabled]="busy" (click)="changeAccess(user, false)">Conferma revoca</button><button class="secondary-btn" type="button" [disabled]="busy" (click)="revokeSubject = ''">Annulla</button></div></div>
              <form *ngIf="localDraft?.id === user.localUserId && localDraft as draft" class="mt-4 grid gap-3 rounded-2xl border border-current/10 p-4" (ngSubmit)="saveLocalPolicy()">
                <h4 class="font-display text-xl">Cosa può vedere e fare</h4>
                <p class="text-sm opacity-75">Le scelte qui limitano i permessi assegnati dal ruolo Connect per questa attività.</p>
                <label class="field"><span>Ambito operativo</span><select name="localRole" [(ngModel)]="draft.role" [disabled]="busy"><option value="collaborator">Professionista · solo dati personali</option><option value="reception">Reception</option><option value="manager">Responsabile</option></select></label>
                <label class="field"><span>Professionista associato (facoltativo)</span><select name="localCollaborator" [(ngModel)]="draft.collaboratorId" [disabled]="busy"><option [ngValue]="null">Nessun professionista</option><option *ngFor="let person of localContext?.collaborators" [ngValue]="person.id" [disabled]="!person.isActive || !!person.userId && person.userId !== draft.id">{{ person.firstName }} {{ person.lastName }}{{ !person.isActive ? ' · non attivo' : person.userId && person.userId !== draft.id ? ' · già associato' : '' }}</option></select></label>
                <p *ngIf="localNeedsProfessional() && !draft.collaboratorId" class="text-sm">Associa un professionista per abilitare la sua agenda personale.</p>
                <fieldset class="grid max-h-80 gap-2 overflow-auto" [disabled]="busy"><legend class="mb-2 text-sm font-semibold">Permessi consentiti in ALORA</legend><label *ngFor="let choice of localPermissionChoices(user)" class="flex items-start gap-2 text-sm"><input type="checkbox" [checked]="draft.permissions.includes(choice.key)" [disabled]="!choice.available && !draft.permissions.includes(choice.key)" (change)="toggleLocalPermission(choice.key, $any($event.target).checked)" /><span>{{ choice.name }}<span *ngIf="!choice.available" class="block text-xs opacity-65">Non concedibile con l’ambito o il ruolo attuale: deseleziona per salvare</span></span></label></fieldset>
                <p class="text-xs opacity-75">Nessuna selezione significa nessun permesso operativo. I dati e l’account restano conservati.</p>
                <div class="flex gap-2"><button class="primary-btn" type="submit" [disabled]="busy || !localDraftValid(user)">Salva visibilità</button><button class="secondary-btn" type="button" [disabled]="busy" (click)="localDraft = null">Annulla</button></div>
              </form>
              <form *ngIf="editingSubject === user.subject" class="mt-3 grid gap-3 border-t border-current/10 pt-3" (ngSubmit)="saveAssignment(user)">
                <label *ngFor="let role of team.roles" class="flex items-center gap-2 text-sm"><input type="checkbox" [disabled]="busy || !canEditRole(role)" [checked]="assignedRoleIds.includes(role.id)" (change)="toggleRole(role.id, $any($event.target).checked)" />{{ role.name }}</label>
                <div class="flex gap-2"><button type="submit" class="primary-btn" [disabled]="busy">Salva assegnazioni</button><button class="secondary-btn" type="button" [disabled]="busy" (click)="editingSubject = ''">Annulla</button></div>
              </form>
            </div>
          </article>
        </div>
      </ng-container>
    </section>
  `,
})
export class AdminTeamPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  overview: TeamOverview | null = null;
  localContext: LocalTeamContext | null = null;
  localDraft: LocalPolicyDraft | null = null;
  selfDraft: { id: string; collaboratorId: string | null } | null = null;
  loading = false;
  busy = false;
  feedback = "";
  roleDraft: { id: string; name: string; permissions: string[] } | null = null;
  deleteRoleId = "";
  editingSubject = "";
  revokeSubject = "";
  assignedRoleIds: string[] = [];
  get canManage(): boolean { return !!this.overview?.canManage && this.session.can("team.manage"); }
  get canAssociateSelf(): boolean {
    const current = this.session.currentUser();
    const linked = this.overview?.users.find(user => user.localUserId === current?.id);
    return this.canManage && current?.role === "owner" && !!linked && !linked.accessRevoked && linked.identityEnabled && linked.membershipEnabled;
  }
  get selfLocalUser(): LocalTeamUser | undefined { return this.localContext?.users.find(user => user.id === this.session.currentUser()?.id); }
  get selfProfessionalLabel(): string {
    const professional = this.localContext?.collaborators.find(person => person.id === this.selfLocalUser?.collaborator?.id);
    return professional ? `${professional.firstName} ${professional.lastName}${professional.isActive ? "" : " · non attivo"}` : "Nessun professionista associato";
  }
  get hasPersonalAgenda(): boolean { return this.session.can("appointments.read.own") && !!this.localContext?.collaborators.some(person => person.id === this.selfLocalUser?.collaborator?.id && person.isActive); }
  editSelfProfessional(): void { const user = this.selfLocalUser; if (this.canAssociateSelf && user) this.selfDraft = { id: user.id, collaboratorId: user.collaborator?.id || null }; }
  async saveSelfProfessional(): Promise<void> {
    if (!this.selfDraft || !this.canAssociateSelf) return;
    const collaboratorId = this.selfDraft.collaboratorId;
    await this.mutate(() => firstValueFrom(this.http.put(ADMIN_API_URL + "/team/me/professional", { collaboratorId })));
  }
  ngOnInit(): void { void this.load(); }
  async load(preserveFeedback = false): Promise<void> {
    if (!this.session.can("users.manage")) return;
    if (!preserveFeedback) this.feedback = "";
    this.loading = true;
    try {
      const [overview, local] = await Promise.all([
        firstValueFrom(this.http.get<TeamOverview>(ADMIN_API_URL + "/team")),
        firstValueFrom(this.http.get<LocalTeamContext>(ADMIN_API_URL + "/team/local-users")),
      ]);
      this.overview = overview; this.localContext = local;
    }
    catch (error) {
      this.overview = null; this.localContext = null;
      this.feedback = error && typeof error === "object" && "status" in error && error.status === 403
        ? "Connect non ha abilitato la gestione della squadra per questo account. Verifica licenza, ruolo e delega."
        : "Squadra non disponibile. Verifica l’accesso o riprova con Aggiorna.";
    }
    finally { this.loading = false; }
  }
  canEditRole(role: TeamRole): boolean { return this.canManage && role.permissions.every(key => this.overview!.delegation.some(fn => fn.key === key)); }
  canEditUser(user: TeamUser): boolean {
    return this.canManage && user.localUserId !== this.session.currentUser()?.id && user.roles.every(role => {
      const found = this.overview!.roles.find(item => item.id === role.id);
      return !!found && this.canEditRole(found);
    });
  }
  roleSummary(role: TeamRole): string { return role.permissions.map(key => this.overview?.functions.find(fn => fn.key === key)?.name || key).join(" · ") || "Nessuna funzione assegnata"; }
  userRoles(user: TeamUser): string { return user.roles.map(role => role.name).join(" · ") || "Nessun ruolo assegnato"; }
  editRole(role?: TeamRole): void { this.deleteRoleId = ""; this.roleDraft = { id: role?.id || "", name: role?.name || "", permissions: [...(role?.permissions || [])] }; }
  togglePermission(key: string, checked: boolean): void { if (this.roleDraft) this.roleDraft.permissions = this.toggle(this.roleDraft.permissions, key, checked); }
  toggleRole(id: string, checked: boolean): void { this.assignedRoleIds = this.toggle(this.assignedRoleIds, id, checked); }
  private toggle(values: string[], value: string, checked: boolean): string[] { return checked ? [...new Set([...values, value])] : values.filter(item => item !== value); }
  editUser(user: TeamUser): void { this.editingSubject = user.subject; this.assignedRoleIds = user.roles.map(role => role.id); }
  localUser(user: TeamUser): LocalTeamUser | undefined { return this.localContext?.users.find(item => item.id === user.localUserId); }
  localRoleLabel(role: string): string { return ({ collaborator: "Professionista", manager: "Responsabile", reception: "Reception", owner: "Titolare" } as Record<string, string>)[role] || role; }
  canEditLocalUser(user: TeamUser): boolean { const local = this.localUser(user); return this.canEditUser(user) && !!local && ["manager", "reception", "collaborator"].includes(local.role); }
  editLocalPolicy(user: TeamUser): void {
    const local = this.localUser(user);
    if (!local || !this.canEditLocalUser(user)) return;
    const role = local.role as LocalPolicyDraft["role"];
    const central = new Set(user.roles.flatMap(role => this.overview!.roles.find(item => item.id === role.id)?.permissions || []));
    const permissions = role === "collaborator" && !local.permissionsConfigured
      ? ["appointments.read.own", "appointments.update.own"].filter(key => central.has(key)) : [...local.permissions];
    this.localDraft = { id: local.id, role, permissions, collaboratorId: local.collaborator?.id || null };
  }
  localPermissionChoices(user: TeamUser): { key: string; name: string; available: boolean }[] {
    if (!this.localDraft || !this.localContext) return [];
    const central = new Set(user.roles.flatMap(role => this.overview!.roles.find(item => item.id === role.id)?.permissions || []));
    const licensed = new Set(this.overview!.functions.filter(fn => fn.delegable).map(fn => fn.key));
    const choices = this.localContext.functions.filter(fn => central.has(fn.key)).map(fn => ({ ...fn, available: licensed.has(fn.key) && (this.localDraft!.role !== "collaborator" || ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"].includes(fn.key)) }));
    for (const key of this.localDraft.permissions) if (!choices.some(fn => fn.key === key)) choices.push({ key, name: this.overview?.functions.find(fn => fn.key === key)?.name || key, available: false });
    return choices;
  }
  localNeedsProfessional(): boolean { return !!this.localDraft?.permissions.some(key => ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"].includes(key)); }
  localDraftValid(user: TeamUser): boolean {
    const draft = this.localDraft;
    return !!draft && draft.permissions.every(key => this.localPermissionChoices(user).some(fn => fn.key === key && fn.available)) && !(this.localNeedsProfessional() && !draft.collaboratorId);
  }
  toggleLocalPermission(key: string, checked: boolean): void { if (this.localDraft) this.localDraft.permissions = this.toggle(this.localDraft.permissions, key, checked); }
  async saveLocalPolicy(): Promise<void> {
    const draft = this.localDraft;
    if (!draft) return;
    await this.mutate(() => firstValueFrom(this.http.put(ADMIN_API_URL + "/team/local-users/" + encodeURIComponent(draft.id) + "/policy", { role: draft.role, permissions: draft.permissions, collaboratorId: draft.collaboratorId })));
  }
  private async mutate(operation: () => Promise<unknown>): Promise<void> {
    if (this.busy || !this.canManage) return;
    this.busy = true;
    try {
      await operation();
      this.selfDraft = null; this.localDraft = null; this.roleDraft = null; this.editingSubject = ""; this.deleteRoleId = ""; this.revokeSubject = "";
      this.feedback = "Modifica salvata.";
      await this.load(true);
    } catch { this.feedback = "Esito della modifica da verificare. Aggiorna l’elenco e controlla la delega prima di riprovare. La richiesta non è stata ripetuta automaticamente."; }
    finally { this.busy = false; }
  }
  async saveRole(): Promise<void> {
    const draft = this.roleDraft;
    if (!draft?.name.trim()) return;
    const body = { name: draft.name.trim(), permissions: draft.permissions };
    await this.mutate(() => firstValueFrom(draft.id ? this.http.put(ADMIN_API_URL + "/team/roles/" + encodeURIComponent(draft.id), body) : this.http.post(ADMIN_API_URL + "/team/roles", body)));
  }
  async removeRole(role: TeamRole): Promise<void> { await this.mutate(() => firstValueFrom(this.http.delete(ADMIN_API_URL + "/team/roles/" + encodeURIComponent(role.id)))); }
  async saveAssignment(user: TeamUser): Promise<void> { await this.mutate(() => firstValueFrom(this.http.put(ADMIN_API_URL + "/team/users/" + encodeURIComponent(user.subject) + "/roles", { roleIds: this.assignedRoleIds }))); }
  async changeAccess(user: TeamUser, restore: boolean): Promise<void> {
    const url = ADMIN_API_URL + "/team/users/" + encodeURIComponent(user.subject);
    await this.mutate(() => firstValueFrom(restore ? this.http.post(url + "/restore", {}) : this.http.delete(url + "/access")));
  }
}
