# Implementation Plan

## MVP Scope

The PRD describes a full SaaS. This implementation establishes the foundation needed to build it safely:

1. Monorepo structure for API, admin frontend, public booking frontend, and shared libraries.
2. Tenant-scoped Prisma schema for core business entities.
3. NestJS API module structure and REST surface aligned to the PRD.
4. Angular admin shell for dashboard, calendar, management navigation, and touch-mode affordances.
5. Angular public booking shell for white-label service selection and booking request capture.
6. Docker Compose for PostgreSQL, API runtime, and MailHog.

## Implemented Modules

- Auth: login, refresh, logout, current user stubs.
- Tenant settings: white-label settings read/update and public settings route.
- Users and roles: base user listing and shared role/permission vocabulary.
- Collaborators, services, rooms, customers: management endpoints.
- Appointments: internal CRUD, status update, cancellation, cancellation policy.
- Availability: slot response with conflict-check categories.
- Public booking: tenant settings, public services, availability, booking creation.
- Products and sales: product management, service-product association, sales endpoints.
- Dashboard: revenue, appointments, collaborators, services, products.
- Notifications: preferences, history, templates, integration test route.
- Payments: future-ready settings and prepare-intent stub.
- Audit: audit log route and Prisma audit table.

## Next Build Steps

1. Replace demo responses with Prisma-backed repositories and transaction boundaries.
2. Add JWT guards, refresh token rotation, password hashing, and RBAC/policy guards.
3. Implement availability conflict logic with unit tests for collaborator, room, buffer, and blocked-time rules.
4. Add create-tenant onboarding flow and seed script for a demo tenant.
5. Add E2E tests for owner login, service creation, collaborator creation, public booking, and collaborator-limited access.
6. Add notification provider adapters and async queue once the first real channel is selected.
7. Add payment provider adapter after Stripe/Nexi/PayPal decision.

## Open Product Defaults

- Customer registration default: optional.
- Public booking default: hybrid with request approval.
- First notification channel: email technical foundation only.
- Payments: provider-agnostic preparation only.
- Product depth: simple catalog with service associations first.
- Revenue dashboard basis: sales totals plus completed appointment prices where sales are absent.
