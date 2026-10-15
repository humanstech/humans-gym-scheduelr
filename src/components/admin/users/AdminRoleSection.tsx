import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { AdminUser } from '@/hooks/usePtAdmin'
import { usePromoteAdmin } from '@/hooks/usePromoteAdmin'

export function AdminRoleSection({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false)
  const promote = usePromoteAdmin()

  async function confirmPromotion() {
    try {
      await promote.mutateAsync(user.user_id)
      setOpen(false)
      toast.success('Utente reso admin')
    } catch {
      toast.error('Impossibile rendere admin questo utente. Riprova.')
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Ruolo amministratore</h3>
      <p className="text-sm text-muted-foreground">
        {user.is_admin
          ? 'Questo utente è admin e può gestire utenti, spazi, accessi e personal trainer.'
          : 'Gli admin possono gestire utenti, spazi, accessi e personal trainer.'}
      </p>
      {!user.is_admin && (
        <AlertDialog open={open} onOpenChange={next => { if (!promote.isPending) setOpen(next) }}>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
            <ShieldCheck className="size-4" />
            Rendi admin
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rendere admin questo utente?</AlertDialogTitle>
              <AlertDialogDescription>
                {user.email} avrà accesso a tutta l’area amministrativa e potrà rendere admin altri utenti.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={promote.isPending}>Annulla</AlertDialogCancel>
              <AlertDialogAction disabled={promote.isPending} onClick={confirmPromotion}>
                {promote.isPending ? 'Salvataggio…' : 'Conferma'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  )
}
