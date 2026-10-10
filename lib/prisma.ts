import { PrismaClient } from "@prisma/client";

// Single shared PrismaClient. Cached on globalThis so dev hot-reloads and
// warm serverless invocations reuse one instance instead of exhausting
// database connections. Import `prisma` from here — never `new PrismaClient()`.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
