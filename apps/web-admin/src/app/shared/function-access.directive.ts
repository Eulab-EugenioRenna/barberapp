import { Directive, inject, input } from "@angular/core";
import { SessionStore } from "../core/session.store";

/** Presentation only: the API independently enforces the same function. */
@Directive({
  selector: "[aloraFunction]",
  standalone: true,
  host: { "[style.display]": "allowed() ? null : 'none'" },
})
export class FunctionAccessDirective {
  readonly aloraFunction = input.required<string>();
  private readonly session = inject(SessionStore);
  allowed(): boolean {
    return this.session.can(this.aloraFunction());
  }
}
