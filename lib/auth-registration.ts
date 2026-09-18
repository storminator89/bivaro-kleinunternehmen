import { Prisma } from "@prisma/client";
import { inTransaction } from "@/lib/db-transaction";

export const APP_SETTINGS_KEY = "global";

export class RegistrationClosedError extends Error {
  constructor() {
    super("Registrierung ist deaktiviert");
    this.name = "RegistrationClosedError";
  }
}

export class RegistrationEmailTakenError extends Error {
  constructor() {
    super("E-Mail wird bereits verwendet");
    this.name = "RegistrationEmailTakenError";
  }
}

interface RegisterUserInput {
  email: string;
  name: string | null;
  passwordHash: string;
}

export interface RegistrationResult {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    sessionVersion: number;
    createdAt: Date;
  };
  firstUser: boolean;
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * Register a user with the bootstrap decision and the user write in one
 * serializable transaction.  The settings upsert is deliberately the first
 * write: it is the unique singleton that makes parallel empty-database
 * registrations serialize instead of both observing userCount = 0.
 */
export async function registerUserAtomically(input: RegisterUserInput): Promise<RegistrationResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await inTransaction(async (tx) => {
        const appSettings = await tx.appSettings.upsert({
          where: { singletonKey: APP_SETTINGS_KEY },
          update: {},
          create: {
            singletonKey: APP_SETTINGS_KEY,
            allowRegistration: false,
          },
        });

        const userCount = await tx.user.count();
        const firstUser = userCount === 0;

        if (!firstUser && !appSettings.allowRegistration) {
          throw new RegistrationClosedError();
        }

        const existingUser = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existingUser) throw new RegistrationEmailTakenError();

        const user = await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            password: input.passwordHash,
            role: firstUser ? "ADMIN" : "USER",
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            sessionVersion: true,
            createdAt: true,
          },
        });

        if (firstUser) {
          await tx.appSettings.update({
            where: { id: appSettings.id },
            data: { allowRegistration: false },
          });
        }

        return { user, firstUser };
      });
    } catch (error) {
      // Two transactions can race on the first singleton insert.  Depending
      // on SQLite's timing this is surfaced as P2002 or as a serializable
      // retry error.  Re-run the whole decision so the loser observes the
      // committed administrator and registration setting.
      if (isKnownPrismaError(error, "P2002") && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Registration transaction exhausted retries");
}
