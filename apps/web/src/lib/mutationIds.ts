const mine = new Set<string>();

export function newMutationId(): string {
  const id = crypto.randomUUID();
  mine.add(id);
  if (mine.size > 500) mine.delete(mine.values().next().value!); // bounded memory
  return id;
}

export const isOwnMutation = (id?: string) => !!id && mine.has(id);
