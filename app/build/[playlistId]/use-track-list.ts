'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  fetchPlaylistTracks,
  initialTrackListState,
  needsResolution,
  postResolve,
  resolveInChunks,
  toResolveItem,
  trackListReducer,
  type TrackListState,
} from '@/lib/resolution'
import type { TrackWithBpm } from '@/lib/types'

/**
 * Loads a playlist's tracks (cached BPMs included), then resolves the rest in
 * chunks, updating state as each chunk returns. `retry` runs another pass over
 * whatever is still unresolved.
 */
export function useTrackList(playlistId: string): TrackListState & { retry: () => void } {
  const [state, dispatch] = useReducer(trackListReducer, initialTrackListState)
  // The pass in progress; aborted on unmount, or when a new one starts.
  const pass = useRef<AbortController | null>(null)

  const resolve = useCallback(async (tracks: TrackWithBpm[]) => {
    pass.current?.abort()
    const controller = new AbortController()
    pass.current = controller
    const { signal } = controller

    const pending = tracks.filter(needsResolution).map(toResolveItem)
    if (pending.length === 0) return
    dispatch({ type: 'resolve-start', total: pending.length })
    const stop = await resolveInChunks(pending, {
      post: (items) => postResolve(items, signal),
      onChunk: (response) => dispatch({ type: 'chunk', results: response.results }),
      signal,
    })
    if (!signal.aborted) dispatch({ type: 'resolve-end', stop })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    pass.current = controller

    fetchPlaylistTracks(playlistId, controller.signal).then(
      (tracks) => {
        if (controller.signal.aborted) return
        dispatch({ type: 'loaded', tracks })
        void resolve(tracks)
      },
      (err: Error) => {
        if (!controller.signal.aborted) dispatch({ type: 'load-failed', message: err.message })
      }
    )

    return () => {
      controller.abort()
      pass.current?.abort()
    }
  }, [playlistId, resolve])

  const retry = useCallback(() => void resolve(state.tracks), [resolve, state.tracks])

  return { ...state, retry }
}
