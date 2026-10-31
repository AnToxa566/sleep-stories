import { TopicsResponseSchema } from '@sleep-stories/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../../api/api-fetch';
import { useSessionStore } from '../auth/session-store';
import { topicsQueryKey } from './topic-cache';
import { topicsPath, type TopicFilter } from './topic-filter';

// GET /topics?style=&ready=: the list of «Темы» and «Замена». It creates no job. The server does
// the filtering, so every filter has its own cached list. The list is read again each time a
// screen mounts (a story may have become ready since), when the app returns to the foreground
// and, for «Темы» (a tab that stays mounted), each time the tab gains focus; it is NOT polled
// (ARCHITECTURE.md section 11, item 30 is open). While another filter loads, the previous list
// stays on screen.
//
// `refetchOnFocus` is for a screen that stays mounted: it turns the refetch-on-mount off (the
// focus effect does the reading, and the first focus is skipped when the mount already
// fetches). A screen mounted per visit leaves it off and keeps the refetch-on-mount.
export function useTopics(filter: TopicFilter, options: { refetchOnFocus?: boolean } = {}) {
  const refetchOnFocus = options.refetchOnFocus === true;
  const status = useSessionStore((state) => state.status);
  const userId = useSessionStore((state) => state.userId);
  const query = useQuery({
    queryKey: topicsQueryKey(userId, filter),
    queryFn: () =>
      apiFetch({ method: 'GET', path: topicsPath(filter), responseSchema: TopicsResponseSchema }),
    enabled: status === 'signedIn' && userId !== null,
    placeholderData: keepPreviousData,
    refetchOnMount: refetchOnFocus ? true : 'always',
  });
  const { refetch, isFetched } = query;
  const fetchedRef = useRef(isFetched);
  useEffect(() => {
    fetchedRef.current = isFetched;
  }, [isFetched]);
  useFocusEffect(
    useCallback(() => {
      // The first focus of a tab that has not fetched yet is the mount's own fetch.
      if (!refetchOnFocus || !fetchedRef.current) return;
      void refetch();
    }, [refetchOnFocus, refetch]),
  );
  return query;
}
