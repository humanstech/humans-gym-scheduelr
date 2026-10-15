import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, ChevronDown, ChevronUp, ArrowUp, ArrowDown, X, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  useSpaces,
  useSpaceTimeSlots,
  useUpdateSpaceConfig,
  useRegenerateSlots,
  useReorderSpace,
  useDeleteSpace,
  type SpaceConfig,
} from "@/hooks/useSpaceConfig"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { useSyncPtSchedule } from "@/hooks/usePtAdmin"
import { DayPicker } from "./DayPicker"
import { TimeSlotEditor } from "./TimeSlotEditor"
import { WeeklySchedulePreview } from "./WeeklySchedulePreview"

const DAY_LABELS: Record<number, string> = {
  1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio", 5: "Ven", 6: "Sab", 7: "Dom",
}

type SpaceDraft = {
  name: string
  description: string
  is_active: boolean
  max_capacity: number
  min_capacity: number
  available_days: number[]
  allow_multiple_bookings: boolean
}

const DEFAULT_DRAFT: SpaceDraft = {
  name: "",
  description: "",
  is_active: true,
  max_capacity: 10,
  min_capacity: 1,
  available_days: [1, 2, 3, 4, 5],
  allow_multiple_bookings: false,
}

function initDraft(space: SpaceConfig): SpaceDraft {
  return {
    name: space.name,
    description: space.description ?? "",
    is_active: space.is_active ?? false,
    max_capacity: space.max_capacity,
    min_capacity: space.min_capacity,
    available_days: [...space.available_days],
    allow_multiple_bookings: space.allow_multiple_bookings,
  }
}

// Shared config form

type SpaceConfigFormProps = {
  draft: SpaceDraft
  onChange: (patch: Partial<SpaceDraft>) => void
  showActiveToggle?: boolean
  autoFocus?: boolean
}

function SpaceConfigForm({ draft, onChange, showActiveToggle = true, autoFocus = false }: SpaceConfigFormProps) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Generale</h5>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nome</label>
            <Input
              value={draft.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="Nome spazio"
              autoFocus={autoFocus}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Descrizione</label>
            <Input
              value={draft.description}
              onChange={e => onChange({ description: e.target.value })}
              placeholder="Descrizione (opzionale)"
            />
          </div>
        </div>
        {showActiveToggle && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={draft.is_active}
              onClick={() => onChange({ is_active: !draft.is_active })}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                draft.is_active ? "bg-primary" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                  draft.is_active ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
            <span className="text-sm">{draft.is_active ? "Spazio attivo" : "Spazio disattivo"}</span>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Capacità</h5>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Minima</label>
            <Input
              type="number"
              min={1}
              value={draft.min_capacity}
              onChange={e => onChange({ min_capacity: Number(e.target.value) })}
              className="w-20"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Massima</label>
            <Input
              type="number"
              min={1}
              value={draft.max_capacity}
              onChange={e => onChange({ max_capacity: Number(e.target.value) })}
              className="w-20"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Giorni disponibili</h5>
        <DayPicker
          value={draft.available_days}
          onChange={days => onChange({ available_days: days })}
        />
      </section>

      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Regola prenotazione</h5>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={!draft.allow_multiple_bookings}
            onClick={() => onChange({ allow_multiple_bookings: false })}
            className={cn(
              "rounded border px-3 py-1.5 text-sm transition-colors",
              !draft.allow_multiple_bookings
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-input hover:bg-accent"
            )}
          >
            Singola
          </button>
          <button
            type="button"
            aria-pressed={draft.allow_multiple_bookings}
            onClick={() => onChange({ allow_multiple_bookings: true })}
            className={cn(
              "rounded border px-3 py-1.5 text-sm transition-colors",
              draft.allow_multiple_bookings
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-input hover:bg-accent"
            )}
          >
            Multipla
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {draft.allow_multiple_bookings
            ? "Più utenti possono prenotare lo stesso slot."
            : "Un solo utente per slot."}
        </p>
      </section>
    </div>
  )
}

