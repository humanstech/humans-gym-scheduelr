import { useState } from 'react'
import { ChevronDown, MoreHorizontal, RotateCcw, Ban, UserMinus, HandCoins } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatEUR } from '@/lib/money'
import { ptErrorMessage, useRestoreSession, type AdminSession } from '@/hooks/usePtAdmin'
import { fmtTime } from '@/components/admin/ptFormat'
import { sessionLabel, updatedMessage } from './sessionUtils'

export type SessionAction = 'void' | 'exclude' | 'payers'

interface SessionRowProps {
  session: AdminSession
  onAction: (action: SessionAction, session: AdminSession) => void
}

function Breakdown({ session }: { session: AdminSession }) {
  const charges = [...session.charges].sort((a, b) => a.name.localeCompare(b.name, 'it'))
  return (
    <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {session.day_closed ? 'Addebitato' : 'Stima attuale'}
      </p>
      {charges.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun addebito per questa seduta.</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {charges.map(c => (
            <li key={c.user_id} className="flex justify-between gap-3">
              <span className="truncate">{c.name}</span>
              <span className="tabular-nums">{formatEUR(c.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex justify-between border-t pt-1.5 text-xs font-medium">
        <span>Totale</span>
        <span className="tabular-nums">{formatEUR(session.total_cents)}</span>
      </div>
    </div>
  )
}

export function SessionRow({ session, onAction }: SessionRowProps) {
  const [open, setOpen] = useState(false)
  const restore = useRestoreSession()
  const voided = session.status === 'voided'
  const participantIds = new Set(session.participants.map(p => p.user_id))
  const excludedElsewhere = session.exclusions.filter(e => !participantIds.has(e.user_id))

  const handleRestore = () => {
    restore.mutate(session.slot_id, {
      onSuccess: () => toast.success(updatedMessage(session)),
      onError: err => toast.error(ptErrorMessage(err)),
    })
  }

  return (
    <li className={cn('px-3 py-3 sm:px-4', voided && 'bg-muted/30')}>
      <div className="flex items-start gap-3">
        <div className="w-12 shrink-0 pt-0.5">
          <p className={cn('font-mono text-sm font-medium', voided && 'text-muted-foreground line-through')}>
            {fmtTime(session.start_time)}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">{fmtTime(session.end_time)}</p>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{session.space_name}</span>
            {voided && <Badge variant="destructive">Annullata</Badge>}
            {session.billing_mode === 'custom' && !voided && (
              <Badge className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
                Pagano: {session.payers.map(p => p.name).join(', ') || '—'}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {session.source === 'schedule' ? 'Programmata' : 'Singola'}
            </Badge>
          </div>

          {voided && session.voided_reason && (
            <p className="text-xs text-muted-foreground">Motivo: {session.voided_reason}</p>
          )}

          {session.participants.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun prenotato</p>
          ) : (
            <ul className="flex flex-wrap gap-1" aria-label="Prenotati">
              {session.participants.map(p => (
                <li
                  key={p.user_id}
                  title={p.excluded ? 'Escluso dal costo' : p.counted ? undefined : 'Non conteggiato'}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
                    p.excluded || !p.counted ? 'border-dashed text-muted-foreground' : 'bg-background'
                  )}
                >
                  <span className={cn(p.excluded && 'line-through')}>{p.name}</span>
                  {p.excluded && <span className="text-[10px] uppercase tracking-wide">escluso</span>}
                </li>
              ))}
            </ul>
          )}

          {excludedElsewhere.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Esclusi dal costo: {excludedElsewhere.map(e => e.name).join(', ')}
            </p>
          )}

          {!voided && (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Ripartizione
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          {open && !voided && <Breakdown session={session} />}
        </div>

        <div className="flex shrink-0 items-start gap-1">
          {!voided && (
            <span className="pt-1 text-sm font-medium tabular-nums">{formatEUR(session.total_cents)}</span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label={`Azioni seduta ${sessionLabel(session)}`} />}
              disabled={restore.isPending}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {voided ? (
                <DropdownMenuItem onClick={handleRestore}>
                  <RotateCcw /> Ripristina seduta
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => onAction('exclude', session)}>
                    <UserMinus /> Escludi dal costo…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction('payers', session)}>
                    <HandCoins /> Scegli chi paga…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onAction('void', session)}>
                    <Ban /> Annulla seduta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}
