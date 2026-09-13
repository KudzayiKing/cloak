import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const log =
  process.env.PRISMA_LOG_QUERIES === "1"
    ? (["query", "error", "warn"] as const)
    : process.env.PRISMA_LOG_ERRORS === "1" || process.env.NODE_ENV === "production"
      ? (["error"] as const)
      : ([] as const);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...log],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