// Existing space card

function SpaceCard({
  space,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  space: SpaceConfig
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<SpaceDraft>(() => initDraft(space))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { data: timeSlots = [] } = useSpaceTimeSlots(space.id)

  const updateConfig = useUpdateSpaceConfig()
  const regenerateSlots = useRegenerateSlots()
  const deleteSpace = useDeleteSpace()
  const syncPt = useSyncPtSchedule()

  const handleToggle = () => {
    if (!expanded) setDraft(initDraft(space))
    setExpanded(e => !e)
  }

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error("Il nome è obbligatorio.")
      return
    }
    if (draft.min_capacity < 1) {
      toast.error("La capacità minima deve essere almeno 1.")
      return
    }
    if (draft.max_capacity < draft.min_capacity) {
      toast.error("La capacità massima deve essere ≥ quella minima.")
      return
    }

    try {
      await updateConfig.mutateAsync({
        id: space.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        is_active: draft.is_active,
        max_capacity: draft.max_capacity,
        min_capacity: draft.min_capacity,
        available_days: draft.available_days,
        allow_multiple_bookings: draft.allow_multiple_bookings,
      })
      await regenerateSlots.mutateAsync(14)
      const changed = await syncPt.mutateAsync(space.id)
      toast.success("Configurazione salvata.", changed > 0
        ? { description: changed === 1 ? "1 seduta PT aggiornata" : `${changed} sedute PT aggiornate` }
        : undefined)
      setExpanded(false)
    } catch (err) {
      toast.error((err as Error).message || "Errore durante il salvataggio.")
    }
  }

  const handleDelete = async () => {
    setDeleteOpen(false)
    try {
      await deleteSpace.mutateAsync(space.id)
      toast.success("Spazio eliminato.")
    } catch (err) {
      toast.error((err as Error).message || "Errore durante l'eliminazione.")
    }
  }

  const daysLabel =
    space.available_days.length === 0
      ? "Nessun giorno"
      : space.available_days.map(d => DAY_LABELS[d]).join(" · ")

  const isPending = updateConfig.isPending || regenerateSlots.isPending || syncPt.isPending

  const handleToggleActive = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await updateConfig.mutateAsync({ id: space.id, is_active: !space.is_active })
      await regenerateSlots.mutateAsync(14)
      await syncPt.mutateAsync(space.id)
    } catch (err) {
      toast.error((err as Error).message || "Errore durante l'aggiornamento.")
    }
  }

  return (
    <div className={cn(
      "rounded-lg border bg-background transition-colors",
      !space.is_active && "opacity-60"
    )}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30 transition-colors rounded-lg"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        {/* Content area */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="font-medium truncate">{space.name}</span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {space.allow_multiple_bookings ? "Multipla" : "Singola"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{space.min_capacity}–{space.max_capacity} posti</span>
            <span className="text-muted-foreground/40">|</span>
            <span>{daysLabel}</span>
            <span className="text-muted-foreground/40">|</span>
            <span>{timeSlots.length} fasce</span>
          </div>
          {!expanded && (
            <WeeklySchedulePreview
              availableDays={space.available_days}
              timeSlots={timeSlots}
            />
          )}
        </div>

        {/* Actions area */}
        <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
          {/* Active toggle */}
          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={space.is_active ?? false}
              aria-label={space.is_active ? "Disattiva spazio" : "Attiva spazio"}
              disabled={updateConfig.isPending}
              onClick={handleToggleActive}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                space.is_active ? "bg-primary" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transition-transform",
                  space.is_active ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
            <span className="text-[10px] text-muted-foreground leading-none">
              {space.is_active ? "On" : "Off"}
            </span>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-border" />

          {/* Reorder */}
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="Sposta su"
              disabled={isFirst}
              onClick={onMoveUp}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Sposta giù"
              disabled={isLast}
              onClick={onMoveDown}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Delete */}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger
              type="button"
              aria-label="Elimina spazio"
              className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Elimina spazio</AlertDialogTitle>
                <AlertDialogDescription>
                  Tutte le fasce orarie, gli slot e le prenotazioni associate verranno eliminati.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annulla</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Elimina
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Chevron */}
        {expanded
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-5">
          <SpaceConfigForm
            draft={draft}
            onChange={patch => setDraft(d => ({ ...d, ...patch }))}
            showActiveToggle
            autoFocus
          />

          <section className="space-y-3">
            <h5 className="text-sm font-semibold">Fasce orarie</h5>
            <TimeSlotEditor spaceId={space.id} availableDays={draft.available_days} />
          </section>

          <div className="flex justify-end gap-2 pt-1 border-t">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} disabled={isPending}>
              Annulla
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Create form

