import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inTransaction } from '@/lib/db-transaction';
import { BankImportError, bankImportUuid } from '@/lib/bank-import-contract';
import { BANK_MAPPING_PROFILE_LIMIT, BANK_MAPPING_PROFILE_REVISION_LIMIT, bankMappingProfileRevision, parseBankMappingProfileConfiguration, parseBankMappingProfileDelete, parseBankMappingProfileMutation, type BankMappingProfile, type BankMappingProfileSummary } from '@/lib/bank-mapping-profile-contract';

function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
const missing = () => new BankImportError('Zuordnungsprofil nicht gefunden oder gelöscht. Liste erneut laden.', 404);
export async function listBankMappingProfiles(userId: string): Promise<BankMappingProfileSummary[]> {
  const profiles = await prisma.bankMappingProfile.findMany({ where: { userId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: BANK_MAPPING_PROFILE_LIMIT, include: { revisions: { where: { userId }, orderBy: { revision: 'desc' }, take: 1 } } });
  return profiles.map(profile => {
    const config = parseBankMappingProfileConfiguration(profile.revisions[0]?.configuration);
    return { id: profile.id, revision: profile.revision, name: config.name, accountAlias: config.mapping.accountAlias };
  });
}
export async function readBankMappingProfile(userId: string, id: string, revision?: number): Promise<BankMappingProfile> {
  bankImportUuid(id); if (revision !== undefined) bankMappingProfileRevision(revision);
  return prisma.$transaction(async tx => {
    const profile = await tx.bankMappingProfile.findFirst({ where: { id, userId, deletedAt: null } });
    if (!profile) throw missing();
    const item = await tx.bankMappingProfileRevision.findUnique({ where: { userId_profileId_revision: { userId, profileId: id, revision: revision ?? profile.revision } } });
    if (!item) throw missing();
    return { id, revision: item.revision, latestRevision: profile.revision, configuration: parseBankMappingProfileConfiguration(item.configuration) };
  });
}
export async function saveBankMappingProfile(userId: string, value: unknown): Promise<BankMappingProfile> {
  const input = parseBankMappingProfileMutation(value);
  const save = () => inTransaction(async tx => {
    const profile = await tx.bankMappingProfile.findFirst({ where: { id: input.id, userId } });
    // A guessed foreign identifier is indistinguishable from an unknown one.
    if (!profile && input.expectedRevision !== 0) throw missing();
    if (profile?.deletedAt) throw missing();
    const prior = profile && await tx.bankMappingProfileRevision.findUnique({ where: { userId_profileId_mutationId: { userId, profileId: input.id, mutationId: input.mutationId } } });
    if (prior) {
      if (prior.revision !== input.expectedRevision + 1 || !equal(parseBankMappingProfileConfiguration(prior.configuration), input.configuration)) throw new BankImportError('Diese Aktionskennung gehört zu einer anderen Profiländerung.', 409);
      return { id: input.id, revision: prior.revision, latestRevision: profile!.revision, configuration: parseBankMappingProfileConfiguration(prior.configuration) };
    }
    if ((profile?.revision ?? 0) !== input.expectedRevision) throw new BankImportError('Das Profil wurde zwischenzeitlich geändert. Neu laden und vor einer neuen Revision vergleichen.', 409);
    if (input.expectedRevision >= BANK_MAPPING_PROFILE_REVISION_LIMIT) throw new BankImportError('Dieses Profil hat die Revisionsgrenze erreicht. Bitte als neues Profil speichern.', 409);
    if (!profile && await tx.bankMappingProfile.count({ where: { userId, deletedAt: null } }) >= BANK_MAPPING_PROFILE_LIMIT) throw new BankImportError('Höchstens 100 aktive Profile. Bitte zuerst ein nicht mehr benötigtes Profil löschen.', 409);
    const revision = input.expectedRevision + 1;
    // One event time keeps parent metadata and its immutable revision consistent.
    const now = new Date();
    if (!profile) await tx.bankMappingProfile.create({ data: { id: input.id, userId, revision, createdAt: now, updatedAt: now } });
    else {
      const result = await tx.bankMappingProfile.updateMany({ where: { id: input.id, userId, revision: input.expectedRevision, deletedAt: null }, data: { revision, updatedAt: now } });
      if (result.count !== 1) throw new BankImportError('Das Profil wurde zwischenzeitlich geändert. Bitte neu laden.', 409);
    }
    await tx.bankMappingProfileRevision.create({ data: { userId, profileId: input.id, revision, mutationId: input.mutationId, configuration: input.configuration as unknown as Prisma.InputJsonValue, createdAt: now } });
    return { id: input.id, revision, latestRevision: revision, configuration: input.configuration };
  });
  try { return await save(); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return save(); throw error; }
}
export async function deleteBankMappingProfile(userId: string, value: unknown): Promise<{ deleted: true }> {
  const input = parseBankMappingProfileDelete(value);
  return inTransaction(async tx => {
    const profile = await tx.bankMappingProfile.findFirst({ where: { id: input.id, userId } });
    if (!profile) throw missing();
    if (profile.deletedAt && profile.deleteMutationId === input.mutationId && profile.revision === input.expectedRevision) return { deleted: true };
    if (profile.deletedAt) throw missing();
    if (await tx.bankMappingProfileRevision.findUnique({ where: { userId_profileId_mutationId: { userId, profileId: input.id, mutationId: input.mutationId } } })) throw new BankImportError('Diese Aktionskennung gehört bereits zu einer Profilrevision.', 409);
    if (profile.revision !== input.expectedRevision) throw new BankImportError('Das Profil wurde zwischenzeitlich geändert. Vor dem Löschen neu laden.', 409);
    const now = new Date();
    const result = await tx.bankMappingProfile.updateMany({ where: { id: input.id, userId, revision: input.expectedRevision, deletedAt: null }, data: { deletedAt: now, deleteMutationId: input.mutationId, updatedAt: now } });
    if (result.count !== 1) throw new BankImportError('Das Profil wurde zwischenzeitlich geändert. Bitte neu laden.', 409);
    return { deleted: true };
  });
}
