// The cache keys that more than one feature reads or invalidates. The user id only separates
// one account's cache from another's. It is never sent: the API reads the person from the
// token.

export const queueQueryKey = (userId: string | null) => ['queue', userId] as const;

// The prefix of every cached list «Темы» of one account, whatever its filter.
export const topicsUserKey = (userId: string | null) => ['topics', userId] as const;
