import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { recordOnlineArrival, flagGroup } from '../api'
import {
  OnlineMemberList,
  FlagGroupButton,
  layout,
  colors,
  spacing,
  type OnlineOccupant,
} from '@mygames/game-ui'

// ═══════════════════════════════════════════════════════════════════════════════
// ONLINE WAITING ROOM (Part 2).
//
// Reached only in online mode (clock_mode 'off'), after prep. The student is already
// pre-grouped (Chris/Kelly assigned at grouping). They see their partner + email +
// live presence, coordinate a time, and the group AUTO-OPENS the moment both roles are
// present — at which point this screen advances to the off-platform negotiation. No
// attendance code, no instructor "start" (Online_Matching_Spec / Crisis doctrine §2).
// ═══════════════════════════════════════════════════════════════════════════════

type GroupDoc = {
  status?: string
  members?: OnlineOccupant[]
  arrived?: string[]
}

export default function OnlineWaiting({
  participantId,
  gameInstanceId,
  onOpen,
}: {
  participantId: string
  gameInstanceId: string
  onOpen: (groupId: string) => void
}) {
  const [group, setGroup] = useState<GroupDoc | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const openedRef = useRef(false)
  const arrivedForRef = useRef<string | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  // Watch the participant doc for group_id — handles both pre-grouped-before-login and
  // grouped-after-login (the instructor may pre-group while the student waits here).
  useEffect(() => {
    return onSnapshot(doc(db, 'game_instances', gameInstanceId, 'participants', participantId), snap => {
      setGroupId((snap.data()?.['group_id'] as string | undefined) ?? null)
    })
  }, [participantId, gameInstanceId])

  // Once grouped: mark present (per-role auto-open) exactly once per group, then watch
  // the group doc live for members + presence + status.
  useEffect(() => {
    if (!groupId) return
    if (arrivedForRef.current !== groupId) {
      arrivedForRef.current = groupId
      recordOnlineArrival({}).catch(() => {})
    }
    return onSnapshot(doc(db, 'game_instances', gameInstanceId, 'groups', groupId), snap => {
      if (!snap.exists()) return
      const g = snap.data() as GroupDoc
      setGroup(g)
      if (g.status && g.status !== 'matched' && !openedRef.current) {
        openedRef.current = true
        onOpenRef.current(groupId)
      }
    })
  }, [groupId, gameInstanceId])

  const members = group?.members ?? []
  const arrived = new Set(group?.arrived ?? [])
  const bothHere = members.length > 0 && ['chris', 'kelly'].every(role =>
    members.some(m => (m as { role?: string }).role === role && arrived.has(m.participant_id)))

  const onFlag = () =>
    flagGroup({}).then(r => ({
      group_number: r.group_number,
      instructor_email: r.instructor_email,
      already_flagged: r.already_flagged,
    }))

  return (
    <main style={{ padding: layout.pagePad, maxWidth: layout.contentWidth, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Your group</h1>
      <p style={{ lineHeight: 1.6, color: colors.textSecondary, marginBottom: spacing.gapSm }}>
        You&apos;ve been matched for a one-on-one negotiation. Reach out to your partner using the
        email below, agree on a time, and come back here together — the negotiation opens
        automatically once you&apos;re both here.
      </p>

      {members.length === 0 ? (
        <p style={{ color: colors.textSecondary }}>Loading your group…</p>
      ) : (
        <OnlineMemberList
          members={members}
          participantId={participantId}
          arrived={arrived}
          mailSubject="Grays 2.0 negotiation — scheduling"
        />
      )}

      <p style={{ color: colors.textSecondary, marginBottom: spacing.gapMd }}>
        {bothHere
          ? 'Everyone is here — starting your negotiation…'
          : 'Waiting for your partner to arrive. You can close this tab and come back.'}
      </p>

      <FlagGroupButton
        onFlag={onFlag}
        members={members}
        participantId={participantId}
        arrived={arrived}
        gameLabel="Grays 2.0"
      />
    </main>
  )
}
