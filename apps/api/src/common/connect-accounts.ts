import { compare, hash } from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type {
  ConnectAccountAdapter,
  ConnectApplicationErrorCode,
} from "@eulab/connect/application";
import { canUseLocalFunction } from "./function-catalog";
import { connectConfig, sealConnect } from "./connect-runtime";

/** Domain-only adapters: no OIDC, session, challenge or provider-token logic. */
export function connectAccounts(
  prisma: PrismaClient,
  reject: (code: ConnectApplicationErrorCode) => never,
): ConnectAccountAdapter {
  return {
    async verifyLegacy({ email, password }) {
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        include: { tenant: true },
      });
      if (
        !user?.isActive ||
        !user.tenant?.isActive ||
        user.tenant.isSuspended ||
        user.connectActivatedAt ||
        !(
          user.role === "owner" ||
          user.role === "manager" ||
          user.role === "reception" ||
          user.role === "collaborator"
        ) ||
        !(await compare(password, user.passwordHash))
      )
        return null;
      return {
        localTenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          slug: user.tenant.slug,
        },
        localUser: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          permissions: user.permissions,
        },
      };
    },
    async provision(context, { transaction }) {
      // SDK store and domain writes share this PostgreSQL transaction, including handoff consumption.
      const sql = transaction.sql;
      if (!sql) return reject("invalid_configuration");
      const { tenant, user, binding } = context;
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "connect-tenant:" + tenant.id,
      ]);
      const existingBinding = (
        await sql.query(
          'SELECT * FROM "ConnectTenantBinding" WHERE "tenantId"=$1',
          [tenant.id],
        )
      ).rows[0];
      const configured = connectConfig(tenant.id);
      for (const current of [existingBinding, configured]) {
        if (
          current &&
          (current.installationId !== binding.installationId ||
            current.customerId !== binding.customerId)
        )
          return reject("provision_conflict");
      }
      const company = (
        await sql.query('SELECT * FROM "Tenant" WHERE id=$1 FOR UPDATE', [
          tenant.id,
        ])
      ).rows[0];
      if (company && (!company.isActive || company.isSuspended))
        return reject("access_denied");
      const existing = (
        await sql.query('SELECT * FROM "User" WHERE id=$1 FOR UPDATE', [
          user.id,
        ])
      ).rows[0];
      const emailOwner = (
        await sql.query('SELECT id FROM "User" WHERE email=$1', [user.email])
      ).rows[0];
      if (emailOwner && emailOwner.id !== user.id)
        return reject("provision_conflict");
      if (
        existing &&
        (existing.tenantId !== tenant.id ||
          !existing.isActive ||
          existing.role === "platform_admin" ||
          existing.role === "client" ||
          existing.email !== user.email ||
          (existing.connectSubject &&
            existing.connectSubject !== user.subject) ||
          (existing.connectInstallationId &&
            existing.connectInstallationId !== binding.installationId))
      )
        return reject("provision_conflict");
      if (!company)
        await sql.query(
          'INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES($1,$2,$3,now())',
          [tenant.id, tenant.name, tenant.slug],
        );
      if (!existing) {
        const unusableHash = await hash(
          randomBytes(48).toString("base64url"),
          10,
        );
        await sql.query(
          'INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,permissions,"passwordHash","updatedAt") VALUES($1,$2,$3,$4,$5,$6::"UserRole",$7,$8,now())',
          [
            user.id,
            tenant.id,
            user.email,
            user.firstName,
            user.lastName,
            user.role,
            user.permissions,
            unusableHash,
          ],
        );
      }
      // Existing names, roles, permissions, password and operational relationships remain untouched.
      await sql.query(
        'UPDATE "User" SET "connectSubject"=$2,"connectInstallationId"=$3,"connectAcceptedAt"=COALESCE("connectAcceptedAt",now()),"connectActivatedAt"=COALESCE("connectActivatedAt",now()),"updatedAt"=now() WHERE id=$1',
        [user.id, user.subject, binding.installationId],
      );
      await sql.query(
        'INSERT INTO "ConnectTenantBinding" ("tenantId","customerId","installationId","secretCipher") VALUES($1,$2,$3,$4) ON CONFLICT ("tenantId") DO UPDATE SET "secretCipher"=EXCLUDED."secretCipher"',
        [
          tenant.id,
          binding.customerId,
          binding.installationId,
          sealConnect(binding.secret),
        ],
      );
      await sql.query(
        'UPDATE "LocalSession" SET "revokedAt"=now() WHERE "userId"=$1 AND "connectSessionId" IS NULL AND "revokedAt" IS NULL',
        [user.id],
      );
      await sql.query(
        'INSERT INTO "AuditLog" (id,"tenantId","actorUserId","actorRole",action,"entityType","entityId") VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          randomUUID(),
          tenant.id,
          user.id,
          existing?.role ?? user.role,
          existing
            ? "auth.connect.profile_linked"
            : "auth.connect.profile_created",
          "user",
          user.id,
        ],
      );
      return { localTenantId: tenant.id, localUserId: user.id };
    },
    async restrict(profile, key, resource) {
      const user = await prisma.user.findUnique({
        where: { id: profile.localUserId },
        include: { tenant: true, collaborator: true },
      });
      if (
        !user?.isActive ||
        user.tenantId !== profile.localTenantId ||
        !user.tenant?.isActive ||
        user.tenant.isSuspended
      )
        return false;
      const collaboratorId =
        user.collaborator?.isActive &&
        user.collaborator.tenantId === user.tenantId
          ? user.collaborator.id
          : null;
      if (!canUseLocalFunction({ ...user, collaboratorId }, key)) return false;
      if (resource === null || resource === undefined) return true; // List queries must still apply their own tenant/owner predicates.
      if (
        typeof resource !== "object" ||
        !("tenantId" in resource) ||
        resource.tenantId !== user.tenantId
      )
        return false;
      return (
        user.role !== "collaborator" ||
        ("collaboratorId" in resource &&
          resource.collaboratorId === collaboratorId)
      );
    },
  };
}