function CreateSpaceForm({ onCancel }: { onCancel: () => void }) {
  const queryClient = useQueryClient()
  const regenerateSlots = useRegenerateSlots()
  const [draft, setDraft] = useState<SpaceDraft>({ ...DEFAULT_DRAFT })

  const addSpace = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("name_required")
      if (draft.min_capacity < 1) throw new Error("min_capacity")
      if (draft.max_capacity < draft.min_capacity) throw new Error("max_capacity")

      const { error } = await supabase.from("spaces").insert({
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        is_active: draft.is_active,
        max_capacity: draft.max_capacity,
        min_capacity: draft.min_capacity,
        available_days: draft.available_days,
        allow_multiple_bookings: draft.allow_multiple_bookings,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] })
      await regenerateSlots.mutateAsync(14)
      toast.success("Spazio creato.", {
        description: "Apri lo spazio appena creato per configurare le fasce orarie.",
        duration: 6000,
      })
      onCancel()
    },
    onError: (err: Error) => {
      if (err.message === "name_required") toast.error("Il nome è obbligatorio.")
      else if (err.message === "min_capacity") toast.error("La capacità minima deve essere almeno 1.")
      else if (err.message === "max_capacity") toast.error("La capacità massima deve essere ≥ quella minima.")
      else toast.error("Errore durante l'aggiunta.")
    },
  })

  const isPending = addSpace.isPending || regenerateSlots.isPending

  return (
    <div className="rounded-lg border bg-background p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Nuovo spazio</h4>
        <button
          type="button"
          aria-label="Annulla"
          onClick={onCancel}
          className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <SpaceConfigForm
        draft={draft}
        onChange={patch => setDraft(d => ({ ...d, ...patch }))}
        showActiveToggle={false}
        autoFocus
      />

      <div className="flex justify-end gap-2 pt-1 border-t">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Annulla
        </Button>
        <Button size="sm" onClick={() => addSpace.mutate()} disabled={isPending}>
          {isPending ? "Creazione…" : "Crea spazio"}
        </Button>
      </div>
    </div>
  )
}

// Main component

export function Spaces() {
  const { data: spaces = [], isLoading } = useSpaces()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const reorder = useReorderSpace()

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= spaces.length) return
    const updated = spaces.map((s, i) => {
      if (i === index) return { id: s.id, sort_order: target }
      if (i === target) return { id: s.id, sort_order: index }
      return { id: s.id, sort_order: i }
    })
    reorder.mutate({ spaces: updated })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Spazi</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ogni spazio attivo genera i propri slot prenotabili.
        </p>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuno spazio configurato.</p>
        ) : (
          spaces.map((space, i) => (
            <SpaceCard
              key={space.id}
              space={space}
              isFirst={i === 0}
              isLast={i === spaces.length - 1}
              onMoveUp={() => handleMove(i, -1)}
              onMoveDown={() => handleMove(i, 1)}
            />
          ))
        )}
      </div>

      {showCreateForm ? (
        <CreateSpaceForm onCancel={() => setShowCreateForm(false)} />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateForm(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Aggiungi spazio
        </Button>
      )}
    </div>
  )
}
