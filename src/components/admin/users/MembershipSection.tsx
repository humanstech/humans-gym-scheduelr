import { useState } from 'react'
import { Dumbbell, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  ptErrorMessage,
  useDeleteMembership,
  useSaveMembership,
  useUserMemberships,
  type PtMembership,
} from '@/hooks/usePtAdmin'
import { formatDay, isMembershipActive, todayISO } from '@/components/admin/ptFormat'

function periodLabel(m: PtMembership, today: string): string {
  const from = `dal ${formatDay(m.valid_from)}`
  if (!m.valid_to) return m.valid_from > today ? `${from} · da iniziare` : `${from} · in corso`
  const range = `${from} al ${formatDay(m.valid_to)}`
  return isMembershipActive(m, today) ? `${range} · in corso` : range
}

function PeriodRow({ membership, userId }: { membership: PtMembership; userId: string }) {
  const today = todayISO()
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(membership.valid_from)
  const [to, setTo] = useState(membership.valid_to ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useSaveMembership()
  const remove = useDeleteMembership()
  const active = isMembershipActive(membership, today)
  const invalid = !from || (!!to && to < from)

  const startEdit = () => {
    setFrom(membership.valid_from)
    setTo(membership.valid_to ?? '')
    setEditing(true)
  }

  const handleSave = () => {
    save.mutate(
      { membershipId: membership.id, userId, validFrom: from, validTo: to || null },
      {
        onSuccess: () => {
          toast.success('Periodo aggiornato')
          setEditing(false)
        },
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  const handleDelete = () => {
    setConfirmDelete(false)
    remove.mutate(membership.id, {
      onSuccess: () => toast.success('Periodo eliminato'),
      onError: err => toast.error(ptErrorMessage(err)),
    })
  }

  return (
    <li className={cn('rounded-lg border px-3 py-2.5', active ? 'border-violet-500/30 bg-violet-500/5' : 'bg-card')}>
      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`from-${membership.id}`} className="text-xs font-normal text-muted-foreground">Dal</Label>
              <Input id={`from-${membership.id}`} type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`to-${membership.id}`} className="text-xs font-normal text-muted-foreground">Al (vuoto = in corso)</Label>
              <Input id={`to-${membership.id}`} type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          {invalid && from && <p className="text-xs text-destructive">La data di fine deve essere successiva all'inizio.</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>Annulla</Button>
            <Button size="sm" onClick={handleSave} disabled={invalid || save.isPending}>
              {save.isPending ? 'Salvataggio…' : 'Salva'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">
            {active && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-violet-500 align-middle" aria-hidden />}
            {periodLabel(membership, today)}
          </span>
          <div className="flex shrink-0 items-center">
            <Button size="icon-sm" variant="ghost" onClick={startEdit} aria-label="Modifica periodo">
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={remove.isPending}
              aria-label="Elimina periodo"
              className="hover:text-destructive"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo periodo?</AlertDialogTitle>
            <AlertDialogDescription>
              Il periodo {periodLabel(membership, today)} verrà eliminato. Le giornate già chiuse
              coinvolte verranno ricalcolate e le prenotazioni PT future annullate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function ActivateForm({ userId }: { userId: string }) {
  const today = todayISO()
  const [from, setFrom] = useState(today)
  const save = useSaveMembership()

  const handleActivate = () => {
    save.mutate(
      { membershipId: null, userId, validFrom: from, validTo: null },
      {
        onSuccess: () => toast.success(`Personal Trainer attivato dal ${formatDay(from)}`),
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="pt-activate-from" className="text-xs font-normal text-muted-foreground">A partire dal</Label>
          <Input id="pt-activate-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
        </div>
        <Button onClick={handleActivate} disabled={!from || save.isPending}>
          <Dumbbell />
          {save.isPending ? 'Attivazione…' : 'Attiva Personal Trainer'}
        </Button>
      </div>
      {from && from < today && (
        <p className="text-xs text-muted-foreground">
          Le giornate già chiuse dal {formatDay(from)} verranno ricalcolate.
        </p>
      )}
    </div>
  )
}

function TerminateForm({ userId, active }: { userId: string; active: PtMembership }) {
  const today = todayISO()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(today < active.valid_from ? active.valid_from : today)
  const save = useSaveMembership()
  const invalid = !to || to < active.valid_from

  const handleTerminate = () => {
    save.mutate(
      { membershipId: active.id, userId, validFrom: active.valid_from, validTo: to },
      {
        onSuccess: () => {
          toast.success(`Iscrizione terminata il ${formatDay(to)}`)
          setOpen(false)
        },
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>Termina iscrizione</Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="space-y-1">
        <Label htmlFor="pt-terminate-to" className="text-xs font-normal text-muted-foreground">Ultimo giorno valido</Label>
        <Input
          id="pt-terminate-to"
          type="date"
          value={to}
          min={active.valid_from}
          onChange={e => setTo(e.target.value)}
          className="w-40"
        />
      </div>
      <p className="flex gap-2 text-xs text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
        Le sedute dopo questa data verranno ricalcolate e le prenotazioni PT future annullate.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={save.isPending}>Annulla</Button>
        <Button size="sm" variant="destructive" onClick={handleTerminate} disabled={invalid || save.isPending}>
          {save.isPending ? 'Salvataggio…' : 'Termina iscrizione'}
        </Button>
      </div>
    </div>
  )
}

export function MembershipSection({ userId }: { userId: string }) {
  const { data: memberships = [], isLoading } = useUserMemberships(userId)
  const active = memberships.find(m => isMembershipActive(m))

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <h3 className="text-sm font-semibold">Iscrizione PT</h3>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-8 w-48" />
        </div>
      ) : (
        <>
          {memberships.length > 0 ? (
            <ul className="space-y-1.5">
              {memberships.map(m => <PeriodRow key={m.id} membership={m} userId={userId} />)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Non ha mai avuto un'iscrizione al Personal Trainer.</p>
          )}
          {active
            ? <TerminateForm key={active.id} userId={userId} active={active} />
            : <ActivateForm userId={userId} />}
        </>
      )}
    </section>
  )
}
