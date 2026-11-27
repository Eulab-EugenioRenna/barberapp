// ALORA design system. Components here depend only on Angular and on the
// brand tokens (libs/shared/brand/src/theme.css), never on app services.
export { UiIconComponent, type UiIconName } from "./icon/ui-icon.component";
export {
  UiBreakpointService,
  UI_BREAKPOINTS,
  type UiViewport,
} from "./layout/ui-breakpoint.service";
export { UiAppShellComponent } from "./layout/ui-app-shell.component";
export { UiPageHeaderComponent } from "./layout/ui-page-header.component";
export { UiPageComponent } from "./layout/ui-page.component";
export { UiTabsComponent, type UiTab } from "./layout/ui-tabs.component";
export type { UiNavGroup, UiNavItem } from "./nav/ui-nav.types";
export { UiSideNavComponent } from "./nav/ui-side-nav.component";
export { UiBottomNavComponent } from "./nav/ui-bottom-nav.component";
export {
  type UiOption,
  type UiOptionValue,
  uiOptions,
  uiOptionMatches,
} from "./select/ui-option";
export { UiSelectComponent, uiSameValue } from "./select/ui-select.component";
export { UiMultiSelectComponent } from "./select/ui-multi-select.component";
export { UiAutocompleteComponent } from "./select/ui-autocomplete.component";
export {
  UiSheetComponent,
  type UiSheetSize,
} from "./sheet/ui-sheet.component";
export {
  UiConfirmComponent,
  UiConfirmService,
  type UiConfirmOptions,
} from "./sheet/ui-confirm.component";
export { UiMoreMenuComponent } from "./sheet/ui-more-menu.component";
