import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  OnChanges,
  HostListener,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import type { TeamOverview, TeamRole, TeamUser } from "@eulab/connect/server";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
import {
  ROLE_OPTIONS,
  COLLABORATOR_FUNCTIONS,
  PERSONAL_FUNCTIONS,
  changeRoleOption,
  sameFunctions,
  roleScope,
} from "./team-role-options";

interface Professional {
  id: string;
  firstName: string;
  lastName: string;
  userId?: string | null;
  isActive?: boolean;
  email?: string;
  weeklySchedules?: unknown[];
  [key: string]: unknown;
}
interface LocalUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  permissionsConfigured: boolean;
  collaborator: { id: string } | null;
}
interface LocalContext {
  users: LocalUser[];
  collaborators: Professional[];
}
interface Person {
  id: string;
  name: string;
  professional: Professional | null;
  user: TeamUser | null;
  local: LocalUser | null;
}
interface AccountDraft {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  collaboratorId: string | null;
}
interface Pending extends AccountDraft {
  role: string;
  roleIds: string[];
}
@Component({
  selector: "alora-admin-team-page",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AutofocusFirstDirective],
  templateUrl: "./admin-team-page.component.html",
})
export class AdminTeamPageComponent implements OnInit, OnChanges {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  @Input() professionals: Professional[] = [];
  @Output() editProfessional = new EventEmitter<Professional>();
  @Output() newProfessional = new EventEmitter<void>();
  overview: TeamOverview | null = null;
  local: LocalContext | null = null;
  pending: Pending[] = [];
  selected: Person | null = null;
  private initialized = false;
  query = "";
  loading = false;
  busy = false;
  feedback = "";
  rolePanel = false;
  roleDraft: { id: string; name: string; permissions: string[] } | null = null;
  account: AccountDraft | null = null;
  accountAttempted = false;
  accountPassword = "";
  recoveryPassword = "";
  pendingId = "";
  choice = "preset:collaborator";
  policyOpen = false;
  professionalId: string | null = null;
  confirmPasswordReset = false;
  showInitialPassword = false;
  confirmRevoke = false;
  deleteRoleId = "";
  readonly options = ROLE_OPTIONS;
  get canManage(): boolean {
    return !!this.overview?.canManage && this.session.can("team.manage");
  }
  get canEditProfiles(): boolean {
    return (
      this.session.can("collaborators.manage") &&
      this.session.can("collaborators.read")
    );
  }
  get ownerFunctions(): string[] {
    return (
      this.overview?.functions
        .filter((fn) => fn.delegable && this.session.can(fn.key))
        .map((fn) => fn.key) || []
    );
  }
  isPreset(role: TeamRole, kind: "owner" | "collaborator"): boolean {
    const name = kind === "owner" ? "Titolare" : "Collaboratore";
    if (role.name.toLocaleLowerCase() !== name.toLocaleLowerCase())
      return false;
    if (kind === "owner")
      return ["team.manage", "users.manage"].every((key) =>
        role.permissions.includes(key),
      );
    return sameFunctions(role.permissions, COLLABORATOR_FUNCTIONS);
  }
  get customRoles(): TeamRole[] {
    const ownerRoles = new Set(
      (this.overview?.users || [])
        .filter((user) =>
          this.local?.users.some(
            (local) => local.id === user.localUserId && local.role === "owner",
          ),
        )
        .flatMap((user) => user.roles.map((role) => role.id)),
    );
    return (
      this.overview?.roles.filter(
        (role) =>
          !ownerRoles.has(role.id) &&
          !this.isPreset(role, "collaborator") &&
          !this.isPreset(role, "owner"),
      ) || []
    );
  }
  get profileChoices(): Professional[] {
    const known = this.local?.collaborators || [];
    return [
      ...known.map((pro) => ({
        ...this.professionals.find((p) => p.id === pro.id),
        ...pro,
      })),
      ...this.professionals.filter(
        (pro) => !known.some((item) => item.id === pro.id),
      ),
    ];
  }
  isPending(person: Person): boolean {
    return this.pending.some((draft) => draft.id === person.local?.id);
  }
  get people(): Person[] {
    const users = this.overview?.users || [],
      locals = this.local?.users || [];
    const result: Person[] = this.profileChoices.map((pro) => {
      const professional = {
        ...this.professionals.find((p) => p.id === pro.id),
        ...pro,
      };
      const local = locals.find((u) => u.collaborator?.id === pro.id) || null;
      return {
        id: pro.id,
        name: pro.firstName + " " + pro.lastName,
        professional,
        local,
        user: users.find((u) => u.localUserId === local?.id) || null,
      };
    });
    for (const user of users) {
      if (result.some((p) => p.user?.subject === user.subject)) continue;
      const local = locals.find((u) => u.id === user.localUserId) || null;
      result.push({
        id: user.subject,
        name: local ? local.firstName + " " + local.lastName : user.displayName,
        professional: null,
        user,
        local,
      });
    }
    return result.filter((p) =>
      p.name
        .toLocaleLowerCase()
        .includes(this.query.trim().toLocaleLowerCase()),
    );
  }
  label(person: Person): string {
    if (person.local?.role === "owner") return "Titolare";
    if (!person.user) return "Collaboratore";
    const role =
      person.user.roles.length === 1
        ? this.overview?.roles.find((r) => r.id === person.user!.roles[0].id)
        : undefined;
    if (role && this.isPreset(role, "collaborator")) return "Collaboratore";
    if (role && this.isPreset(role, "owner")) return "Titolare";
    return (
      person.user.roles.map((r) => r.name).join(" · ") || "Ruolo da assegnare"
    );
  }
  accessLabel(person: Person): string {
    if (this.isPending(person)) return "Creazione da completare";
    if (!this.overview) return "Accesso da verificare";
    if (!person.user) return "Senza accesso";
    if (person.user.accessRevoked) return "Accesso revocato";
    if (!person.user.identityEnabled || !person.user.membershipEnabled)
      return "Accesso sospeso";
    return "Accesso attivo";
  }
  trackPerson(_index: number, person: Person): string { return person.id; }
  get canReadOwnAgenda(): boolean { return this.session.can("appointments.read.own"); }
  get canReadTeamAgenda(): boolean { return this.session.can("appointments.read.all"); }
  isSelf(person: Person): boolean {
    return person.local?.id === this.session.currentUser()?.id;
  }
  canEditRole(role: TeamRole): boolean {
    return (
      this.canManage &&
      role.permissions.every((key) =>
        this.overview!.delegation.some((fn) => fn.key === key),
      )
    );
  }
  canEditPerson(person: Person): boolean {
    return (
      this.canManage &&
      !!person.user &&
      !this.isSelf(person) &&
      !!person.local &&
      person.local.role !== "owner" &&
      person.user.roles.every((r) => {
        const role = this.overview?.roles.find((item) => item.id === r.id);
        return !!role && this.canEditRole(role);
      })
    );
  }
  functions(user: TeamUser): string[] {
    return [
      ...new Set(
        user.roles.flatMap(
          (r) =>
            this.overview?.roles.find((role) => role.id === r.id)
              ?.permissions || [],
        ),
      ),
    ];
  }
  ngOnInit(): void {
    this.initialized = true;
    void this.load();
  }
  ngOnChanges(): void {
    if (this.initialized && !this.busy) void this.load();
  }
  async load(): Promise<void> {
    this.loading = true;
    try {
      const [overview, local] = await Promise.allSettled([
        firstValueFrom(this.http.get<TeamOverview>(ADMIN_API_URL + "/team")),
        firstValueFrom(
          this.http.get<LocalContext>(ADMIN_API_URL + "/team/local-users"),
        ),
      ]);
      this.overview = overview.status === "fulfilled" ? overview.value : null;
      this.local = local.status === "fulfilled" ? local.value : null;
      if (!this.overview)
        this.feedback =
          "Ruoli e accessi non disponibili: verifica le abilitazioni dell’attività. I profili caricati restano consultabili.";
      this.pending = this.canManage
        ? await firstValueFrom(
            this.http.get<Pending[]>(ADMIN_API_URL + "/team/accounts/pending"),
          )
        : [];
    } catch {
      this.feedback =
        "La squadra non è disponibile. Premi Aggiorna o verifica le abilitazioni dell’attività.";
    } finally {
      this.loading = false;
    }
  }
  open(person: Person): void {
    this.feedback = "";
    this.selected = person;
    this.policyOpen = false;
    this.confirmRevoke = false;
    this.confirmPasswordReset = false;
    this.professionalId = person.professional?.id || null;
  }
  close(): void {
    if (!this.busy) {
      this.selected = null;
      this.account = null;
      this.accountPassword = "";
      this.policyOpen = false;
    }
  }
  @HostListener("document:keydown.escape") dismiss(): void {
    if (this.busy) return;
    this.close();
    this.rolePanel = false;
    this.roleDraft = null;
  }
  async editProfile(person: Person): Promise<void> {
    if (!person.professional || !this.canEditProfiles || this.busy) return;
    try {
      // Fetch the complete record: a minimal team projection must never overwrite schedules.
      const profile = await firstValueFrom(
        this.http.get<Professional>(
          ADMIN_API_URL +
            "/collaborators/" +
            encodeURIComponent(person.professional.id),
        ),
      );
      this.selected = null;
      this.editProfessional.emit(profile);
    } catch {
      this.feedback =
        "Scheda non disponibile. Aggiorna la squadra prima di riprovare.";
    }
  }
  createAccess(person?: Person): void {
    if (!this.canManage || (person && this.isPending(person))) return;
    this.feedback = "";
    this.selected = null;
    this.choice = "preset:collaborator";
    this.accountAttempted = false;
    this.accountPassword =
      "Aa1!" +
      Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
        value.toString(16).padStart(8, "0"),
      ).join("");
    this.showInitialPassword = false;
    this.account = {
      id: crypto.randomUUID(),
      firstName: person?.professional?.firstName || "",
      lastName: person?.professional?.lastName || "",
      email: person?.professional?.email || "",
      collaboratorId: person?.professional?.id || null,
    };
  }
  choiceFunctions(choice = this.choice): string[] {
    if (choice === "preset:collaborator") return [...COLLABORATOR_FUNCTIONS];
    if (choice === "preset:owner")
      return this.overview?.functions.map((fn) => fn.key) || [];
    return [
      ...(this.overview?.roles.find((r) => r.id === choice)?.permissions || []),
    ];
  }
  choiceAvailable(choice: string): boolean {
    const keys = this.choiceFunctions(choice);
    if (!keys.length) return false;
    if (
      choice === "preset:owner" &&
      !["team.manage", "users.manage"].every((key) => keys.includes(key))
    )
      return false;
    return keys.every(
      (key) =>
        this.overview?.functions.some((fn) => fn.key === key && fn.delegable) &&
        this.session.can(key),
    );
  }
  get requiresProfile(): boolean {
    return roleScope(this.choiceFunctions()) === "collaborator";
  }
  choiceLocalFunctions(): string[] {
    // A company role can also work without a personal schedule association.
    return this.choiceFunctions().filter(
      (key) => !!this.professionalId || !PERSONAL_FUNCTIONS.includes(key),
    );
  }
  get accountValid(): boolean {
    return (
      !!this.accountPassword &&
      !!this.account?.firstName.trim() &&
      !!this.account?.lastName.trim() &&
      !!this.account?.email.trim() &&
      this.choiceAvailable(this.choice) &&
      (!this.requiresProfile || !!this.account.collaboratorId)
    );
  }
  private async resolveRole(): Promise<string> {
    if (!this.choiceAvailable(this.choice))
      throw Error("Ruolo non disponibile");
    if (!this.choice.startsWith("preset:")) return this.choice;
    const permissions = this.choiceFunctions();
    const existing = this.overview?.roles.find(
      (role) =>
        this.canEditRole(role) &&
        this.isPreset(
          role,
          this.choice === "preset:owner" ? "owner" : "collaborator",
        ) &&
        sameFunctions(role.permissions, permissions),
    );
    if (existing) return existing.id;
    // Created only on explicit confirmation, never on page load. No mutation retry.
    const role = await firstValueFrom(
      this.http.post<TeamRole>(ADMIN_API_URL + "/team/roles", {
        name: this.choice === "preset:owner" ? "Titolare" : "Collaboratore",
        permissions,
      }),
    );
    this.overview!.roles.push(role);
    return role.id;
  }
  async createAccount(): Promise<void> {
    if (
      this.busy ||
      !this.canManage ||
      !this.accountValid ||
      this.accountAttempted
    )
      return;
    this.busy = true;
    const draft = { ...this.account! },
      password = this.accountPassword;
    this.accountPassword = "";
    this.accountAttempted = true;
    try {
      const roleId = await this.resolveRole();
      const keys = this.choiceFunctions(),
        role = this.choice === "preset:owner" ? "manager" : roleScope(keys);
      const permissions = draft.collaboratorId
        ? keys
        : keys.filter((key) => !PERSONAL_FUNCTIONS.includes(key));
      const result = await firstValueFrom(
        this.http.post<{ ssoSetupRequired: boolean }>(
          ADMIN_API_URL + "/team/accounts",
          {
            ...draft,
            role,
            permissions,
            roleIds: [roleId],
            ...(password ? { initialPassword: password } : {}),
          },
        ),
      );
      this.account = null;
      this.feedback = result.ssoSetupRequired
        ? "Accesso creato con password temporanea. Al primo accesso la persona dovrà scegliere una nuova password."
        : "Accesso creato. La persona può accedere con il proprio account.";
    } catch {
      this.feedback =
        "Esito da verificare. Aggiorna la squadra e controlla le creazioni da completare prima di riprovare. Nessun invio è stato ripetuto.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  async resumeAccount(id: string): Promise<void> {
    if (this.busy || !this.canManage) return;
    this.busy = true;
    const password = this.recoveryPassword;
    this.recoveryPassword = "";
    try {
      await firstValueFrom(
        this.http.post(
          ADMIN_API_URL +
            "/team/accounts/" +
            encodeURIComponent(id) +
            "/resume",
          password ? { initialPassword: password } : {},
        ),
      );
      this.pendingId = "";
      this.feedback =
        "Creazione completata. Verifica l’accesso con la persona.";
    } catch {
      this.feedback =
        "Creazione da verificare. Il profilo e l’ID rimangono gli stessi; nessun invio è stato ripetuto.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  editAccess(): void {
    const person = this.selected;
    if (!person || !this.canEditPerson(person)) return;
    const role =
      person.user!.roles.length === 1
        ? this.overview?.roles.find(
            (role) => role.id === person.user!.roles[0].id,
          )
        : undefined;
    this.choice =
      role && this.isPreset(role, "collaborator")
        ? "preset:collaborator"
        : role && this.isPreset(role, "owner")
          ? "preset:owner"
          : role?.id || "";
    this.professionalId = person.local?.collaborator?.id || null;
    this.policyOpen = true;
  }
  async saveAccess(): Promise<void> {
    const person = this.selected;
    if (
      !person ||
      !this.canEditPerson(person) ||
      this.busy ||
      !this.choiceAvailable(this.choice) ||
      (this.requiresProfile && !this.professionalId)
    )
      return;
    this.busy = true;
    const id = person.local!.id,
      collaboratorId = this.professionalId;
    try {
      const roleId = await this.resolveRole();
      // Restrict before changing central grants. On partial failure, never leave broader local access.
      await firstValueFrom(
        this.http.put(
          ADMIN_API_URL +
            "/team/local-users/" +
            encodeURIComponent(id) +
            "/policy",
          { role: "collaborator", permissions: [], collaboratorId },
        ),
      );
      await firstValueFrom(
        this.http.put(
          ADMIN_API_URL +
            "/team/users/" +
            encodeURIComponent(person.user!.subject) +
            "/roles",
          { roleIds: [roleId] },
        ),
      );
      const permissions = this.choiceLocalFunctions();
      await firstValueFrom(
        this.http.put(
          ADMIN_API_URL +
            "/team/local-users/" +
            encodeURIComponent(id) +
            "/policy",
          {
            role: roleScope(this.choiceFunctions()),
            permissions,
            collaboratorId,
          },
        ),
      );
      this.selected = null;
      this.policyOpen = false;
      this.feedback = "Ruolo e accesso aggiornati.";
    } catch {
      this.feedback =
        "Modifica da completare: per sicurezza l’accesso può essere limitato. Aggiorna e verifica il ruolo prima di confermare di nuovo. Nessuna richiesta è stata ripetuta.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  canResetPassword(person: Person): boolean {
    return (
      this.canEditPerson(person) &&
      this.session.can("team.password.reset") &&
      !!person.user?.identityEnabled &&
      !!person.user.membershipEnabled &&
      !person.user.accessRevoked
    );
  }
  async resetPassword(): Promise<void> {
    const person = this.selected;
    if (
      !person ||
      !this.confirmPasswordReset ||
      !this.canResetPassword(person) ||
      this.busy
    )
      return;
    this.busy = true;
    try {
      await firstValueFrom(
        this.http.post(
          ADMIN_API_URL +
            "/team/users/" +
            encodeURIComponent(person.user!.subject) +
            "/password-reset",
          {},
        ),
      );
      this.confirmPasswordReset = false;
      this.feedback =
        "Recupero richiesto a Connect. Verifica con la persona la ricezione del link: la password cambia solo quando completa la procedura.";
    } catch {
      this.feedback =
        "Richiesta non confermata. Verifica la ricezione del link con la persona prima di un nuovo invio; nessuna richiesta è stata ripetuta automaticamente.";
    } finally {
      this.busy = false;
    }
  }
  async revoke(): Promise<void> {
    const person = this.selected;
    if (
      !person ||
      !this.canEditPerson(person) ||
      !this.confirmRevoke ||
      this.busy
    )
      return;
    this.busy = true;
    try {
      await firstValueFrom(
        this.http.delete(
          ADMIN_API_URL +
            "/team/users/" +
            encodeURIComponent(person.user!.subject) +
            "/access",
        ),
      );
      this.selected = null;
      this.feedback =
        "Accesso revocato. Il profilo della persona è conservato.";
    } catch {
      this.feedback =
        "Esito da verificare. Aggiorna la squadra prima di un’altra operazione.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  get canAssociateSelf(): boolean {
    return (
      !!this.selected &&
      this.isSelf(this.selected) &&
      this.selected.local?.role === "owner" &&
      this.canManage
    );
  }
  async saveSelf(): Promise<void> {
    if (!this.canAssociateSelf || this.busy) return;
    this.busy = true;
    try {
      await firstValueFrom(
        this.http.put(ADMIN_API_URL + "/team/me/professional", {
          collaboratorId: this.professionalId,
        }),
      );
      this.selected = null;
      this.feedback = "Profilo professionista aggiornato.";
    } catch {
      this.feedback =
        "Associazione da verificare. Aggiorna prima di riprovare.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  editCustom(role?: TeamRole): void {
    this.feedback = "";
    this.rolePanel = true;
    this.deleteRoleId = "";
    this.roleDraft = {
      id: role?.id || "",
      name: role?.name || "",
      permissions: [...(role?.permissions || [])],
    };
  }
  optionSelected(option: (typeof ROLE_OPTIONS)[number]): boolean {
    return option.keys.every((key) =>
      this.roleDraft?.permissions.includes(key),
    );
  }
  optionPartial(option: (typeof ROLE_OPTIONS)[number]): boolean {
    return (
      !this.optionSelected(option) &&
      option.keys.some((key) => this.roleDraft?.permissions.includes(key))
    );
  }
  optionAvailable(option: (typeof ROLE_OPTIONS)[number]): boolean {
    return option.keys.every((key) => this.ownerFunctions.includes(key));
  }
  toggleOption(option: (typeof ROLE_OPTIONS)[number], checked: boolean): void {
    if (this.roleDraft)
      this.roleDraft.permissions = changeRoleOption(
        this.roleDraft.permissions,
        option,
        checked,
      );
  }
  get customNameValid(): boolean {
    return (
      !!this.roleDraft?.name.trim() &&
      !["titolare", "collaboratore"].includes(
        this.roleDraft.name.trim().toLocaleLowerCase(),
      )
    );
  }
  async saveCustom(): Promise<void> {
    const draft = this.roleDraft;
    if (
      !draft ||
      !this.customNameValid ||
      this.busy ||
      !this.canManage ||
      !draft.permissions.length ||
      draft.permissions.some((key) => !this.ownerFunctions.includes(key))
    )
      return;
    this.busy = true;
    try {
      const body = { name: draft.name.trim(), permissions: draft.permissions };
      await firstValueFrom(
        draft.id
          ? this.http.put(
              ADMIN_API_URL + "/team/roles/" + encodeURIComponent(draft.id),
              body,
            )
          : this.http.post(ADMIN_API_URL + "/team/roles", body),
      );
      this.roleDraft = null;
      this.feedback =
        "Ruolo personalizzato salvato. Ora puoi assegnarlo alle persone.";
    } catch {
      this.feedback =
        "Esito del ruolo da verificare. Aggiorna l’elenco prima di riprovare.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
  async deleteCustom(role: TeamRole): Promise<void> {
    if (this.deleteRoleId !== role.id || !this.canEditRole(role) || this.busy)
      return;
    this.busy = true;
    try {
      await firstValueFrom(
        this.http.delete(
          ADMIN_API_URL + "/team/roles/" + encodeURIComponent(role.id),
        ),
      );
      this.deleteRoleId = "";
      this.feedback =
        "Ruolo eliminato. Verifica le persone a cui era assegnato.";
    } catch {
      this.feedback = "Esito da verificare. Aggiorna prima di riprovare.";
    } finally {
      await this.load();
      this.busy = false;
    }
  }
}
